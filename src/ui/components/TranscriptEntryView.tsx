import { LinearGradient } from 'expo-linear-gradient'
import * as Clipboard from 'expo-clipboard'
import { memo, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import type { MessageImage, SystemNoteKind, TranscriptEntry } from '@/domain'

import { clockTime, duration } from '../format'
import { fanFor, stackLabel } from '../image-stack'
import { thinkingSynopsis } from '../transcript-rows'
import { Markdown } from '../markdown/Markdown'
import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { ImageViewer } from './ImageViewer'
import { KanbanUnfurls } from './KanbanMentions'
import { Text } from './Text'
import { ToolRow } from './ToolRow'
import { WorkRow } from './WorkRow'

/**
 * One settled transcript entry. Memoised: while text streams into the tail
 * below, nothing above it re-renders (§7.3 step 2).
 */
export const TranscriptEntryView = memo(function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case 'message':
      return entry.role === 'user' ? (
        <UserBubble text={entry.text} images={entry.images} />
      ) : (
        <AgentText text={entry.text} role={entry.role} />
      )
    case 'thinking':
      return <ThinkingLink text={entry.text} durationMs={entry.durationMs} />
    case 'tool':
      return <ToolRow call={entry.call} />
    case 'stream_cut':
      return <StreamCut at={entry.at} />
    case 'system':
      return <SystemNote note={entry.note} label={entry.label} detail={entry.detail} text={entry.text} />
  }
})

/** The glyph for each kind of plumbing; the same muted ink as a collapsed work row. */
const NOTE_GLYPH: Record<SystemNoteKind, string> = {
  compaction: 'compress',
  cron: 'clock',
  skill: 'wand-magic-sparkles',
  background: 'gears',
  delegation: 'diagram-project',
  continue: 'forward',
  system: 'circle-info'
}

/**
 * Something the host injected, drawn as plumbing.
 *
 * A quiet row in the same voice as a collapsed work section — a glyph, one
 * muted line saying what it is, a chevron — because that is what it is: the
 * agent's working conditions, not the conversation. It opens to the full
 * text, since a compaction summary or a job's prompt is exactly what you go
 * looking for when a reply does not make sense. Never a bubble: a bubble says
 * "you said this", and you did not.
 */
function SystemNote({ note, label, detail, text }: { note: SystemNoteKind; label: string; detail?: string; text: string }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const muted = theme.color.muted

  return (
    <View style={styles.systemNote}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Hide' : 'Show'} host note. ${label}`}
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => [styles.systemHeader, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name={NOTE_GLYPH[note]} size={12} color={muted} />
        <View style={styles.systemLabel}>
          <Text variant="secondary" color={muted} numberOfLines={1}>
            {label}
          </Text>
          {/* The lifted line gets its own row: beside a label it was always
              the part that got cut, and it is the part worth reading. */}
          {detail ? (
            <Text variant="secondary" color={theme.color.gray500} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={9} color={muted} />
      </Pressable>

      {open ? (
        <View style={[styles.systemBody, { borderLeftColor: theme.color.border }]}>
          <Markdown source={text} />
        </View>
      ) : null}
    </View>
  )
}

/**
 * A message you sent.
 *
 * No copy button under it, unlike the agent's. You wrote this one — the reason
 * to copy a message is to take the agent's answer somewhere else, and the text
 * is selectable either way if you want a piece of your own back.
 */
function UserBubble({ text, images }: { text: string; images?: MessageImage[] }) {
  const theme = useTheme()
  const gradient = useGradient()
  // Which picture the viewer is open on, or closed. Local to the bubble: the
  // viewer belongs to this message, and the entry view is memoised, so the
  // state costs nothing while the transcript streams below it.
  const [viewing, setViewing] = useState<number | null>(null)

  // Pictures this device can draw stack; the rest are names, and a name has
  // nothing to stack or to open. A reloaded transcript with a cleared cache
  // is all names, and reads as the chips it always did.
  const pictures = images?.filter(image => image.uri) ?? []
  const chips = images?.filter(image => !image.uri) ?? []

  return (
    <View style={styles.userRow}>
      <View style={styles.userContent}>
        {pictures.length > 1 ? (
          <SentImageStack images={pictures} onOpen={setViewing} />
        ) : pictures[0] ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={`${pictures[0].name}, opens full screen`}
            onPress={() => setViewing(0)}
            style={styles.single}
          >
            <SentImage image={pictures[0]} />
          </Pressable>
        ) : null}

        {chips.length ? (
          <View style={styles.sentImages}>
            {chips.map((image, index) => (
              <SentImage key={`${image.name}-${index}`} image={image} />
            ))}
          </View>
        ) : null}

        {viewing !== null ? <ImageViewer images={pictures} index={viewing} onClose={() => setViewing(null)} /> : null}

        {/* A picture on its own is a whole message — an empty bubble under it
            would be a second, silent one. */}
        {text ? (
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={styles.userBubble}
          >
            <Text variant="chat" color={theme.color.onAccent} selectable>
              {text}
            </Text>
          </LinearGradient>
        ) : null}
      </View>
    </View>
  )
}

/**
 * One image on a sent message.
 *
 * Falls back to a named chip when this device has no copy of the picture. That
 * is not an error state — the host keeps the image, the phone only ever kept a
 * courtesy copy — so it reads as a filename, not as something broken.
 */
function SentImage({ image }: { image: MessageImage }) {
  const theme = useTheme()

  if (!image.uri) {
    return (
      <View style={[styles.imageChip, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border }]}>
        <Icon name="image" size={11} color={theme.color.gray400} />
        <Text variant="secondary" color={theme.color.gray600} numberOfLines={1}>
          {image.name}
        </Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri: image.uri }}
      style={[styles.sentImage, { borderColor: theme.color.border }]}
      resizeMode="cover"
      accessibilityLabel={image.name}
    />
  )
}

/** How wide and tall each card in a hand is. */
const CARD = 120
/** How far the back cards reach beyond the front one, either side. */
const STACK_SPREAD = 24

/**
 * Several pictures on one message, held like a hand of cards.
 *
 * One tap target for the whole hand, opening on the front card; the badge
 * says how many there really are, since only the front few show. Cards are
 * drawn back to front (`fanFor` orders them so) because a later sibling
 * paints over an earlier one.
 */
function SentImageStack({ images, onOpen }: { images: MessageImage[]; onOpen: (index: number) => void }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={stackLabel(images.length)} onPress={() => onOpen(0)} style={styles.stack}>
      {fanFor(images.length).map(card => (
        <Image
          key={card.index}
          source={{ uri: images[card.index]?.uri }}
          resizeMode="cover"
          accessibilityLabel={images[card.index]?.name}
          style={[
            styles.stackCard,
            theme.shadow.sheet,
            {
              borderColor: theme.color.border,
              backgroundColor: theme.color.bgSubtle,
              transform: [{ translateX: card.dx }, { translateY: card.dy }, { rotate: `${card.rotate}deg` }]
            }
          ]}
        />
      ))}

      {/* Same chip language as the composer's remove button: accent fill,
          which carries white in both themes, ringed in the page background. */}
      <View style={[styles.stackBadge, { backgroundColor: theme.color.accentFill, borderColor: theme.color.bg }]}>
        <Icon name="images" size={10} color={theme.color.onAccent} />
        <Text variant="monoSmall" color={theme.color.onAccent}>
          {String(images.length)}
        </Text>
      </View>
    </Pressable>
  )
}

function AgentText({ text, role }: { text: string; role: 'agent' | 'system' }) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // System rows are the app's own error copy, never model output — there is no
  // markdown in them to render, and rendering it would style an error like prose.
  if (role === 'system') {
    return (
      <View style={styles.agentContent}>
        <Text variant="body" color={theme.color.error700} selectable>
          {text}
        </Text>
        <View style={styles.buttonBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy message'}
            onPress={handleCopy}
            hitSlop={COPY_HIT_SLOP}
            style={styles.copyButton}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.color.muted} />
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.agentContent}>
      <Markdown source={text} />

      {/* Under the message rather than inside it: the sentence keeps its shape,
          and a card the agent named twice still only appears once. */}
      <KanbanUnfurls text={text} />

      <View style={styles.buttonBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : 'Copy message'}
          onPress={handleCopy}
          hitSlop={COPY_HIT_SLOP}
          style={styles.copyButton}
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.color.muted} />
        </Pressable>
      </View>
    </View>
  )
}

/**
 * A thought, as a line in the work section's list.
 *
 * It says what the thought was *about* rather than how long it took. "Thought
 * for a moment" is the same sentence under every thought in the transcript, so
 * a column of them told you only that thinking had happened — the synopsis is
 * the part you would have opened the row to find. The duration keeps its place
 * on the right, where every other row reports its outcome.
 */
function ThinkingLink({ text, durationMs }: { text: string; durationMs?: number }) {
  const theme = useTheme()

  const synopsis = thinkingSynopsis(text)

  return (
    <WorkRow
      glyph={<Icon name="brain" size={12} color={theme.color.secondary} />}
      label={synopsis}
      ink={theme.color.secondary}
      {...(durationMs === undefined ? {} : { meta: duration(durationMs) })}
      accessibilityLabel={`Thinking. ${synopsis}`}
      body={
        <Text variant="secondary" selectable>
          {text}
        </Text>
      }
    />
  )
}

/**
 * Where the delta stream was cut. The truncated sentence above it is kept
 * deliberately: the agent kept working on the VM, and the transcript resumes
 * from where it left off (§7.16).
 */
function StreamCut({ at }: { at: number }) {
  const theme = useTheme()

  return (
    <View style={styles.cutRow}>
      <View style={[styles.cutPill, { borderColor: theme.color.border, borderRadius: theme.radius.pill }]}>
        <Text variant="monoSmall">{`stream cut here · ${clockTime(at)}`}</Text>
      </View>
    </View>
  )
}

/**
 * Growth room for the copy button, which is small on purpose.
 *
 * Deliberately shorter on top than `MESSAGE_GAP`: a slop that reached past the
 * gap put the button's touch target *inside the message above it*, so a tap
 * meant for the last line of a reply copied it instead. Below and to the sides
 * there is nothing to steal from.
 */
const COPY_HIT_SLOP = { top: 6, bottom: 10, left: 10, right: 10 }

/**
 * Between a message and its own button bar.
 *
 * Text grows with the reader's text-size setting and this does not, so the gap
 * has to be one that still reads as a gap at the largest of them — at 4 the bar
 * arrived crowded against the last line well before the accessibility sizes.
 */
const MESSAGE_GAP = 8

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end' },
  userContent: { maxWidth: '80%', gap: MESSAGE_GAP },
  sentImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' },
  sentImage: { width: 140, height: 140, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  single: { alignSelf: 'flex-end' },
  // Room for the back cards' reach on both sides, and their drop below.
  stack: { alignSelf: 'flex-end', width: CARD + STACK_SPREAD * 2, height: CARD + 14 },
  stackCard: {
    position: 'absolute',
    left: STACK_SPREAD,
    top: 6,
    width: CARD,
    height: CARD,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth
  },
  stackBadge: {
    position: 'absolute',
    top: 6 + 8,
    right: STACK_SPREAD + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1.5
  },
  imageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth
  },
  systemNote: { gap: 6 },
  systemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  systemLabel: { flex: 1, minWidth: 0, gap: 1 },
  // Indented under its header and marked by a rule rather than boxed: the
  // text is long and boxing it made a second page inside the page.
  systemBody: { borderLeftWidth: 2, paddingLeft: 12, marginLeft: 5 },
  userBubble: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 12
  },
  // Full width, unlike the user's bubble beside it. A bubble is a shape and
  // wants a margin to read as one; the agent's reply is not a bubble but the
  // page itself, and capping it only bought a ragged right edge and an empty
  // gutter on a screen that has none to spare.
  agentContent: { gap: MESSAGE_GAP },
  buttonBar: {
    flexDirection: 'row',
    alignItems: 'center',
    // Reserved rather than implied: the row keeps its own height whatever the
    // icon inside it measures, so nothing above can settle into it.
    minHeight: 20,
    gap: 4,
    paddingLeft: 4
  },
  copyButton: {
    // No opacity. It used to carry 0.4, which put the icon at roughly 2:1
    // against the background — under the 3:1 a control needs, and far fainter
    // than the collapsed-steps header it is supposed to match. The receding is
    // done by `muted` itself now; dimming a colour already chosen to be quiet
    // only took it out of reach.
    padding: 2
  },
  cutRow: { alignItems: 'center' },
  cutPill: { borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 6 }
})
