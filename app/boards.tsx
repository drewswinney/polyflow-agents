import { useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { KanbanCardSummary, KanbanColumn } from '@/domain'
import { useSelectedAgent } from '@/state/agents'
import { useBackend, useConnectionFault, useConnectionState } from '@/state/ConnectionProvider'
import { useKanbanBoard } from '@/state/boards'
import { useSidebar } from '@/state/sidebar'
import { Card } from '@/ui/components/Card'
import { KanbanCardDetail } from '@/ui/components/KanbanCardDetail'
import { KanbanCardTile } from '@/ui/components/KanbanCardTile'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { statusTone } from '@/ui/kanban'
import { useTheme } from '@/ui/ThemeProvider'

/** Gap between columns, and the horizontal padding the board sits in. */
const COLUMN_GAP = 12
const BOARD_INSET = 16

export default function BoardsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const connection = useConnectionState()
  const fault = useConnectionFault()
  const openSidebar = useSidebar(store => store.show)
  const [selectedCard, setSelectedCard] = useState<KanbanCardSummary | null>(null)

  const supportsBoards = backend?.capabilities.extras.boards === true
  const board = useKanbanBoard(agent.scope ?? '', backend)
  // Every column, empty ones included: a board with a hole where "Testing"
  // should be reads as a parse failure, and the empty state is information.
  const columns = useMemo(() => board.data?.columns ?? [], [board.data])
  const cardCount = useMemo(() => columns.reduce((sum, column) => sum + column.cards.length, 0), [columns])

  // Wide enough to read a title, narrow enough that the next column peeks —
  // the peek is what says "swipe" without a hint or a pager dot.
  const columnWidth = Math.min(320, Math.max(232, width - BOARD_INSET * 2 - 44))

  const loadError = board.error
    ? String((board.error as Error).message)
    : !backend && connection === 'error'
      ? (fault.error ?? 'Not connected.')
      : null

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Boards" onMenu={openSidebar} />

      {!supportsBoards ? (
        <MessagePane>
          <MessageCard title="Boards unavailable" body="This agent does not expose a kanban board endpoint." />
        </MessagePane>
      ) : board.data ? (
        <View style={styles.board}>
          <View style={styles.hero}>
            <Text variant="secondary" style={styles.source} numberOfLines={1}>
              {board.data.source}
            </Text>
            <Text variant="screenTitle">{board.data.title}</Text>
            <Text variant="secondary">
              {cardCount} cards across {columns.length} columns
            </Text>
          </View>

          <ScrollView
            horizontal
            style={styles.columnScroller}
            showsHorizontalScrollIndicator={false}
            // Snapping to one column-plus-gap is what makes a swipe land on a
            // column rather than halfway between two.
            snapToInterval={columnWidth + COLUMN_GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={styles.columnRow}
          >
            {columns.map(column => (
              <BoardColumn
                key={column.id}
                column={column}
                width={columnWidth}
                bottomInset={insets.bottom + 24}
                refreshing={board.isFetching}
                onRefresh={() => void board.refetch()}
                onOpenCard={setSelectedCard}
              />
            ))}
          </ScrollView>
        </View>
      ) : loadError ? (
        <MessagePane>
          <MessageCard title={`Could not load boards for ${agent.displayName}`} body={loadError} />
        </MessagePane>
      ) : (
        <ActivityIndicator color={theme.color.gray500} style={styles.loading} />
      )}

      <KanbanCardDetail card={selectedCard} onDismiss={() => setSelectedCard(null)} />
    </View>
  )
}

/**
 * One column: a fixed-width lane that scrolls on its own.
 *
 * The vertical scroll lives here rather than on the screen so a long backlog
 * does not drag the other columns' headers off the top — and each lane carries
 * its own `RefreshControl`, because pull-to-refresh cannot hang off the
 * horizontal scroller that holds them.
 */
function BoardColumn({
  column,
  width,
  bottomInset,
  refreshing,
  onRefresh,
  onOpenCard
}: {
  column: KanbanColumn
  width: number
  bottomInset: number
  refreshing: boolean
  onRefresh: () => void
  onOpenCard: (card: KanbanCardSummary) => void
}) {
  const theme = useTheme()
  const tone = statusTone(theme, String(column.id))

  return (
    <View style={[styles.column, { width }]}>
      <View style={styles.columnHeader}>
        <View style={[styles.statusDot, { backgroundColor: tone.text }]} />
        <Text variant="sectionHeader" style={styles.columnTitle} numberOfLines={1}>
          {column.title}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text variant="monoSmall" color={tone.text}>
            {column.cards.length}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.columnScroll}
        contentContainerStyle={[styles.cardStack, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.gray500} />
        }
      >
        {column.cards.length === 0 ? (
          <View style={[styles.emptyLane, { borderColor: theme.color.border }]}>
            <Text variant="secondary">Nothing here.</Text>
          </View>
        ) : (
          column.cards.map(card => <KanbanCardTile key={card.id} card={card} onPress={() => onOpenCard(card)} />)
        )}
      </ScrollView>
    </View>
  )
}

function MessagePane({ children }: { children: ReactNode }) {
  return <View style={styles.messagePane}>{children}</View>
}

function MessageCard({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.messageCard}>
      <Text variant="rowLabelStrong">{title}</Text>
      <Text variant="secondary">{body}</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  board: { flex: 1, gap: 12, paddingTop: 14 },
  loading: { marginTop: 24 },
  hero: { gap: 4, paddingHorizontal: BOARD_INSET },
  source: { maxWidth: '100%' },
  messagePane: { paddingHorizontal: BOARD_INSET, paddingTop: 14 },
  columnRow: { paddingHorizontal: BOARD_INSET, gap: COLUMN_GAP },
  columnScroller: { flex: 1 },
  // No `flex: 1`: in the row this sits in, that sets a horizontal basis of 0
  // and the fixed width stops meaning anything. Height comes from the content
  // container stretching its children, which is what `columnScroll` fills.
  column: { alignSelf: 'stretch' },
  columnScroll: { flex: 1 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  columnTitle: { flex: 1, minWidth: 0 },
  countBadge: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  cardStack: { gap: 8, paddingBottom: 24 },
  emptyLane: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14
  },
  messageCard: { padding: 14, gap: 4 }
})
