import { useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'

import type { StreamTail } from '@/state/stream-tail'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The only component that re-renders while tokens arrive.
 *
 * Deliberately renders plain text, not markdown (§7.3 step 4). Parsing on every
 * flush would re-tokenise the whole message several times a second, and a
 * half-arrived fence or table is not valid markdown anyway — it would flicker
 * between interpretations as the closing backticks arrive. The settled entry
 * re-renders through the markdown path the moment the turn completes.
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
      {snapshot.thinking ? (
        <View style={[styles.thinking, { backgroundColor: theme.color.secondaryTint, borderRadius: theme.radius.row }]}>
          <Icon name="brain" size={13} color={theme.color.secondary} />
          <Text variant="secondary" color={theme.color.secondaryDeep}>
            Thinking
          </Text>
        </View>
      ) : null}

      {snapshot.text ? (
        <Text variant="body">
          {snapshot.text}
          {snapshot.streaming ? <Cursor /> : null}
        </Text>
      ) : null}
    </View>
  )
}

function Cursor() {
  const theme = useTheme()

  return <Text variant="body" color={theme.color.secondary} style={styles.cursor}>▌</Text>
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  thinking: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    alignSelf: 'flex-start'
  },
  cursor: { opacity: 0.9 }
})
