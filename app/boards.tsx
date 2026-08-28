import { useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
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
import { useTheme } from '@/ui/ThemeProvider'

export default function BoardsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const connection = useConnectionState()
  const fault = useConnectionFault()
  const openSidebar = useSidebar(store => store.show)
  const [selectedCard, setSelectedCard] = useState<KanbanCardSummary | null>(null)

  const board = useKanbanBoard(agent.scope ?? '', backend)
  const columns = useMemo(() => board.data?.columns.filter(column => column.cards.length > 0) ?? [], [board.data])
  const emptyColumns = useMemo(() => board.data?.columns.filter(column => column.cards.length === 0) ?? [], [board.data])

  const loadError = board.error
    ? String((board.error as Error).message)
    : !backend && connection === 'error'
      ? (fault.error ?? 'Not connected.')
      : null

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Boards" onMenu={openSidebar} />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={board.isFetching} onRefresh={() => void board.refetch()} />}
      >
        {!backend?.capabilities.extras.boards ? (
          <MessageCard title="Boards unavailable" body="This agent does not expose a kanban board endpoint." />
        ) : board.data ? (
          <>
            <View style={styles.hero}>
              <Text variant="secondary" style={styles.source} numberOfLines={1}>
                {board.data.source}
              </Text>
              <Text variant="screenTitle">{board.data.title}</Text>
              <Text variant="secondary">
                {board.data.columns.reduce((sum, column) => sum + column.cards.length, 0)} cards across {board.data.columns.length} columns
              </Text>
            </View>

            {columns.length === 0 ? (
              <MessageCard title="No cards yet" body="The board is reachable, but no kanban cards were found." />
            ) : (
              columns.map(column => <BoardColumn key={column.id} column={column} onOpenCard={setSelectedCard} />)
            )}

            {emptyColumns.length > 0 ? (
              <View style={styles.emptyColumnList}>
                <Text variant="sectionHeader">Empty columns</Text>
                <View style={styles.emptyPills}>
                  {emptyColumns.map(column => (
                    <View
                      key={column.id}
                      style={[styles.emptyPill, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border }]}
                    >
                      <Text variant="pill">{column.title}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : loadError ? (
          <MessageCard title={`Could not load boards for ${agent.displayName}`} body={loadError} />
        ) : (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        )}
      </ScrollView>

      <CardModal card={selectedCard} onDismiss={() => setSelectedCard(null)} />
    </View>
  )
}

function BoardColumn({ column, onOpenCard }: { column: KanbanColumn; onOpenCard: (card: KanbanCardSummary) => void }) {
  const theme = useTheme()

  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <Text variant="sectionHeader" style={styles.columnTitle}>
          {column.title}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: theme.color.secondaryTint }]}> 
          <Text variant="monoSmall" color={theme.color.secondaryDeep}>{column.cards.length}</Text>
        </View>
      </View>

      <View style={styles.cardGrid}>
        {column.cards.map(card => <KanbanCard key={card.id} card={card} onPress={() => onOpenCard(card)} />)}
      </View>
    </View>
  )
}

function KanbanCard({ card, onPress }: { card: KanbanCardSummary; onPress: () => void }) {
  const theme = useTheme()
  const meta = [card.risk ? `risk:${card.risk}` : null, card.branch, card.pr].filter(Boolean).join(' · ')

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
        <Text variant="rowLabelStrong" numberOfLines={2} style={styles.cardTitle}>
          {card.title}
        </Text>
        <Icon name={card.checked ? 'circle-check' : 'circle'} size={12} color={card.checked ? theme.color.success700 : theme.color.gray400} />
      </View>

      {card.description ? (
        <Text variant="secondary" numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}

      {meta ? (
        <Text variant="monoSmall" numberOfLines={1} style={styles.cardMeta}>
          {meta}
        </Text>
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
      <View style={[styles.modalRoot, { backgroundColor: theme.color.scrim, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}> 
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
            {card.description ? <Text variant="body">{card.description}</Text> : null}

            {details.length > 0 ? (
              <View style={styles.detailGrid}>
                {details.map(([label, value]) => (
                  <View key={label} style={[styles.detailPill, { borderColor: theme.color.border, backgroundColor: theme.color.bgSubtle }]}> 
                    <Text variant="sectionHeader">{label}</Text>
                    <Text variant="secondary" numberOfLines={1}>{value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {card.body ? (
              <View style={styles.bodyBlock}>
                <Text variant="sectionHeader">Card body</Text>
                <Text variant="secondary">{card.body}</Text>
              </View>
            ) : null}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  )
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
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },
  loading: { marginTop: 24 },
  hero: { gap: 4 },
  source: { maxWidth: '100%' },
  column: { gap: 8 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  columnTitle: { flex: 1, minWidth: 0 },
  countBadge: { minWidth: 24, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  cardGrid: { gap: 8 },
  kanbanCard: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, gap: 5 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, minWidth: 0 },
  cardMeta: { marginTop: 1 },
  messageCard: { padding: 14, gap: 4 },
  emptyColumnList: { gap: 8 },
  emptyPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyPill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  modalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  modalCard: { maxHeight: '82%' },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  modalTitleWrap: { flex: 1, minWidth: 0, gap: 4 },
  modalBody: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailPill: { minWidth: '46%', flexGrow: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  bodyBlock: { gap: 6 }
})
