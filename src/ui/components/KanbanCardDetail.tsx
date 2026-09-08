import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'

import type { AgentBackend, KanbanCardSummary, KanbanStatus } from '@/domain'
import { useKanbanCardUpdate } from '@/state/boards'

import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Text } from './Text'

import { kanbanErrorText, statusTone } from '../kanban'

/** What the badge calls each status, including the two the phone cannot move a card into. */
const STATUS_LABEL: Record<KanbanStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  testing: 'Testing',
  blocked: 'Blocked',
  done: 'Done',
  other: 'Other'
}

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
  const [pickingStatus, setPickingStatus] = useState(false)
  // Where the subtitle ends, so the status menu can hang just under it.
  const [menuTop, setMenuTop] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const move = useKanbanCardUpdate(scope ?? '', backend ?? null)
  // The sheet can swap cards while open; a check from the previous copy must
  // not hang off the new card's ID, and so must an edit or a stale error.
  useEffect(() => {
    setCopied(false)
    setEditing(false)
    setPickingStatus(false)
    setError(null)
  }, [card?.id])

  if (!card) return null

  // No Status here: the subtitle's badge is it.
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

  // The title is the sheet's heading, renamed there: a long press on it.
  const rename = (title: string) => {
    setError(null)
    move.mutate({ id: card.id, update: { title } }, { onError: e => setError(kanbanErrorText(e)) })
  }

  // Only the body here; the title has its own way in.
  const saveEdit = () => {
    setError(null)
    move.mutate(
      { id: card.id, update: { body: editBody } },
      {
        onSuccess: () => setEditing(false),
        onError: e => setError(kanbanErrorText(e))
      }
    )
  }

  /**
   * The moves the phone may make. The badge in the subtitle both reports the
   * status and opens this list — one control, so there is nothing to keep in
   * sync with it. `in_progress` is not offered: the host's dispatcher assigns
   * workers to cards, and a move there from here is refused with that reason.
   */
  const statuses: { value: KanbanStatus; label: string }[] = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'testing', label: 'Testing' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'done', label: 'Done' }
  ]
  const statusLabel = STATUS_LABEL[card.status] ?? card.status
  const tone = statusTone(theme, card.status)

  const pickStatus = (next: KanbanStatus) => {
    setPickingStatus(false)

    if (next !== card.status) attemptMove(next)
  }

  return (
    // The sheet carries the title — the whole of it, since a ticket's name is
    // what you came to read — and owns dismissal, including the close button
    // in its header. Under that, a subtitle: priority, status and id in one
    // line, where the status is the only thing drawn as a control.
    <Sheet visible title={card.title} onDismiss={onDismiss} expandable titleLines={3} onRename={editable ? rename : undefined}>
      <View style={styles.sheetBody}>
          {/* The subtitle: priority, status, id — the facts about the card in
              one quiet line. The status is the one that is also a control: a
              badge in its column's tone that opens a menu of the moves. The
              id copies on tap; it is the handle for this card in chat, PRs,
              and the `hermes kanban` CLI, and nowhere else in the app it was
              previously surfaced. The priority is shown only when the host
              reports one — a plugin predating the field sends nothing, and a
              "P0" invented for it would be a claim, not a reading. */}
          <View style={styles.subtitle} onLayout={event => setMenuTop(event.nativeEvent.layout.y + event.nativeEvent.layout.height)}>
            {card.priority != null ? (
              <>
                <Text variant="secondary" color={theme.color.gray500}>
                  {`P${card.priority}`}
                </Text>
                <Text variant="secondary" color={theme.color.gray400}>
                  ·
                </Text>
              </>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Status ${statusLabel}. Change status`}
              accessibilityState={{ expanded: pickingStatus }}
              onPress={() => setPickingStatus(open => !open)}
              hitSlop={6}
              style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}
            >
              <View style={[styles.dot, { backgroundColor: tone.text }]} />
              <Text variant="pill" color={tone.text}>
                {statusLabel}
              </Text>
              <Icon name={pickingStatus ? 'chevron-up' : 'chevron-down'} size={10} color={tone.text} />
            </Pressable>

            <Text variant="secondary" color={theme.color.gray400}>
              ·
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied ticket id' : `Copy ticket id ${card.id}`}
              onPress={() => void copyId()}
              hitSlop={8}
              style={styles.idButton}
            >
              <Text variant="mono" color={copied ? theme.color.primary : theme.color.gray500} numberOfLines={1} style={styles.idValue}>
                {card.id}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? theme.color.primary : theme.color.gray400} />
            </Pressable>
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

            <View style={styles.description}>
              {/* The pencil sits on the thing it edits, and while editing the
                  same corner holds cancel and save — the heading never moves
                  and nothing new appears below the text. Everything else here
                  already changes the card the moment you touch it — the badge
                  moves it, the id copies itself — so the body was the only
                  part still asking to be put into a mode, and it is the only
                  part that carries one. */}
              <View style={styles.descriptionHead}>
                <Text variant="sectionHeader" style={styles.metaLabel}>
                  Description
                </Text>
                {editable && editing ? (
                  <View style={styles.headActions}>
                    <IconButton
                      name="xmark"
                      size={13}
                      slot={32}
                      accessibilityLabel="Cancel edit"
                      disabled={move.isPending}
                      onPress={() => setEditing(false)}
                    />
                    <IconButton
                      name="check"
                      size={14}
                      slot={32}
                      color={move.isPending ? theme.color.gray400 : theme.color.primary}
                      accessibilityLabel={move.isPending ? 'Saving description' : 'Save description'}
                      disabled={move.isPending}
                      onPress={saveEdit}
                    />
                  </View>
                ) : editable ? (
                  <IconButton name="pen" size={13} slot={32} accessibilityLabel="Edit description" onPress={toggleEdit} />
                ) : null}
              </View>

              {editing ? (
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
              ) : card.body ? (
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


          {/* The status menu: hangs under the subtitle, over the body, inside
              the sheet — a second Modal for four rows would be a lot of
              ceremony, and it would fight this one's gestures. A tap anywhere
              else on the body closes it. The host still does the real move
              and may refuse it; that answer lands in the error row below. */}
          {pickingStatus ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Close status menu" onPress={() => setPickingStatus(false)} style={StyleSheet.absoluteFill} />
              <View style={[styles.menu, theme.shadow.sheet, { top: menuTop, backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
                {statuses.map(option => {
                  const optionTone = statusTone(theme, option.value)
                  const current = option.value === card.status

                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: current }}
                      onPress={() => pickStatus(option.value)}
                      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.color.bgSubtle }]}
                    >
                      <View style={[styles.dot, { backgroundColor: optionTone.text }]} />
                      <Text variant="body" style={styles.menuLabel}>
                        {option.label}
                      </Text>
                      {current ? <Icon name="check" size={13} color={theme.color.primary} /> : null}
                    </Pressable>
                  )
                })}
              </View>
            </>
          ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  // Lets the scrolling content shrink inside the sheet's own max height.
  sheetBody: { flexShrink: 1 },
  // A subtitle, centred under the centred title, wrapping when a long id will
  // not share the line with the badge.
  subtitle: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  idButton: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  menu: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 4,
    zIndex: 10,
    elevation: 8
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 44, borderRadius: 8, marginHorizontal: 4 },
  menuLabel: { flex: 1 },
  // Takes the row's slack so a heading's own control sits at its end.
  metaLabel: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  headActions: { flexDirection: 'row', alignItems: 'center' },
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
