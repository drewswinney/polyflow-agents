import { StyleSheet, View } from 'react-native'

import type { ConnectionState } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

/**
 * Currently mounted nowhere. It flickered: every retry re-rendered the screen
 * with a banner one line taller or shorter, which on chat is a height change at
 * the top of the transcript. The state it carried is still on screen — chat's
 * header subtitle says "reconnecting…", and the composer goes dashed and offers
 * to queue — so this is the panel, not the information, that is gone. Kept
 * whole: it goes back by rendering it again.
 *
 * Disconnection is normal, not an error state the user must dismiss (§10.3).
 *
 * The copy is the important part: the agent keeps working on the VM whether or
 * not the phone is attached, and saying so is what stops a dropped socket from
 * reading as lost work.
 *
 * It used to headline every failure "Tailnet unreachable", which is a cause it
 * has no way of knowing and was usually wrong — a blocked cleartext request, a
 * refused upgrade and a bad credential all reach here, and all of them happen
 * with a perfectly healthy tailnet. It now says only what it knows, and shows
 * the error it was already given and had been discarding.
 */
export function ConnectionBanner({
  state,
  attempt,
  error
}: {
  state: ConnectionState
  attempt: number
  error?: string | null
}) {
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
        {connecting ? 'Reconnecting…' : 'Not connected'}
      </Text>
      <Text variant="secondary" color={theme.color.warningText}>
        The agent keeps working on the VM. This transcript resumes from where it left off.
      </Text>
      {!connecting && error ? (
        <Text variant="monoSmall" color={theme.color.warningText}>
          {error}
        </Text>
      ) : null}
      {attempt > 0 ? <Text variant="monoSmall" color={theme.color.warning700}>{`retry ${attempt}`}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { padding: 13, gap: 4, borderWidth: StyleSheet.hairlineWidth }
})
