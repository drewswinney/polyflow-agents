/**
 * Which events are worth refetching the session list for.
 *
 * The newest chat was missing from the sidebar because nothing refetched the
 * list after its first turn; the decision of *what* counts as that is the
 * part worth pinning.
 */

import { describe, it, expect } from '@jest/globals'

import type { EventRecord } from '@/domain'
import { touchesSessionList } from '@/state/session-list-sync'

function event(name: string): EventRecord {
  return { id: `${name}:1`, at: 1_000, name, detail: '', status: 'info', sessionId: 's1' }
}

describe('touchesSessionList', () => {
  it('refetches when a turn ends, by either event the host sends for it', () => {
    expect(touchesSessionList(event('message.complete'))).toBe(true)
    expect(touchesSessionList(event('background.complete'))).toBe(true)
  })

  it('leaves the list alone for everything that happens during a turn', () => {
    for (const name of ['message.start', 'message.delta', 'message.interim', 'tool.start', 'tool.end']) {
      expect(touchesSessionList(event(name))).toBe(false)
    }
  })

  it('does not refetch for a blocked turn — the row has not changed yet', () => {
    expect(touchesSessionList(event('approval.request'))).toBe(false)
    expect(touchesSessionList(event('clarify.request'))).toBe(false)
  })
})
