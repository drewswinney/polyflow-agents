import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { describePending, type PendingTurn } from '@/state/pending-turn'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

const PULSE_MS = 1100
const PULSE_MIN_OPACITY = 0.25

/**
 * The line under the transcript between sending and seeing anything (§7.2).
 *
 * Sits where the streaming tail will: the tail takes over the moment content
 * arrives, and the work section's header covers a tool run, so this shows
 * only while neither has anything to say — which used to be a chat that looked
 * idle for the model's whole time-to-first-token, and for the whole agent
 * rebuild after the host had reaped the runtime.
 *
 * Same breath as the work header's glyph, on purpose: one visual language for
 * "the agent is on it", whichever of the two is reporting. The dot is the
 * accent, the words are secondary — the row is a status, not a message.
 */
export function PendingTurnRow({ pending }: { pending: PendingTurn | null }) {
  const theme = useTheme()
  const breath = useSharedValue(1)
  // The breath restarts on presence, not on every change of wording: a notice
  // replacing "Working…" must not snap the dot back to solid mid-fade.
  const live = pending !== null

  useEffect(() => {
    if (!live) return

    breath.value = withRepeat(
      withTiming(PULSE_MIN_OPACITY, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )

    return () => {
      breath.value = withTiming(1, { duration: 200 })
    }
  }, [live, breath])

  const style = useAnimatedStyle(() => ({ opacity: breath.value }))

  if (!pending) return null

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLiveRegion="polite">
      <Animated.View style={[styles.dot, { backgroundColor: theme.color.accentFill }, style]} />
      <Text variant="secondary" color={theme.color.secondary} style={styles.label} numberOfLines={2}>
        {describePending(pending)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { flex: 1 }
})
