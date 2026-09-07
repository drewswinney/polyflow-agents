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
  outlined = false,
  ring = 40,
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
  /**
   * Draws a circle around the glyph.
   *
   * For a header that sits *over* the content rather than above it: a bare
   * glyph on a transcript is a glyph competing with a paragraph. The ring is
   * drawn inside the tap slot rather than becoming it, so the target stays 44
   * whatever the circle measures.
   */
  outlined?: boolean
  /** Diameter of the drawn circle. The tap slot is still `slot`. */
  ring?: number
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()

  // A smaller visual slot (the 34px back chevron) still has to be reachable, so
  // whatever it gives up in size it takes back as hitSlop.
  const shortfall = Math.max(0, 44 - slot) / 2

  // What the eye reads as the button's edge. With an outline that is the
  // circle, not the glyph inside it, so the overhang has to measure the circle
  // or the ring hangs off the screen margin by half the difference.
  const visual = outlined ? ring : size

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
          marginRight: edge === 'right' ? -(slot - visual) / 2 : 0,
          marginLeft: edge === 'left' ? -(slot - visual) / 2 : 0
        },
        style
      ]}
    >
      {outlined ? (
        // Filled as well as outlined: the wash is the same one the header used
        // to carry, and it is what keeps the glyph readable over whatever has
        // scrolled underneath it.
        <View
          style={[
            styles.ring,
            {
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderColor: theme.color.border,
              backgroundColor: theme.color.headerWash
            }
          ]}
        >
          <Icon name={name} size={size} color={color ?? theme.color.gray600} />
        </View>
      ) : (
        <Icon name={name} size={size} color={color ?? theme.color.gray600} />
      )}
    </Pressable>
  )
}

/** Non-interactive spacer that reserves an icon button's footprint. */
export function IconButtonSpacer({ slot = 44 }: { slot?: number }) {
  return <View style={{ width: slot, height: slot }} />
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth }
})
