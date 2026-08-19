import { StyleSheet, View } from 'react-native'

import type { ConnectionState } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

/**
 * Disconnection is normal, not an error state the user must dismiss (§10.3).
 *
 * The copy is the important part: the agent keeps working on the VM whether or
 * not the phone is attached, and saying so is what stops a dropped socket from
 * reading as lost work.
 */
export function ConnectionBanner({ state, attempt }: { state: ConnectionState; attempt: number }) {
  const theme = useTheme()

  if (state === 'open' || state === 'idle') return null

  const connecting = state === 'connecting'

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: theme.color.warning50,
          borderColor: theme.color.warning200,
          borderRadius: theme.radius.row
        }
      ]}
    >
      <Text variant="rowLabelStrong" color={theme.color.warning700}>
        {connecting ? 'Reconnecting…' : 'Tailnet unreachable'}
      </Text>
      <Text variant="secondary" color={theme.color.warningText}>
        The agent keeps working on the VM. This transcript resumes from where it left off.
      </Text>
      {attempt > 0 ? <Text variant="monoSmall" color={theme.color.warning700}>{`retry ${attempt}`}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { padding: 13, gap: 4, borderWidth: StyleSheet.hairlineWidth }
})
