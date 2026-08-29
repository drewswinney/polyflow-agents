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

import { mapGatewayEvent, type MapContext } from '@/backends/hermes/event-map'

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

describe('turn boundaries', () => {
  it('reads message.complete as the end of the turn', () => {
    expect(chatUpdates('message.complete', {})).toEqual([{ kind: 'turn_complete', stopReason: 'end_turn' }])
  })

  it('keeps thinking on its own channel', () => {
    expect(chatUpdates('thinking.delta', { text: 'hmm' })).toEqual([{ kind: 'agent_thought_chunk', text: 'hmm' }])
  })
})
