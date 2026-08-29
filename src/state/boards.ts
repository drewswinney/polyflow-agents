import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { AgentBackend, KanbanCardCreate, KanbanCardSummary, KanbanCardUpdate } from '@/domain'

export const kanbanBoardKey = (scope: string) => ['agent', scope, 'kanban-board'] as const

/**
 * The board for one agent.
 *
 * `active` is what the Chat screen uses to stay lazy: the board is only worth
 * fetching there once a message has actually named a card, and this hook is
 * mounted long before that happens (see `KanbanMentionProvider`). The Boards
 * screen leaves it alone — it is the board.
 */
export function useKanbanBoard(scope: string, backend: AgentBackend | null, active = true) {
  return useQuery({
    queryKey: kanbanBoardKey(scope),
    enabled: active && Boolean(backend) && backend?.capabilities.extras.boards === true,
    queryFn: () => backend!.listKanbanBoard(),
    // A ticket does not move between columns second by second, and a transcript
    // can hold a lot of mentions. One read per minute is plenty.
    staleTime: 60_000
  })
}

/**
 * Every card on the board, keyed by the slug the vault links it as.
 *
 * `[[expose-kanban-board-screen]]` in agent text and the card's `id` are the
 * same string, because the plugin derives one from the other — so resolving a
 * mention is a map lookup rather than a search.
 */
export function useKanbanCardIndex(
  scope: string,
  backend: AgentBackend | null,
  active = true
): Map<string, KanbanCardSummary> {
  const board = useKanbanBoard(scope, backend, active)

  return useMemo(() => {
    const index = new Map<string, KanbanCardSummary>()

    for (const column of board.data?.columns ?? []) {
      for (const card of column.cards) index.set(card.id, card)
    }

    return index
  }, [board.data])
}

/**
 * Edit (title/body) and/or move one card on the agent's board.
 *
 * The invalidation is the important half: the card the user just changed is
 * rendered by *every* mounted consumer of the board — its lane on the Boards
 * screen and any mention unfurl in an open chat — so all of them have to see
 * the new position, not just the one that fired the request.
 */
export function useKanbanCardUpdate(scope: string, backend: AgentBackend | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: KanbanCardUpdate }) => {
      if (!backend) throw new Error('Not connected')
      return backend.updateKanbanCard(id, update)
    },
    onSuccess: () => {
      // The host returns 200 on success; the card has already moved
      // server-side, so a refetch is what actually shows it.
      void queryClient.invalidateQueries({ queryKey: kanbanBoardKey(scope) })
    }
  })
}

/**
 * Add a card to the agent's board. The host lands it on the board's
 * not-yet-started lane (native `ready`, the app's Backlog) — the dispatcher
 * picks it up from there, the phone never assigns a worker.
 */
export function useKanbanCardCreate(scope: string, backend: AgentBackend | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (card: KanbanCardCreate) => {
      if (!backend) throw new Error('Not connected')
      return backend.createKanbanCard(card)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: kanbanBoardKey(scope) })
  })
}
