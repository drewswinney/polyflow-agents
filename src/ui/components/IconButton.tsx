import { Pressable, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'

/**
 * A bare icon that is nonetheless a real button.
 *
 * The design asks for two things at once: header actions are "bare icons (17px,
 * #4b5563) … with no chip or border", *and* "every control is ≥44px tall/wide".
 * Those only reconcile if the tap target is invisible — 44×44 of touchable area
 * around a 17px glyph.
 *
 * `edge` is what keeps that from pushing the glyph off the layout grid. A 44px
 * box right-aligned to the 20px screen margin would sit the glyph ~42px from
 * the edge; a negative margin lets the box overhang so the glyph stays where
 * the design put it and the target grows outward instead.
 */
export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 17,
  color,
  slot = 44,
  edge = 'none',
  disabled,
  style
}: {
  name: string
  onPress?: () => void
  /** Required: a bare glyph has no text for a screen reader to fall back on. */
  accessibilityLabel: string
  size?: number
  color?: string
  /** Touch-target size. Below 44 the shortfall is made up with hitSlop. */
  slot?: number
  edge?: 'left' | 'right' | 'none'
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()

  // A smaller visual slot (the 34px back chevron) still has to be reachable, so
  // whatever it gives up in size it takes back as hitSlop.
  const shortfall = Math.max(0, 44 - slot) / 2

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={shortfall}
      style={({ pressed }) => [
        styles.button,
        {
          width: slot,
          height: slot,
          opacity: disabled ? 0.4 : pressed ? 0.55 : 1,
          marginRight: edge === 'right' ? -(slot - size) / 2 : 0,
          marginLeft: edge === 'left' ? -(slot - size) / 2 : 0
        },
        style
      ]}
    >
      <Icon name={name} size={size} color={color ?? theme.color.gray600} />
    </Pressable>
  )
}

/** Non-interactive spacer that reserves an icon button's footprint. */
export function IconButtonSpacer({ slot = 44 }: { slot?: number }) {
  return <View style={{ width: slot, height: slot }} />
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' }
})
