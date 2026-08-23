/**
 * Server state, keyed by agent scope (profile name).
 *
 * The backend uses agent.scope to fetch sessions, so query keys must use scope
 * to match what the backend actually queries. Session ids are only unique within
 * a backend, so a cache shared across agents would serve one agent's transcript
 * for another's id (§5.2). This is the cheap half of agent scoping — the
 * expensive half is remembering to do it everywhere.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AgentBackend, AgentId } from '@/domain'

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

export function useSessions(scope: string, backend: AgentBackend | null) {
  console.log('[useSessions] scope:', scope, 'backend:', backend ? 'present' : 'null')
  return useQuery({
    queryKey: sessionsKey(scope),
    enabled: Boolean(backend),
    queryFn: async () => {
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
