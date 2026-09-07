import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'

import type { AgentBackend, KanbanCardSummary, KanbanStatus } from '@/domain'
import { useKanbanCardUpdate } from '@/state/boards'

import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Text } from './Text'

import { kanbanErrorText } from '../kanban'

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

  // No Status here. The meta row names it and the move chips tick it — a third
  // copy in the grid was the widest of the three and said the least.
  const details = [
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
      onError: e => setError(kanbanErrorText(e))
    })
  }

  const archive = () => {
    setError(null)
    move.mutate({ id: card.id, update: { move: { kind: 'archive' } } }, {
      onSuccess: onDismiss,
      onError: e => setError(kanbanErrorText(e))
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
        onError: e => setError(kanbanErrorText(e))
      }
    )
  }

  /**
   * The status, as one control that both reports and sets it.
   *
   * It used to be two things saying the same thing: a `BACKLOG` label on the
   * meta row, and four chips below it of which one was ticked and three were
   * arrows. A segmented track is the same decision along one axis (design
   * §Interactions) — the filled segment *is* the label, so there is nothing
   * left to keep in sync with it.
   */
  const statuses: { value: KanbanStatus; label: string }[] = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'testing', label: 'Testing' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'done', label: 'Done' }
  ]

  return (
    // The sheet carries the title and owns dismissal, so the header keeps only
    // the status and the actions — and loses its close button, which a sheet
    // you can drag or tap away from does not need.
    <Sheet visible title={card.title} onDismiss={onDismiss}>
      <View style={styles.sheetBody}>
          <View style={styles.header}>
              {/* Where the status label used to be, before the segmented
                  track took over saying that. Rendered only when the host
                  reports one: a plugin predating the field sends nothing, and
                  a "P0" invented for it would be a claim, not a reading. */}
              {card.priority != null ? (
                <View style={[styles.priority, { borderColor: theme.color.border }]}>
                  <Text variant="sectionHeader" color={theme.color.gray500}>
                    {`P${card.priority}`}
                  </Text>
                </View>
              ) : null}

              <View style={styles.metaSpacer} />

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

            {editable ? null : (
              <IconButton name="xmark" accessibilityLabel="Close card details" onPress={onDismiss} />
            )}
          </View>

          <View style={styles.statusBar}>
            <Segmented
              options={statuses}
              value={card.status}
              onChange={next => {
                if (next !== card.status) attemptMove(next)
              }}
              label="Ticket status"
              compact
            />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
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
            ) : (
              <View style={styles.description}>
                {/* The pencil sits on the thing it edits. Everything else here
                    already changes the card the moment you touch it — a status
                    chip moves it, the id pill copies itself — so the body was
                    the only part still asking to be put into a mode, and it is
                    the only part that carries one. */}
                <View style={styles.descriptionHead}>
                  <Text variant="sectionHeader" style={styles.metaLabel}>
                    Description
                  </Text>
                  {editable ? (
                    <IconButton
                      name="pen"
                      size={13}
                      slot={32}
                      accessibilityLabel="Edit description"
                      onPress={toggleEdit}
                    />
                  ) : null}
                </View>

                {card.body ? (
                  // The ticket body is markdown on disk, so it renders as
                  // markdown here — same component the transcript uses, so a
                  // heading, a checklist and a fenced block land in the app's
                  // type scale rather than arriving as one wall of escaped
                  // text. The description is the body's first prose line, so
                  // showing both would just repeat it.
                  <Markdown source={card.body} />
                ) : card.description ? (
                  <Text variant="body">{card.description}</Text>
                ) : (
                  <Text variant="secondary">No ticket file for this card.</Text>
                )}
              </View>
            )}

            {editable && !editing ? (
              // Full width and last: you scroll past everything the card is
              // before you reach the button that removes it. Worded as what it
              // does — the card is archived on the board, not deleted from the
              // host.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Archive card"
                disabled={move.isPending}
                onPress={archive}
                style={({ pressed }) => [
                  styles.archive,
                  {
                    borderColor: theme.color.error200,
                    backgroundColor: theme.color.error50,
                    opacity: move.isPending ? 0.5 : pressed ? 0.75 : 1
                  }
                ]}
              >
                <Icon name="trash" size={13} color={theme.color.error700} />
                <Text variant="rowLabelStrong" color={theme.color.error700}>
                  {move.isPending ? 'Archiving…' : 'Archive card'}
                </Text>
              </Pressable>
            ) : null}

            {error ? (
              <View style={[styles.errorRow, { backgroundColor: theme.color.error50, borderColor: theme.color.error200 }]}>
                <Icon name="triangle-exclamation" size={13} color={theme.color.error700} />
                <Text variant="secondary" color={theme.color.error700}>
                  {error}
                </Text>
              </View>
            ) : null}
          </ScrollView>

      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  // Lets the scrolling content shrink inside the sheet's own max height.
  sheetBody: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6 },
  // Takes the row's slack so a heading's own control sits at its end.
  metaLabel: { flex: 1, minWidth: 0 },
  metaSpacer: { flex: 1 },
  // Outside the scroll: the status is what you came to change, and it should
  // not leave the sheet when the description is long.
  statusBar: { paddingHorizontal: 16, paddingBottom: 12 },
  priority: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  body: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  idPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  idValue: { flexShrink: 1 },
  // Sized to their contents and set on one line: "Risk High" reads as a fact,
  // where a half-width box with a heading over a word read as a form field
  // that had been filled in.
  detailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  archive: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginTop: 4
  },
  editBlock: { gap: 8 },
  // The gap below separates the prose from the archive button under it, which
  // wants more room than a heading needs above its own text.
  description: { gap: 4, paddingBottom: 10 },
  descriptionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
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
