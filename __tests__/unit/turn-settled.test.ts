/**
 * When a refetch is allowed to say a turn is over.
 *
 * `turnActive` is cleared by `turn_complete`, which arrives on the stream — so
 * a turn that finished while the socket was down cleared nothing, and the
 * composer went on offering Stop for a turn that was long over. The refetch is
 * what closes that gap, and this decides when it may speak.
 *
 * Every `false` here is a case where the live stream still has something to
 * say, and the refetch must not contradict it.
 */

import { describe, it, expect } from '@jest/globals'

import type { ToolCall, TranscriptEntry } from '@/domain'
import { turnLooksSettled, type TurnEvidence } from '@/state/turn-settled'

const settled: TurnEvidence = {
  connectionState: 'open',
  streaming: false,
  entries: [],
  transcript: { pendingApproval: null, pendingClarify: null }
}

function tool(status: ToolCall['status']): TranscriptEntry {
  return {
    kind: 'tool',
    id: 'tool-1',
    call: { id: '1', name: 'shell', summary: 'ls', status, startedAt: 0 }
  }
}

describe('turnLooksSettled', () => {
  it('settles a turn that ended while nothing was watching', () => {
    // The reported bug: backgrounded, the turn finished, `turn_complete` died
    // with the socket, and the reply came back only on the refetch.
    expect(turnLooksSettled(settled)).toBe(true)
  })

  it('says nothing while disconnected', () => {
    // The turn may still be running where we cannot see it, and Stop is
    // unusable anyway — cancelling needs the socket.
    for (const connectionState of ['closed', 'error', 'connecting', 'idle'] as const) {
      expect(turnLooksSettled({ ...settled, connectionState })).toBe(false)
    }
  })

  it('says nothing while a reply is arriving', () => {
    expect(turnLooksSettled({ ...settled, streaming: true })).toBe(false)
  })

  it('treats a turn halted on you as alive', () => {
    const approval = { id: 'r1', sessionId: 's1', tool: 'shell', command: 'rm', description: '', sudo: false, allowPermanent: true, expiresAt: null }

    expect(turnLooksSettled({ ...settled, transcript: { pendingApproval: approval, pendingClarify: null } })).toBe(false)
  })

  it('treats a question the same way', () => {
    const clarify = { id: 'r2', sessionId: 's1', question: 'which?', choices: [], multiSelect: false }

    expect(turnLooksSettled({ ...settled, transcript: { pendingApproval: null, pendingClarify: clarify } })).toBe(false)
  })

  it('keeps Stop through a long tool run', () => {
    // The case that matters most: minutes can pass with no tokens, and that is
    // exactly when someone reaches for cancel.
    expect(turnLooksSettled({ ...settled, entries: [tool('running')] })).toBe(false)
    expect(turnLooksSettled({ ...settled, entries: [tool('pending')] })).toBe(false)
  })

  it('settles once the tools have finished', () => {
    for (const status of ['ok', 'error'] as const) {
      expect(turnLooksSettled({ ...settled, entries: [tool(status)] })).toBe(true)
    }
  })

  it('settles over a tool a drop left unknown', () => {
    // A drop marks in-flight tools `unknown` (§7.16). That is the app declining
    // to guess about the *tool*; it must not also strand the turn.
    expect(turnLooksSettled({ ...settled, entries: [tool('unknown')] })).toBe(true)
  })

  it('ignores entries that are not tools', () => {
    const message: TranscriptEntry = { kind: 'message', id: 'm1', role: 'agent', text: 'done', at: 0 }

    expect(turnLooksSettled({ ...settled, entries: [message] })).toBe(true)
  })
})
