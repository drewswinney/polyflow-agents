/**
 * Server state, keyed by agent scope (profile name).
 *
 * The backend uses agent.scope to fetch sessions, so query keys must use scope
 * to match what the backend actually queries. Session ids are only unique within
 * a backend, so a cache shared across agents would serve one agent's transcript
 * for another's id (§5.2). This is the cheap half of agent scoping — the
 * expensive half is remembering to do it everywhere.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AgentBackend, AgentId, SessionId, SessionTranscript } from '@/domain'

/**
 * The prefix every agent-scoped key starts with.
 *
 * For the one case that has to reach past a single agent: switching. React
 * Query matches keys by prefix, so this invalidates every agent's cache at
 * once — which is the point, because the rows that were stale belong to the
 * agent you are *leaving*, not the one you are selecting.
 */
export const agentScopeKey = ['agent'] as const

/**
 * Query keys use agent scope (profile name) instead of agent id.
 *
 * The backend's dialKey includes agent.scope to determine which identity's
 * data to fetch. If query keys use agent.id instead, switching between agents
 * with swapped scopes results in cached data being served from the wrong agent.
 *
 * Example: Agent A (id="default", scope="greg") fetches greg's sessions but
 * caches under "default". Agent B (id="Greg", scope="default") fetches
 * default's sessions but caches under "Greg". Result: sessions appear swapped.
 */
export const sessionsKey = (scope: string) => ['agent', scope, 'sessions'] as const
export const searchKey = (scope: string, query: string) => ['agent', scope, 'search', query] as const
export const transcriptKey = (scope: string, id: SessionId) => ['agent', scope, 'transcript', id] as const

export function useSessions(scope: string, backend: AgentBackend | null) {
  const queryKey = useMemo(() => sessionsKey(scope), [scope])
  console.log('[useSessions] scope:', scope, 'backend:', backend ? 'present' : 'null', 'queryKey:', JSON.stringify(queryKey))
  return useQuery({
    queryKey,
    enabled: Boolean(backend),
    queryFn: async () => {
      console.log('[useSessions] queryFn executing for scope:', scope)
      const result = await backend!.listSessions({ limit: 50 })
      console.log('[useSessions] fetched', result.length, 'sessions for scope:', scope)
      return result
    }
  })
}

/**
 * Search is server-side. The session store is SQLite with FTS5, so filtering
 * the fetched page client-side would only ever search the page (§7.1).
 */
export function useSessionSearch(scope: string, backend: AgentBackend | null, query: string) {
  const trimmed = query.trim()

  return useQuery({
    queryKey: searchKey(scope, trimmed),
    enabled: Boolean(backend) && trimmed.length > 1,
    queryFn: () => backend!.searchSessions(trimmed)
  })
}

/**
 * One session's transcript, cached so reopening a chat does not start over.
 *
 * Chat used to fetch this itself, in an effect, with nothing holding the result
 * past the screen. Every way back into a conversation — the back gesture, the
 * sidebar, a notification — was therefore a fresh mount with an empty
 * transcript and a full-screen spinner over a conversation the app had shown a
 * moment earlier. The query cache outlives the screen, so the second visit
 * paints immediately.
 *
 * **Cached, never authoritative.** `staleTime: 0` and `refetchOnMount: always`
 * are the point of this rather than a tuning choice: the delta stream is not
 * resumable (§5.4), so refetching the transcript is the *only* thing that
 * closes the gap left by a disconnect. A cache that satisfied the read instead
 * of merely painting during it would show a chat silently missing the turn that
 * happened while you were away — which is worse than the spinner it saved, and
 * far harder to notice. What the cache buys is what is on screen *while* the
 * fetch runs, and nothing else.
 *
 * Keyed by scope for the reason at the top of this file: session ids are unique
 * within a backend, not across them.
 */
export function useTranscript(scope: string, backend: AgentBackend | null, id: SessionId) {
  const queryKey = useMemo(() => transcriptKey(scope, id), [scope, id])

  return useQuery<SessionTranscript>({
    queryKey,
    enabled: Boolean(backend),
    queryFn: () => backend!.loadSession(id),
    // Both deliberate; see above. Neither is a knob to turn down.
    staleTime: 0,
    refetchOnMount: 'always',
    // Held well past React Query's five-minute default, because five minutes is
    // short for the thing this exists to do: coming back to a conversation
    // later in the same sitting is exactly when the spinner was most annoying.
    // The cost is transcripts for sessions nobody has open sitting in memory —
    // text, and bounded by how many you actually visited, since images live in
    // the attachment cache on disk rather than in these rows.
    gcTime: 30 * 60 * 1000
  })
}

/**
 * Start a session and hand back its id.
 *
 * Shared rather than inlined because two places create sessions — the Sessions
 * screen and the sidebar — and the invalidation is the easy half to forget: a
 * new session that is not in the list is a session you cannot get back to.
 */
export function useCreateSession(scope: string, backend: AgentBackend | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!backend) throw new Error('Not connected')

      return backend.createSession({ title: 'New session' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey(scope) })
  })
}
