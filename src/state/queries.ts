/**
 * Server state, keyed by agent.
 *
 * Every key starts with the agent id: session ids are only unique within a
 * backend, so a cache shared across agents would serve one agent's transcript
 * for another's id (§5.2). This is the cheap half of agent scoping — the
 * expensive half is remembering to do it everywhere.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AgentBackend, AgentId } from '@/domain'

export const sessionsKey = (agentId: AgentId) => ['agent', agentId, 'sessions'] as const
export const searchKey = (agentId: AgentId, query: string) => ['agent', agentId, 'search', query] as const

export function useSessions(agentId: AgentId, backend: AgentBackend | null) {
  return useQuery({
    queryKey: sessionsKey(agentId),
    enabled: Boolean(backend),
    queryFn: () => backend!.listSessions({ limit: 50 })
  })
}

/**
 * Search is server-side. The session store is SQLite with FTS5, so filtering
 * the fetched page client-side would only ever search the page (§7.1).
 */
export function useSessionSearch(agentId: AgentId, backend: AgentBackend | null, query: string) {
  const trimmed = query.trim()

  return useQuery({
    queryKey: searchKey(agentId, trimmed),
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
export function useCreateSession(agentId: AgentId, backend: AgentBackend | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!backend) throw new Error('Not connected')

      return backend.createSession({ title: 'New session' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey(agentId) })
  })
}
