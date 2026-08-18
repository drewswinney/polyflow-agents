import { StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

/**
 * One stat tile. `value` is display text, already formatted — this component
 * decides nothing about units.
 *
 * `progress` is optional and only passed where a ratio genuinely exists (spend
 * against a cap). A bar with no denominator would be decoration.
 */
export function StatTile({
  label,
  value,
  detail,
  progress,
  barColor
}: {
  label: string
  value: string
  detail?: string
  progress?: number
  barColor?: string
}) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.tile,
        theme.shadow.card,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border, borderRadius: theme.radius.card }
      ]}
    >
      <Text variant="sectionHeader">{label}</Text>
      <Text variant="stat">{value}</Text>

      {progress !== undefined ? (
        <View style={[styles.track, { backgroundColor: theme.color.divider }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.min(100, Math.max(0, progress * 100))}%`, backgroundColor: barColor ?? theme.color.primary }
            ]}
          />
        </View>
      ) : null}

      {detail ? <Text variant="monoSmall">{detail}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, padding: 13, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 }
})
