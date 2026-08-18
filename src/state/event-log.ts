/**
 * The live event log behind Activity and Logs & events (§7.5, §7.15).
 *
 * Bounded on purpose: a busy agent emits events faster than anyone reads them,
 * and an unbounded array on a phone is a memory leak with a UI in front of it.
 * Newest first, capped, and **cleared on agent switch** — nothing merges across
 * agents (§5.2).
 */

import { useEffect } from 'react'
import { create } from 'zustand'

import type { AgentBackend, AgentId, EventRecord } from '@/domain'

/** Roughly a few minutes of a busy agent; past that, `listEvents()` is the source. */
const MAX_RECORDS = 500

interface EventLogState {
  records: EventRecord[]
  /** The agent these records belong to, so a stale tail cannot leak across a switch. */
  agentId: AgentId | null
  append: (record: EventRecord) => void
  scopeTo: (agentId: AgentId) => void
}

export const useEventLog = create<EventLogState>(set => ({
  records: [],
  agentId: null,

  append(record) {
    set(state => ({ records: [record, ...state.records].slice(0, MAX_RECORDS) }))
  },

  scopeTo(agentId) {
    set(state => (state.agentId === agentId ? state : { agentId, records: [] }))
  }
}))

/**
 * Taps the backend's agent-wide event stream into the log.
 *
 * Mounted once, next to the connection, so events accumulate whether or not
 * Activity or Logs happens to be on screen — those screens open onto history,
 * not onto an empty list that starts filling as you watch.
 */
export function useEventLogTap(backend: AgentBackend | null, agentId: AgentId): void {
  const append = useEventLog(state => state.append)
  const scopeTo = useEventLog(state => state.scopeTo)

  useEffect(() => {
    scopeTo(agentId)
  }, [agentId, scopeTo])

  useEffect(() => {
    if (!backend) return

    return backend.subscribeEvents(append)
  }, [backend, append])
}

export type EventFilter = 'all' | 'tools' | 'approvals' | 'errors'

/** The filter chips on Logs & events. Matching is on the event name, not a tag. */
export function matchesFilter(record: EventRecord, filter: EventFilter): boolean {
  switch (filter) {
    case 'tools':
      return record.name.startsWith('tool.')
    case 'approvals':
      return record.name.startsWith('approval.') || record.name.startsWith('clarify.')
    case 'errors':
      return record.status === 'error'
    case 'all':
    default:
      return true
  }
}
