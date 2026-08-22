import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'

/**
 * Floating scroll-to-bottom button that appears when user manually scrolls up.
 * Positioned absolutely above the composer, centered horizontally.
 */
export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Scroll to latest messages"
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border },
        pressed && styles.pressed,
      ]}
    >
      <Icon name="chevron-down" size={16} color={theme.color.primary} />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
})
