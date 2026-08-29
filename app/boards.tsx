import { useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { KanbanCardSummary, KanbanColumn } from '@/domain'
import { useSelectedAgent } from '@/state/agents'
import { useBackend, useConnectionFault, useConnectionState } from '@/state/ConnectionProvider'
import { useKanbanBoard, useKanbanCardCreate } from '@/state/boards'
import { useSidebar } from '@/state/sidebar'
import { Card } from '@/ui/components/Card'
import { KanbanCardDetail } from '@/ui/components/KanbanCardDetail'
import { KanbanCardTile } from '@/ui/components/KanbanCardTile'
import { IconButton } from '@/ui/components/IconButton'
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
  const [creating, setCreating] = useState(false)

  const supportsBoards = backend?.capabilities.extras.boards === true
  const board = useKanbanBoard(agent.scope ?? '', backend)
  const scope = agent.scope ?? ''
  const createCard = useKanbanCardCreate(scope, backend)
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
      <ScreenHeader
        title="Boards"
        onMenu={openSidebar}
        right={
          supportsBoards ? (
            <IconButton name="plus" slot={38} size={17} accessibilityLabel="New card" onPress={() => setCreating(true)} />
          ) : null
        }
      />

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

      <KanbanCardDetail
        card={selectedCard}
        onDismiss={() => setSelectedCard(null)}
        scope={scope}
        backend={backend}
        editable={supportsBoards}
      />

      {creating ? (
        <CreateCardSheet
          theme={theme}
          busy={createCard.isPending}
          error={createCard.error ? String(createCard.error.message) : null}
          onSubmit={(title, body) => {
            createCard.mutate({ title, body: body || undefined }, { onSuccess: () => setCreating(false) })
          }}
          onDismiss={() => setCreating(false)}
        />
      ) : null}
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

/**
 * New card from the phone: a title, an optional body, done. The card lands on
 * the board's not-yet-started lane (Backlog); the host's dispatcher owns
 * everything after that, so the sheet deliberately has no column or assignee
 * of its own — offering them would be a second source of truth for the same
 * state.
 */
function CreateCardSheet({
  theme,
  busy,
  error,
  onSubmit,
  onDismiss
}: {
  theme: ReturnType<typeof useTheme>
  busy: boolean
  error: string | null
  onSubmit: (title: string, body: string) => void
  onDismiss: () => void
}) {
  const insets = useSafeAreaInsets()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View
        style={[
          styles.sheetRoot,
          { backgroundColor: theme.color.scrim, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss new card" />
        <Card style={styles.sheetCard}>
          <Text variant="sheetTitle">New card</Text>
          <Text variant="secondary" style={styles.sheetSubtitle}>
            Lands in Backlog. The dispatcher picks it up from there.
          </Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={theme.color.gray400}
            maxLength={120}
            style={[
              styles.sheetInput,
              {
                borderColor: theme.color.border,
                backgroundColor: theme.color.bgSubtle,
                color: theme.color.gray900,
                fontFamily: theme.font.bodyMedium
              }
            ]}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Body — markdown is fine"
            placeholderTextColor={theme.color.gray400}
            multiline
            style={[
              styles.sheetInput,
              styles.sheetBodyInput,
              {
                borderColor: theme.color.border,
                backgroundColor: theme.color.bgSubtle,
                color: theme.color.gray800,
                fontFamily: theme.font.body
              }
            ]}
          />

          {error ? (
            <Text variant="secondary" color={theme.color.error700}>
              {error}
            </Text>
          ) : null}

          <View style={styles.sheetActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel new card"
              disabled={busy}
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.sheetButton,
                { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, opacity: pressed ? 0.6 : 1 }
              ]}
            >
              <Text variant="rowLabelStrong" color={theme.color.gray600}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create card"
              disabled={busy || !title.trim()}
              onPress={() => onSubmit(title.trim(), body)}
              style={({ pressed }) => [
                styles.sheetButton,
                {
                  backgroundColor: busy || !title.trim() ? theme.color.bgSubtle : theme.color.accentFill,
                  borderColor: busy || !title.trim() ? theme.color.border : theme.color.accentFill,
                  opacity: pressed ? 0.8 : 1
                }
              ]}
            >
              <Text variant="rowLabelStrong" color={busy || !title.trim() ? theme.color.gray400 : theme.color.onAccent}>
                {busy ? 'Creating…' : 'Create'}
              </Text>
            </Pressable>
          </View>
        </Card>
      </View>
    </Modal>
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
  messageCard: { padding: 14, gap: 4 },
  sheetRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  sheetCard: { padding: 16, gap: 12, maxHeight: '82%' },
  sheetSubtitle: { marginTop: -6 },
  sheetInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  sheetBodyInput: { minHeight: 140, textAlignVertical: 'top' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  sheetButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9
  }
})
