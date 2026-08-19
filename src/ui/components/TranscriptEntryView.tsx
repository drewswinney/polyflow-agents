import { LinearGradient } from 'expo-linear-gradient'
import { memo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { TranscriptEntry } from '@/domain'

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
      return entry.role === 'user' ? <UserBubble text={entry.text} /> : <AgentText text={entry.text} role={entry.role} />
    case 'thinking':
      return <ThinkingLink text={entry.text} durationMs={entry.durationMs} />
    case 'tool':
      return <ToolCard call={entry.call} />
    case 'stream_cut':
      return <StreamCut at={entry.at} />
  }
})

function UserBubble({ text }: { text: string }) {
  const gradient = useGradient()

  return (
    <View style={styles.userRow}>
      <LinearGradient
        colors={gradient.colors}
        start={gradient.start}
        end={gradient.end}
        style={styles.userBubble}
      >
        <Text variant="chat" color="#ffffff">
          {text}
        </Text>
      </LinearGradient>
    </View>
  )
}

function AgentText({ text, role }: { text: string; role: 'agent' | 'system' }) {
  const theme = useTheme()

  // System rows are the app's own error copy, never model output — there is no
  // markdown in them to render, and rendering it would style an error like prose.
  if (role === 'system') {
    return (
      <Text variant="body" color={theme.color.error700}>
        {text}
      </Text>
    )
  }

  return <Markdown source={text} />
}

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
        <Text variant="secondary" color={theme.color.primary}>
          {label}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={9} color={theme.color.primary} />
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

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '80%',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 12
  },
  thinking: { alignItems: 'flex-start' },
  thinkingLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  thinkingBody: { marginTop: 8 },
  cutRow: { alignItems: 'center' },
  cutPill: { borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 6 }
})
