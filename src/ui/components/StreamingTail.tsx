import { useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'

import type { StreamTail } from '@/state/stream-tail'

import { useTheme } from '../ThemeProvider'
import { Markdown } from '../markdown/Markdown'
import { Text } from './Text'

/**
 * The only component that re-renders while tokens arrive.
 *
 * The tail renders live through the markdown pipeline (§7.3, revised 2026-08):
 * the store's ~60ms flush cap bounds how often the message is re-parsed,
 * `looksLikeMarkdown` keeps plain prose off the parser entirely, and
 * markdown-it reads a half-arrived fence as a fence that grows until its
 * close lands. The accepted trade is the familiar live-stream flicker — a
 * `**` or a link can sit as literal characters for a few flushes until its
 * closing marker arrives. The settled entry renders through the same
 * pipeline, so the tail's last frame and the settled message are one tree.
 *
 * The block cursor sits on its own line under the last block rather than
 * inline in the text: threading it through the token stream would leave the
 * caret at the mercy of whatever the message's final token turns out to be,
 * and a half-typed `*` must never be able to italicise it.
 *
 * It subscribes to the tail store directly rather than reading state threaded
 * down from the screen, so a flush repaints this bubble and nothing else
 * (§7.3 steps 1–2). The block cursor is the 8×17 violet caret from the design.
 */
export function StreamingTail({ tail }: { tail: StreamTail }) {
  const theme = useTheme()
  const snapshot = useSyncExternalStore(tail.subscribe, tail.getSnapshot, tail.getSnapshot)

  if (!snapshot.streaming && !snapshot.text) return null

  return (
    <View style={styles.wrap}>
      {/* Plain text, to match the settled thinking link rather than sitting
          above it as a filled pill. */}
      {snapshot.thinking ? (
        <Text variant="secondary" color={theme.color.gray500}>
          Thinking…
        </Text>
      ) : null}

      {snapshot.text ? (
        <View style={styles.body}>
          <Markdown source={snapshot.text} />

          {snapshot.streaming ? <Cursor /> : null}
        </View>
      ) : null}
    </View>
  )
}

function Cursor() {
  const theme = useTheme()

  return (
    <Text variant="body" color={theme.color.secondary} style={styles.cursor}>
      ▌
    </Text>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  body: {},
  cursor: { opacity: 0.9 }
})
