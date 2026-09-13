import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConnectForm } from '@/ui/components/ConnectForm'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { SetupSteps } from '@/ui/components/SetupChrome'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Setup, page two of three (§7.8): the host, and how to sign in to it.
 *
 * The form itself is `ConnectForm`, shared with "add a server" from
 * Settings; what this page adds is where it sits in setup — the step dots,
 * a line of context, and the plugin page after it. `replace`, not `push`,
 * on the way out: there is no reason to come back to a form that has been
 * submitted.
 */
export default function ConnectScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Connect to Hermes" onBack={() => router.back()} />

      <ConnectForm
        topInset={headerInset}
        bottomInset={insets.bottom}
        onConnected={() => router.replace('/setup/plugin' as never)}
        header={
          <View style={styles.intro}>
            <SetupSteps step="connect" />
            <Text variant="secondary">
              Type or paste the address of your Hermes — the one its dashboard opens at. The app checks it as you type and asks for the sign-in it wants.
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  intro: { gap: 10, paddingBottom: 4 }
})
