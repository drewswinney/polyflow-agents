import { useQuery } from '@tanstack/react-query'

import type { AgentBackend } from '@/domain'

export const kanbanBoardKey = (scope: string) => ['agent', scope, 'kanban-board'] as const

export function useKanbanBoard(scope: string, backend: AgentBackend | null) {
  return useQuery({
    queryKey: kanbanBoardKey(scope),
    enabled: Boolean(backend) && backend?.capabilities.extras.boards === true,
    queryFn: () => backend!.listKanbanBoard()
  })
}
