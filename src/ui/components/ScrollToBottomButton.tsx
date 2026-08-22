import { memo } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'

/**
 * Floating scroll-to-bottom button that appears when user manually scrolls up.
 * Pinned to the bottom of the transcript, centered horizontally, so it floats
 * just above the composer. Small on purpose — the transcript underneath it is
 * what you are reading. `hitSlop` keeps the touch target at 52pt.
 */
export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Scroll to latest messages"
      onPress={onPress}
      hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border },
        pressed && styles.pressed,
      ]}
    >
      <Icon name="chevron-down" size={14} color={theme.color.primary} />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  button: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
})
