import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { AgentBackend, KanbanCardSummary } from '@/domain'

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
