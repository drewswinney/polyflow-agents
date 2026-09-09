/**
 * Where Hermes's event names become the app's.
 *
 * The one distinction this file exists to protect: `message.delta` carries the
 * piece that just arrived, `message.interim` carries the whole message so far.
 * They were mapped to the same update, so a host with
 * `display.interim_assistant_messages` on streamed every reply and then wrote
 * it out a second time on top of itself.
 */

import { describe, it, expect } from '@jest/globals'

import { mapGatewayEvent, type MapContext, toEventRecord } from '@/backends/hermes/event-map'

function context(): MapContext {
  return { now: 1_000, toolStartedAt: new Map(), approvalTimeoutMs: null }
}

/** The updates chat acts on; the raw log passthrough is a separate concern. */
function chatUpdates(type: string, payload: unknown) {
  return mapGatewayEvent({ type, session_id: 's1', payload } as never, context()).filter(
    update => update.kind !== 'event'
  )
}

describe('assistant text', () => {
  it('maps message.delta to an appended chunk', () => {
    expect(chatUpdates('message.delta', { text: ' there' })).toEqual([
      { kind: 'agent_message_chunk', text: ' there' }
    ])
  })

  it('maps message.interim to a snapshot, not a chunk', () => {
    expect(chatUpdates('message.interim', { text: 'Hello there' })).toEqual([
      { kind: 'agent_message_snapshot', text: 'Hello there' }
    ])
  })

  it('coerces the content-block array shape a provider may send', () => {
    expect(chatUpdates('message.delta', { text: [{ text: 'a' }, { text: 'b' }] })).toEqual([
      { kind: 'agent_message_chunk', text: 'ab' }
    ])
  })

  it('says nothing about chat for an empty delta', () => {
    expect(chatUpdates('message.delta', { text: '' })).toEqual([])
  })
})

describe('the id a blocking request names', () => {
  const approval = { request_id: 'r1', command: 'rm -rf build', description: 'deletes files' }

  it('is the runtime id when nothing better is known', () => {
    const [update] = mapGatewayEvent({ type: 'approval.request', session_id: 'rt', payload: approval } as never, context())

    expect(update).toMatchObject({ kind: 'permission_request', req: { id: 'r1', sessionId: 'rt' } })
  })

  it('is the stored id once the connection knows it, for approvals and questions alike', () => {
    const ctx = context()
    const [asked] = mapGatewayEvent({ type: 'approval.request', session_id: 'rt', payload: approval } as never, ctx, 'stored')
    const [question] = mapGatewayEvent(
      { type: 'clarify.request', session_id: 'rt', payload: { request_id: 'r2', question: 'Which?' } } as never,
      ctx,
      'stored'
    )

    expect(asked).toMatchObject({ kind: 'permission_request', req: { id: 'r1', sessionId: 'stored' } })
    expect(question).toMatchObject({ kind: 'clarify_request', req: { id: 'r2', sessionId: 'stored' } })
  })
})

describe('the start of a turn', () => {
  it('reports message.start to chat, and still logs it', () => {
    // The bug this pins: message.start was log-only, so between a submit and
    // the first token the chat had no signal at all and looked idle for the
    // model's whole time-to-first-token.
    const updates = mapGatewayEvent({ type: 'message.start', session_id: 's1', payload: {} } as never, context())

    expect(updates.map(update => update.kind)).toEqual(['turn_started', 'event'])
  })

  it('passes the host’s slow-start notice through as a notice', () => {
    expect(chatUpdates('notification.show', { text: 'Still starting the agent', kind: 'agent' })).toEqual([
      { kind: 'notice', text: 'Still starting the agent' }
    ])
  })

  it('says nothing about chat for an empty notice', () => {
    expect(chatUpdates('notification.show', { text: '' })).toEqual([])
  })

  it('passes the host’s compaction status through as a notice', () => {
    // The bug this pins: preflight compaction held a turn for fifteen
    // minutes, and status.update was the only event on the socket the whole
    // time — unmapped, so the row said "Working…" and the session looked
    // paused.
    expect(chatUpdates('status.update', { kind: 'compacting', text: '🗜️ Compacting context — summarizing…' })).toEqual([
      { kind: 'notice', text: '🗜️ Compacting context — summarizing…' }
    ])
    expect(chatUpdates('status.update', { kind: 'compacted', text: '✓ Context compaction complete' })).toEqual([
      { kind: 'notice', text: '✓ Context compaction complete' }
    ])
    expect(chatUpdates('status.update', { kind: 'lifecycle', text: '📦 Preflight compression: ~263,732 tokens' })).toEqual([
      { kind: 'notice', text: '📦 Preflight compression: ~263,732 tokens' }
    ])
  })

  it('keeps the TUI’s own status chatter out of the chat', () => {
    expect(chatUpdates('status.update', { kind: 'status', text: 'ready' })).toEqual([])
    expect(chatUpdates('status.update', { kind: 'compacting', text: '  ' })).toEqual([])
    expect(chatUpdates('status.update', {})).toEqual([])
  })
})

describe('a turn that streams and restates itself', () => {
  it('ends with the reply once, not twice', () => {
    // What the host sends with interim messages on: deltas, then the whole
    // message, then the completion.
    const ctx = context()
    const events = [
      { type: 'message.delta', payload: { text: 'Hello' } },
      { type: 'message.delta', payload: { text: ' there' } },
      { type: 'message.interim', payload: { text: 'Hello there' } },
      { type: 'message.complete', payload: {} }
    ]

    // Replayed the way the tail applies them: chunks extend, snapshots replace.
    let text = ''

    for (const event of events) {
      for (const update of mapGatewayEvent(event as never, ctx)) {
        if (update.kind === 'agent_message_chunk') text += update.text
        if (update.kind === 'agent_message_snapshot') text = update.text
      }
    }

    expect(text).toBe('Hello there')
  })
})

describe('toEventRecord session identity', () => {
  // The bug this pins: events name the *runtime* id, which `session.resume`
  // mints fresh every time a chat is reopened. Anything that remembers a
  // session across that — the notification ledger keying "this turn already
  // announced", a deep link into a chat — saw a different session each time.
  it('prefers the stored id the app knows the session by', () => {
    const event = { type: 'message.complete', session_id: 'rt-9f3a', payload: {} } as never

    expect(toEventRecord(event, 1_000, '20260902_120000_stub01').sessionId).toBe('20260902_120000_stub01')
  })

  it('gives one answer for one session across two resumes', () => {
    // Two runtime ids, one conversation. Reopening the chat is what produces
    // the second, and it used to make the same finished turn announce twice.
    const first = { type: 'message.complete', session_id: 'rt-first', payload: {} } as never
    const second = { type: 'message.complete', session_id: 'rt-second', payload: {} } as never
    const stored = '20260902_120000_stub01'

    expect(toEventRecord(first, 1_000, stored).sessionId).toBe(toEventRecord(second, 2_000, stored).sessionId)
  })

  it('falls back to the raw id before a resume has landed', () => {
    // All there is to go on in that window, and better than nothing at all.
    const event = { type: 'message.complete', session_id: 'rt-9f3a', payload: {} } as never

    expect(toEventRecord(event, 1_000, undefined).sessionId).toBe('rt-9f3a')
  })
})


describe('turn boundaries', () => {
  it('reads message.complete as the end of the turn', () => {
    expect(chatUpdates('message.complete', {})).toEqual([{ kind: 'turn_complete', stopReason: 'end_turn' }])
  })

  it('keeps thinking on its own channel', () => {
    expect(chatUpdates('thinking.delta', { text: 'hmm' })).toEqual([{ kind: 'agent_thought_chunk', text: 'hmm' }])
  })
})

describe('session.info carries the live model', () => {
  // It used to be log-only, so a model switch — from this app, the TUI or the
  // desktop — changed the session and the composer went on naming the model
  // the transcript happened to load with.
  it('maps a model to a model_changed update', () => {
    expect(chatUpdates('session.info', { model: 'claude-opus-5' })).toEqual([
      { kind: 'model_changed', model: 'claude-opus-5' }
    ])
  })

  it('says nothing about chat when there is no model on it', () => {
    expect(chatUpdates('session.info', {})).toEqual([])
    expect(chatUpdates('session.info', { model: '   ' })).toEqual([])
  })

  it('trims what the host sent', () => {
    expect(chatUpdates('session.info', { model: '  sonnet-4.5 ' })).toEqual([
      { kind: 'model_changed', model: 'sonnet-4.5' }
    ])
  })
})
