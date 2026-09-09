/**
 * The overlay that gives the session lists their "waiting" mark.
 *
 * The list endpoint has no blocked flag, so everything the mark knows comes
 * from these two policies: what one event says about a session's wait, and how
 * the marks are laid over fetched rows.
 */

import { describe, it, expect } from '@jest/globals'

import type { EventRecord, SessionSummary } from '@/domain'
import { blockedTransition, overlayBlocked } from '@/state/blocked-sessions'

function record(name: string, payload?: unknown): EventRecord {
  return { id: `${name}:1`, at: 1_000, name, detail: '', status: 'info', sessionId: 's1', payload }
}

function row(id: string, blockedOn: SessionSummary['blockedOn'] = null): SessionSummary {
  return { id, title: id, preview: '', updatedAt: 0, pinned: false, unread: false, model: null, messageCount: 1, blockedOn }
}

describe('blockedTransition', () => {
  it('marks a session on an approval, naming sudo when the command is one', () => {
    expect(blockedTransition(record('approval.request', { command: 'ls' }))).toEqual({ kind: 'mark', reason: 'approval' })
    expect(blockedTransition(record('approval.request', { command: '  sudo rm x' }))).toEqual({ kind: 'mark', reason: 'sudo' })
  })

  it('marks a session on a question', () => {
    expect(blockedTransition(record('clarify.request', { question: 'Which?' }))).toEqual({ kind: 'mark', reason: 'clarify' })
  })

  it('clears when the held tool moves on or the turn ends', () => {
    for (const name of ['tool.complete', 'message.complete', 'background.complete', 'error']) {
      expect(blockedTransition(record(name))).toEqual({ kind: 'clear' })
    }
  })

  it('says nothing for the rest of the stream', () => {
    for (const name of ['message.delta', 'tool.start', 'status.update', 'session.usage']) {
      expect(blockedTransition(record(name))).toBeNull()
    }
  })
})

describe('overlayBlocked', () => {
  it('hands the rows back untouched when nothing is marked', () => {
    const rows = [row('a'), row('b')]

    expect(overlayBlocked(rows, {})).toBe(rows)
  })

  it('marks the rows that are waiting and leaves the others as they were', () => {
    const rows = [row('a'), row('b')]
    const [a, b] = overlayBlocked(rows, { a: 'approval' })

    expect(a.blockedOn).toBe('approval')
    expect(b).toBe(rows[1])
  })

  it('does not disturb a row already carrying the same mark', () => {
    const rows = [row('a', 'clarify')]

    expect(overlayBlocked(rows, { a: 'clarify' })[0]).toBe(rows[0])
  })
})
