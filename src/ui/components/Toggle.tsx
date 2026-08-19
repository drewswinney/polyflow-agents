import { Pressable, StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'

/**
 * A toggle, used **only** for genuine on/off preferences (design §Interactions).
 *
 * Anything with its own status or detail — an MCP server, a skill, a cron job
 * with a last error — is a navigation row instead. A switch would flatten that
 * into a lie.
 */
export function Toggle({
  value,
  onChange,
  disabled,
  label
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? theme.color.secondary : theme.color.divider,
          borderColor: value ? theme.color.secondary : theme.color.border,
          opacity: disabled ? 0.5 : 1
        }
      ]}
    >
      <View style={[styles.knob, { marginLeft: value ? 23 : 3 }]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: { width: 48, height: 28, borderRadius: 100, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' }
})
