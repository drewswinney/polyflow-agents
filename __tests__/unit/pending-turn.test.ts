/**
 * The gap between sending and seeing anything.
 *
 * The bug this pins: a sent message showed a bubble and then nothing — the
 * chat looked idle for the model's whole time-to-first-token, and a message
 * folded into a running turn by the host gave no sign at all. These are the
 * transitions that decide what the pending row says and when it goes away.
 */

import { describe, it, expect } from '@jest/globals'

import type { SessionUpdate, TranscriptEntry } from '@/domain'
import {
  alreadyLanded,
  describePending,
  PENDING_STALE_AFTER_MS,
  type PendingTurn,
  pendingAfterSubmit,
  pendingAfterUpdate,
  pendingLooksStale,
  shouldRequeue
} from '@/state/pending-turn'

const chunk: SessionUpdate = { kind: 'agent_message_chunk', text: 'Hi' }
const thought: SessionUpdate = { kind: 'agent_thought_chunk', text: 'hmm' }
const started: SessionUpdate = { kind: 'turn_started' }
const complete: SessionUpdate = { kind: 'turn_complete', stopReason: 'end_turn' }
const tool: SessionUpdate = {
  kind: 'tool_call',
  call: { id: '1', name: 'shell', summary: 'ls', status: 'running', startedAt: 0 }
}

function user(text: string): TranscriptEntry {
  return { kind: 'message', id: `u-${text}`, role: 'user', text, at: 0 }
}

function agent(text: string): TranscriptEntry {
  return { kind: 'message', id: `a-${text}`, role: 'agent', text, at: 0 }
}

describe('pendingAfterSubmit', () => {
  it('reads a silent host as started', () => {
    expect(pendingAfterSubmit(undefined, 5)).toEqual({ phase: 'starting', since: 5 })
    expect(pendingAfterSubmit('started', 5)).toEqual({ phase: 'starting', since: 5 })
  })

  it('keeps what the host said about a busy session', () => {
    expect(pendingAfterSubmit('queued', 5).phase).toBe('queued')
    expect(pendingAfterSubmit('redirected', 5).phase).toBe('redirected')
  })

  it('carries a notice that beat the acknowledgement into the start', () => {
    expect(pendingAfterSubmit('started', 5, 'Compacting context')).toEqual({
      phase: 'starting',
      since: 5,
      notice: 'Compacting context'
    })
    expect(pendingAfterSubmit('queued', 5, 'Compacting context')).toEqual({ phase: 'queued', since: 5 })
  })
})

describe('a message still being sent', () => {
  const sending: PendingTurn = { phase: 'sending', since: 0 }

  it('shows a notice the host raised before answering the submit', () => {
    // The host takes the turn up — and may start compacting for it — as soon
    // as it accepts the prompt, before the submit's answer is back.
    const noticed = pendingAfterUpdate(sending, { kind: 'notice', text: 'Compacting context' })

    expect(noticed).toEqual({ phase: 'sending', since: 0, notice: 'Compacting context' })
    expect(describePending(noticed as PendingTurn)).toBe('Compacting context')
    expect(describePending(sending)).toBe('Sending…')
  })
})

describe('a message the host is starting', () => {
  const starting: PendingTurn = { phase: 'starting', since: 0 }

  it('stays through the turn starting, since nothing has arrived', () => {
    expect(pendingAfterUpdate(starting, started)).toBe(starting)
  })

  it('ends on the first content of any kind', () => {
    expect(pendingAfterUpdate(starting, chunk)).toBeNull()
    expect(pendingAfterUpdate(starting, thought)).toBeNull()
    expect(pendingAfterUpdate(starting, tool)).toBeNull()
  })

  it('ends when the turn halts on you', () => {
    const halted: SessionUpdate = {
      kind: 'clarify_request',
      req: { id: 'q', sessionId: 's', question: '?', choices: [], multiSelect: false }
    }

    expect(pendingAfterUpdate(starting, halted)).toBeNull()
  })

  it('carries the host’s slow-start notice', () => {
    const noticed = pendingAfterUpdate(starting, { kind: 'notice', text: 'Still starting the agent' })

    expect(noticed).toEqual({ phase: 'starting', since: 0, notice: 'Still starting the agent' })
    expect(describePending(noticed as PendingTurn)).toBe('Still starting the agent')
  })

  it('returns the same object when nothing changes', () => {
    // A state updater that always returns a new object re-renders per token.
    expect(pendingAfterUpdate(starting, { kind: 'usage', usage: { inputTokens: 1, outputTokens: 1 } })).toBe(starting)
  })
})

describe('a message queued behind the running turn', () => {
  const queued: PendingTurn = { phase: 'queued', since: 0 }

  it('outlives the current turn’s content', () => {
    expect(pendingAfterUpdate(queued, chunk)).toBe(queued)
    expect(pendingAfterUpdate(queued, tool)).toBe(queued)
  })

  it('starts when the current turn completes, because that is when the host drains its queue', () => {
    expect(pendingAfterUpdate(queued, complete)?.phase).toBe('starting')
  })
})

describe('a message folded into the running turn', () => {
  const redirected: PendingTurn = { phase: 'redirected', since: 0 }

  it('outlives the text the model is already producing', () => {
    expect(pendingAfterUpdate(redirected, chunk)).toBe(redirected)
  })

  it('is consumed by the model’s next call', () => {
    expect(pendingAfterUpdate(redirected, tool)).toBeNull()
    expect(pendingAfterUpdate(redirected, started)).toBeNull()
    expect(pendingAfterUpdate(redirected, complete)).toBeNull()
  })
})

describe('pendingLooksStale', () => {
  const starting: PendingTurn = { phase: 'starting', since: 1_000 }

  it('keeps waiting on an unanswered message', () => {
    expect(pendingLooksStale(starting, [user('hi')], 2_000)).toBe(false)
  })

  it('is over once the reply is in the transcript', () => {
    expect(pendingLooksStale(starting, [user('hi'), agent('hello')], 2_000)).toBe(true)
  })

  it('gives up after long enough regardless', () => {
    expect(pendingLooksStale(starting, [user('hi')], 1_000 + PENDING_STALE_AFTER_MS + 1)).toBe(true)
  })
})

describe('shouldRequeue', () => {
  it('requeues only failures that are the socket', () => {
    expect(shouldRequeue(new Error('Hermes gateway is not connected'))).toBe(true)
    expect(shouldRequeue(new Error('Hermes gateway connection closed'))).toBe(true)
  })

  it('does not retry an answer from the host', () => {
    expect(shouldRequeue(new Error('session not found'))).toBe(false)
    expect(shouldRequeue(new Error('request timed out after 1800s: prompt.submit'))).toBe(false)
  })
})

describe('alreadyLanded', () => {
  it('sees a message the host persisted before the socket died', () => {
    expect(alreadyLanded([user('a'), agent('b'), user('fix the test')], 'fix the test ')).toBe(true)
  })

  it('does not match an older message of the same text', () => {
    expect(alreadyLanded([user('again'), agent('done'), user('other')], 'again')).toBe(false)
  })

  it('cannot know without a transcript', () => {
    expect(alreadyLanded(null, 'x')).toBe(false)
  })
})
