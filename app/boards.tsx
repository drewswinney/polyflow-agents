import { useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
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
import { Icon } from '@/ui/components/Icon'
import { IconButton } from '@/ui/components/IconButton'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { Markdown } from '@/ui/markdown/Markdown'
import { useTheme } from '@/ui/ThemeProvider'
import type { Theme } from '@/ui/theme'

/** Gap between columns, and the horizontal padding the board sits in. */
const COLUMN_GAP = 12
const BOARD_INSET = 16

/**
 * A column's tone comes from the **status ramp**, not the agent accent.
 *
 * The accent (`secondary*`) marks what belongs to the selected agent — the
 * pill, the composer, the sidebar. A board column is not the agent's identity,
 * it is a state a ticket is in, so it reads off the same info/warning/success
 * tokens `ToolCard` uses. That keeps this screen in the app's palette instead
 * of washing it violet.
 */
function statusTone(theme: Theme, status: string): { text: string; bg: string; border: string } {
  switch (status) {
    case 'in_progress':
      return { text: theme.color.info700, bg: theme.color.info50, border: theme.color.info200 }
    case 'testing':
      return { text: theme.color.warning700, bg: theme.color.warning50, border: theme.color.warning200 }
    case 'done':
      return { text: theme.color.success700, bg: theme.color.success50, border: theme.color.success200 }
    default:
      return { text: theme.color.gray600, bg: theme.color.bgSubtle, border: theme.color.border }
  }
}

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

      <CardModal card={selectedCard} onDismiss={() => setSelectedCard(null)} />
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
          column.cards.map(card => <KanbanCard key={card.id} card={card} onPress={() => onOpenCard(card)} />)
        )}
      </ScrollView>
    </View>
  )
}

function KanbanCard({ card, onPress }: { card: KanbanCardSummary; onPress: () => void }) {
  const theme = useTheme()
  const chips = [card.risk ? `risk:${card.risk}` : null, card.branch, card.pr].filter(Boolean) as string[]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.kanbanCard,
        theme.shadow.card,
        {
          borderRadius: theme.radius.card,
          borderColor: theme.color.border,
          backgroundColor: pressed ? theme.color.bgSubtle : theme.color.surface
        }
      ]}
    >
      <View style={styles.cardTopRow}>
        <Text variant="rowLabelStrong" numberOfLines={3} style={styles.cardTitle}>
          {card.title}
        </Text>
        <Icon
          name={card.checked ? 'circle-check' : 'circle'}
          size={12}
          color={card.checked ? theme.color.success700 : theme.color.gray400}
        />
      </View>

      {card.description ? (
        <Text variant="secondary" numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}

      {chips.length > 0 ? (
        <View style={styles.chipRow}>
          {chips.map(chip => (
            <View
              key={chip}
              style={[styles.chip, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border }]}
            >
              <Text variant="monoSmall" color={theme.color.gray600} numberOfLines={1}>
                {chip}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
}

function CardModal({ card, onDismiss }: { card: KanbanCardSummary | null; onDismiss: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  if (!card) return null

  const details = [
    ['Status', card.statusLabel],
    ['Risk', card.risk],
    ['Branch', card.branch],
    ['PR', card.pr]
  ].filter(([, value]) => Boolean(value))

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View
        style={[
          styles.modalRoot,
          { backgroundColor: theme.color.scrim, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close card details" />
        <Card style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text variant="sectionHeader">{card.statusLabel}</Text>
              <Text variant="sheetTitle">{card.title}</Text>
            </View>
            <IconButton name="xmark" accessibilityLabel="Close card details" onPress={onDismiss} />
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            {details.length > 0 ? (
              <View style={styles.detailGrid}>
                {details.map(([label, value]) => (
                  <View
                    key={label}
                    style={[styles.detailPill, { borderColor: theme.color.border, backgroundColor: theme.color.bgSubtle }]}
                  >
                    <Text variant="sectionHeader">{label}</Text>
                    <Text variant="secondary" numberOfLines={1}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* The ticket body is markdown on disk, so it renders as markdown
                here — same component the transcript uses, so a heading, a
                checklist and a fenced block land in the app's type scale
                rather than arriving as one wall of escaped text. The
                description is the body's first prose line, so showing both
                would just repeat it. */}
            {card.body ? (
              <Markdown source={card.body} />
            ) : card.description ? (
              <Text variant="body">{card.description}</Text>
            ) : (
              <Text variant="secondary">No ticket file for this card.</Text>
            )}
          </ScrollView>
        </Card>
      </View>
    </Modal>
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
  kanbanCard: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, minWidth: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 1 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' },
  messageCard: { padding: 14, gap: 4 },
  modalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  modalCard: { maxHeight: '82%' },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  modalTitleWrap: { flex: 1, minWidth: 0, gap: 4 },
  modalBody: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailPill: {
    minWidth: '46%',
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  }
})
