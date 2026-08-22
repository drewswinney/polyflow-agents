import { memo } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'

/**
 * Hands following back.
 *
 * Shown only while the transcript is in manual, where it is the one way out:
 * tapping takes the view to the end and puts it back to following arrivals
 * there. Pinned to the bottom of the transcript and centered, so it floats just
 * above the composer. Small on purpose — the transcript underneath it is what
 * you are reading — with `hitSlop` holding the touch target at 52pt.
 */
export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Jump to the latest message and follow new ones"
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
