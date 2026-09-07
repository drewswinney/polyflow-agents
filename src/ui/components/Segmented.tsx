import { Pressable, StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

/**
 * One decision, one control (design §Interactions).
 *
 * The approval policy is the case this exists for: "ask me before nothing /
 * destructive things / every tool" is a single choice along one axis, and three
 * independent switches would let the user express states that do not exist.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  compact = false
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  label: string
  /**
   * A shorter track, for a control pinned above scrolling content rather than
   * sitting in a settings list.
   *
   * It costs height that the 44px touch floor would otherwise claim — the
   * segments are full-width, so what they lose vertically they keep
   * horizontally, and the target stays comfortably larger than a glyph.
   */
  compact?: boolean
}) {
  const theme = useTheme()

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.track, { backgroundColor: theme.color.bgSubtle, borderRadius: theme.radius.control }]}
    >
      {options.map(option => {
        const selected = option.value === value

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              compact ? styles.segmentCompact : null,
              selected && {
                backgroundColor: theme.color.surface,
                borderColor: theme.color.border,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: theme.radius.control - 1
              }
            ]}
          >
            <Text variant={selected ? 'rowLabelStrong' : 'rowLabel'} style={styles.label} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, gap: 3 },
  segment: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentCompact: { height: 30 },
  label: { fontSize: 13.5 }
})
