/**
 * Which sessions are halted waiting on you (§7.1, §7.6).
 *
 * The list endpoint has no such flag — `toSessionSummary` sets `blockedOn` to
 * null for every row — so the sidebar's "waiting" mark and the Sessions
 * screen's strip only ever showed against the mock. This is the overlay those
 * rows were always meant to get, from the two places that actually know:
 *
 * - **The live stream**, through the agent-wide tap: `approval.request` and
 *   `clarify.request` mark a session, and the events that end the wait — the
 *   held tool completing, the turn ending — clear it. This sees every session
 *   bound to the socket, open on screen or not.
 * - **The open chat**, which holds the request the resume snapshot restored
 *   (the stream never carried that one) and the answer you gave.
 *
 * What it cannot see is a session answered on the desktop while this phone
 * was asleep: no event reaches a socket that was down. The host's "answered
 * elsewhere" push covers the approval case; a clarify has no such push, and
 * its mark goes when the session next says anything.
 *
 * Keyed by scope as the query cache is: session ids are unique within a
 * profile, not across them.
 */

import { useEffect } from 'react'
import { create } from 'zustand'

import type { AgentBackend, BlockedReason, EventRecord, SessionId, SessionSummary } from '@/domain'

import { forgetAnnouncement, notificationKey } from './notification-ledger'

export type BlockedSessions = Readonly<Record<SessionId, BlockedReason>>

interface BlockedState {
  byScope: Readonly<Record<string, BlockedSessions>>
  mark: (scope: string, id: SessionId, reason: BlockedReason) => void
  clear: (scope: string, id: SessionId) => void
}

const NONE: BlockedSessions = Object.freeze({})

export const useBlockedStore = create<BlockedState>(set => ({
  byScope: {},

  mark(scope, id, reason) {
    set(state => {
      const current = state.byScope[scope] ?? NONE

      if (current[id] === reason) return state

      return { byScope: { ...state.byScope, [scope]: { ...current, [id]: reason } } }
    })
  },

  clear(scope, id) {
    set(state => {
      const current = state.byScope[scope]

      if (!current || !(id in current)) return state

      const { [id]: _gone, ...rest } = current

      return { byScope: { ...state.byScope, [scope]: rest } }
    })
  }
}))

/** The blocked sessions of one scope. Stable while nothing changes. */
export function useBlockedSessions(scope: string): BlockedSessions {
  return useBlockedStore(state => state.byScope[scope] ?? NONE)
}

/**
 * Lay the marks over a fetched list.
 *
 * Returns the rows untouched when nothing is marked, so the common case costs
 * the list no re-render and no new array.
 */
export function overlayBlocked(rows: SessionSummary[], blocked: BlockedSessions): SessionSummary[] {
  if (Object.keys(blocked).length === 0) return rows

  return rows.map(row => {
    const reason = blocked[row.id] ?? null

    return row.blockedOn === reason ? row : { ...row, blockedOn: reason }
  })
}

export type BlockedTransition = { kind: 'mark'; reason: BlockedReason } | { kind: 'clear' }

/** Events that end a wait: the held tool moved on, or the turn is over. */
const CLEARING: ReadonlySet<string> = new Set(['tool.complete', 'message.complete', 'background.complete', 'error'])

/**
 * What one event says about whether its session is waiting on you.
 *
 * Pure, so the policy is testable without a socket: a request marks, the end
 * of the wait clears, and everything else — deltas, tool starts, status — says
 * nothing either way.
 */
export function blockedTransition(record: EventRecord): BlockedTransition | null {
  if (record.name === 'approval.request') {
    const command = String((record.payload as { command?: unknown } | undefined)?.command ?? '')

    return { kind: 'mark', reason: /^\s*sudo\b/.test(command) ? 'sudo' : 'approval' }
  }

  if (record.name === 'clarify.request') return { kind: 'mark', reason: 'clarify' }
  if (CLEARING.has(record.name)) return { kind: 'clear' }

  return null
}

/**
 * Keep the marks current from the live stream.
 *
 * Mounted once, at the root, beside the session list sync: it has to see
 * events for sessions no screen has open, which is the whole point.
 */
export function useBlockedSessionsSync(scope: string, backend: AgentBackend | null): void {
  useEffect(() => {
    if (!backend) return

    return backend.subscribeEvents((record: EventRecord) => {
      if (!record.sessionId) return

      const transition = blockedTransition(record)

      if (!transition) return

      if (transition.kind === 'mark') {
        useBlockedStore.getState().mark(scope, record.sessionId, transition.reason)

        return
      }

      useBlockedStore.getState().clear(scope, record.sessionId)

      // A clarify is announced under its session (see `notification-copy`),
      // so the wait ending is what lets the next question in that session
      // ring again.
      forgetAnnouncement(notificationKey('clarify', record.sessionId))
    })
  }, [scope, backend])
}
