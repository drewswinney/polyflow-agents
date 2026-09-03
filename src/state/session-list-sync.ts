/**
 * Keeping the session list current (§7.17).
 *
 * The sidebar's Recent list reads the same query as the Sessions screen, but
 * the sidebar is mounted once above the router and never remounts, so nothing
 * ever asked it to refetch: React Native has no window focus for React Query
 * to refetch on, and no screen change touches a component that never leaves.
 * The one invalidation it got — from creating a session — landed before that
 * session had a message, and the list is fetched with `min_messages=1`, so the
 * row it was meant to reveal was not in the response. Once the first turn had
 * actually landed, nothing looked again. The newest conversation was the one
 * the sidebar could not show.
 *
 * Two triggers, both cheap against a list of fifty rows:
 *
 * - **A finished turn.** That is when the host's row changes — message count,
 *   last activity, the title it derives from the first message — so it is when
 *   the list is worth reading again. Coalesced, because the host sends
 *   `background.complete` and `message.complete` for one turn.
 * - **Opening the sidebar**, if what it holds is stale. The list is only ever
 *   looked at there and on Sessions, and Sessions refetches on mount already.
 *   This covers what the socket did not carry: a turn that ended while the app
 *   was asleep, a rename from the desktop.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { AgentBackend, EventRecord } from '@/domain'

import { sessionsKey } from './queries'
import { useSidebar } from './sidebar'

/** Long enough to fold one turn's two completion events into one fetch. */
const COALESCE_MS = 300

/**
 * Whether an event means the session list has changed on the host.
 *
 * A finished turn, and only that. A started turn changes nothing the list
 * shows, and a delta is one of hundreds; the row is rewritten when the turn's
 * messages are flushed, which is done by the time completion is announced.
 */
export function touchesSessionList(record: EventRecord): boolean {
  return record.name === 'message.complete' || record.name === 'background.complete'
}

export function useSessionListSync(scope: string, backend: AgentBackend | null): void {
  const queryClient = useQueryClient()
  const open = useSidebar(state => state.open)

  useEffect(() => {
    if (!backend) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = backend.subscribeEvents((record: EventRecord) => {
      if (!touchesSessionList(record)) return
      if (timer) return

      timer = setTimeout(() => {
        timer = null
        void queryClient.invalidateQueries({ queryKey: sessionsKey(scope) })
      }, COALESCE_MS)
    })

    return () => {
      unsubscribe()

      if (timer) clearTimeout(timer)
    }
  }, [backend, scope, queryClient])

  useEffect(() => {
    if (!open || !backend) return

    // `stale: true`: a list fetched within its `staleTime` is left alone, so
    // opening the drawer twice in a row is not two requests.
    void queryClient.refetchQueries({ queryKey: sessionsKey(scope), stale: true })
  }, [open, backend, scope, queryClient])
}
