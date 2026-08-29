import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'

import type { AgentBackend, KanbanCardSummary, KanbanStatus } from '@/domain'
import { useKanbanCardUpdate } from '@/state/boards'

import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Card } from './Card'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Text } from './Text'

/**
 * The whole ticket, from either place it can be opened: its lane on the Boards
 * screen, or a mention in the transcript.
 *
 * `editable` switches on the write surface — status chips, archive, and the
 * title/body edit. The Boards screen passes it when it has the backend in hand;
 * the transcript opens the same sheet read-only, which is all a mention in a
 * message needs.
 */
export function KanbanCardDetail({
  card,
  onDismiss,
  scope,
  backend,
  editable = false
}: {
  card: KanbanCardSummary | null
  onDismiss: () => void
  scope?: string
  backend?: AgentBackend | null
  editable?: boolean
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const move = useKanbanCardUpdate(scope ?? '', backend ?? null)
  // The sheet can swap cards while open; a check from the previous copy must
  // not hang off the new card's ID, and so must an edit or a stale error.
  useEffect(() => {
    setCopied(false)
    setEditing(false)
    setError(null)
  }, [card?.id])

  if (!card) return null

  const details = [
    ['Status', card.statusLabel],
    ['Risk', card.risk],
    ['Branch', card.branch],
    ['PR', card.pr]
  ].filter(([, value]) => Boolean(value))

  // Same pattern as the transcript's copy buttons: write, flip to a check for
  // two seconds, and let the next tap start fresh.
  const copyId = async () => {
    await Clipboard.setStringAsync(card.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const startEdit = () => {
    setEditTitle(card.title)
    setEditBody(card.body ?? '')
    setError(null)
    setEditing(true)
  }

  const toggleEdit = () => {
    if (editing) setEditing(false)
    else startEdit()
  }

  // A move is the card's status from the phone's point of view. The host does
  // the real transition (with its guardrails) and answers 409 with the
  // reason; we surface that text instead of guessing.
  const attemptMove = (status: KanbanStatus) => {
    setError(null)
    move.mutate({ id: card.id, update: { move: { kind: 'column', status } } }, {
      onError: e => setError(errorText(e))
    })
  }

  const archive = () => {
    setError(null)
    move.mutate({ id: card.id, update: { move: { kind: 'archive' } } }, {
      onSuccess: onDismiss,
      onError: e => setError(errorText(e))
    })
  }

  const saveEdit = () => {
    const title = editTitle.trim()
    if (!title) return
    setError(null)
    move.mutate(
      { id: card.id, update: { title, body: editBody } },
      {
        onSuccess: () => setEditing(false),
        onError: e => setError(errorText(e))
      }
    )
  }

  const chip = (status: KanbanStatus, label: string, color: string) => {
    const current = card.status === status
    return (
      <Pressable
        key={status}
        accessibilityRole="button"
        accessibilityLabel={current ? `${label} (current column)` : `Move to ${label}`}
        disabled={!editable || move.isPending}
        onPress={() => attemptMove(status)}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: current ? color : theme.color.border, backgroundColor: current ? theme.color.bgSubtle : 'transparent' },
          pressed && !current ? { opacity: 0.55 } : undefined
        ]}
      >
        <Text variant="pill" color={current ? color : theme.color.gray500}>
          {label}
        </Text>
        {current ? (
          <Icon name="check" size={11} color={color} />
        ) : (
          <Icon name="arrow-right" size={11} color={theme.color.gray400} />
        )}
      </Pressable>
    )
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View
        style={[
          styles.root,
          { backgroundColor: theme.color.scrim, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close card details" />
        <Card style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text variant="sectionHeader">{card.statusLabel}</Text>
              <Text variant="sheetTitle">{card.title}</Text>
            </View>
            {editable ? (
              <View style={styles.headerActions}>
                <IconButton
                  name="trash"
                  size={15}
                  slot={38}
                  accessibilityLabel="Archive card"
                  disabled={move.isPending}
                  onPress={archive}
                />
                <IconButton
                  name="pen"
                  size={15}
                  slot={38}
                  accessibilityLabel={editing ? 'Close edit' : 'Edit card'}
                  onPress={toggleEdit}
                />
                <IconButton name="xmark" accessibilityLabel="Close card details" onPress={onDismiss} />
              </View>
            ) : (
              <IconButton name="xmark" accessibilityLabel="Close card details" onPress={onDismiss} />
            )}
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* The ticket id, copyable: it is the handle for this card in chat,
                PRs, and the `hermes kanban` CLI, and nowhere else in the app
                it was previously surfaced. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied ticket id' : `Copy ticket id ${card.id}`}
              onPress={() => void copyId()}
              hitSlop={8}
              style={[
                styles.idPill,
                { borderColor: copied ? theme.color.primary : theme.color.border, backgroundColor: theme.color.bgSubtle }
              ]}
            >
              <Text variant="sectionHeader">ID</Text>
              <Text variant="monoSmall" numberOfLines={1} style={styles.idValue}>
                {card.id}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? theme.color.primary : theme.color.gray400} />
            </Pressable>

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

            {editable ? (
              <View style={styles.chipRow}>
                {chip('backlog', 'Backlog', theme.color.gray600)}
                {chip('testing', 'Testing', theme.color.warning700)}
                {chip('blocked', 'Blocked', theme.color.error700)}
                {chip('done', 'Done', theme.color.success700)}
              </View>
            ) : null}

            {editing ? (
              <View style={styles.editBlock}>
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Card title"
                  placeholderTextColor={theme.color.gray400}
                  maxLength={120}
                  style={[
                    styles.input,
                    {
                      borderColor: theme.color.border,
                      backgroundColor: theme.color.bgSubtle,
                      color: theme.color.gray900,
                      fontFamily: theme.font.bodyMedium
                    }
                  ]}
                />
                <TextInput
                  value={editBody}
                  onChangeText={setEditBody}
                  placeholder="Ticket body — markdown is fine"
                  placeholderTextColor={theme.color.gray400}
                  multiline
                  style={[
                    styles.input,
                    styles.bodyInput,
                    {
                      borderColor: theme.color.border,
                      backgroundColor: theme.color.bgSubtle,
                      color: theme.color.gray800,
                      fontFamily: theme.font.body
                    }
                  ]}
                />
                <View style={styles.editActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel edit"
                    disabled={move.isPending}
                    onPress={() => setEditing(false)}
                    style={({ pressed }) => [
                      styles.editButton,
                      { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, opacity: pressed ? 0.6 : 1 }
                    ]}
                  >
                    <Text variant="rowLabelStrong" color={theme.color.gray600}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save card"
                    disabled={move.isPending || !editTitle.trim()}
                    onPress={saveEdit}
                    style={({ pressed }) => [
                      styles.editButton,
                      {
                        backgroundColor: move.isPending || !editTitle.trim() ? theme.color.bgSubtle : theme.color.accentFill,
                        borderColor: move.isPending || !editTitle.trim() ? theme.color.border : theme.color.accentFill,
                        opacity: pressed ? 0.8 : 1
                      }
                    ]}
                  >
                    <Text variant="rowLabelStrong" color={move.isPending || !editTitle.trim() ? theme.color.gray400 : theme.color.onAccent}>
                      {move.isPending ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : card.body ? (
              // The ticket body is markdown on disk, so it renders as markdown
              // here — same component the transcript uses, so a heading, a
              // checklist and a fenced block land in the app's type scale
              // rather than arriving as one wall of escaped text. The
              // description is the body's first prose line, so showing both
              // would just repeat it.
              <Markdown source={card.body} />
            ) : card.description ? (
              <Text variant="body">{card.description}</Text>
            ) : (
              <Text variant="secondary">No ticket file for this card.</Text>
            )}

            {error ? (
              <View style={[styles.errorRow, { backgroundColor: theme.color.error50, borderColor: theme.color.error200 }]}>
                <Icon name="triangle-exclamation" size={13} color={theme.color.error700} />
                <Text variant="secondary" color={theme.color.error700}>
                  {error}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  )
}

/**
 * The host writes 409/400 details as user-readable sentences ("cannot move a
 * card to In Progress from the phone — the host's dispatcher assigns workers
 * to cards"), so parse the FastAPI `{"detail": "…"}` shape and show the text
 * as-is.
 */
function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'body' in e) {
    try {
      const detail = (JSON.parse(String((e as { body: string }).body)) as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail) return detail
    } catch {
      // Fall through to the raw message.
    }
  }
  return e instanceof Error ? e.message : String(e)
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: { maxHeight: '82%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  titleWrap: { flex: 1, minWidth: 0, gap: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7
  },
  idPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  idValue: { flex: 1 },
  detailPill: {
    minWidth: '46%',
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  editBlock: { gap: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  bodyInput: { minHeight: 160, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9
  }
})
