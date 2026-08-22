import { LinearGradient } from 'expo-linear-gradient'
import * as Clipboard from 'expo-clipboard'
import { memo, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import type { MessageImage, TranscriptEntry } from '@/domain'

import { clockTime, duration } from '../format'
import { Markdown } from '../markdown/Markdown'
import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'
import { ToolCard } from './ToolCard'

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
      return <ToolCard call={entry.call} />
    case 'stream_cut':
      return <StreamCut at={entry.at} />
  }
})

function UserBubble({ text, images }: { text: string; images?: MessageImage[] }) {
  const gradient = useGradient()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={styles.userRow}>
      <View style={styles.userContent}>
        {images?.length ? (
          <View style={styles.sentImages}>
            {images.map((image, index) => (
              <SentImage key={`${image.name}-${index}`} image={image} />
            ))}
          </View>
        ) : null}

        {/* A picture on its own is a whole message — an empty bubble under it
            would be a second, silent one. */}
        {text ? (
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={styles.userBubble}
          >
            <Text variant="chat" color="#ffffff" selectable>
              {text}
            </Text>
          </LinearGradient>
        ) : null}
        {text ? (
          <View style={styles.buttonBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied' : 'Copy message'}
              onPress={handleCopy}
              hitSlop={COPY_HIT_SLOP}
              style={styles.copyButton}
            >
              <Icon name={copied ? 'check' : 'copy'} size={12} color="#9ca3af" />
            </Pressable>
          </View>
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
            <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.color.secondary} />
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.agentContent}>
      <Markdown source={text} />
      <View style={styles.buttonBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : 'Copy message'}
          onPress={handleCopy}
          hitSlop={COPY_HIT_SLOP}
          style={styles.copyButton}
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.color.secondary} />
        </Pressable>
      </View>
    </View>
  )
}

/**
 * Font size of the thinking link, which the brain glyph matches so the two read
 * as one line rather than an icon with a caption. Tracks the `secondary` text
 * variant — change them together.
 */
const THINKING_TEXT_SIZE = 13

/**
 * Thinking is a link, not a control.
 *
 * It is an aside about the turn, not something to act on, and a filled pill gave
 * it the visual weight of the tool cards beside it — which *are* actions with
 * consequences on a host. Collapsed by default: a phone has no room to hold them
 * open, and the reasoning is rarely what you came for.
 */
function ThinkingLink({ text, durationMs }: { text: string; durationMs?: number }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)

  const label = open ? 'Hide thinking' : durationMs ? `Thought for ${duration(durationMs)}` : 'Thought for a moment'

  return (
    <View style={styles.thinking}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen(value => !value)}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        style={({ pressed }) => [styles.thinkingLink, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="brain" size={THINKING_TEXT_SIZE} color={theme.color.secondary} />
        <Text variant="secondary" color={theme.color.secondary}>
          {label}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={9} color={theme.color.secondary} />
      </Pressable>

      {open ? (
        <Text variant="secondary" style={styles.thinkingBody}>
          {text}
        </Text>
      ) : null}
    </View>
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
  imageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth
  },
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
    opacity: 0.4,
    padding: 2
  },
  thinking: { alignItems: 'flex-start' },
  thinkingLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  thinkingBody: { marginTop: 8 },
  cutRow: { alignItems: 'center' },
  cutPill: { borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 6 }
})
