import { router } from 'expo-router'
import { Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConnectForm } from '@/ui/components/ConnectForm'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Add a server from inside the app (§7.14) — the same form setup uses, in a
 * modal, with the plugin page after it.
 *
 * `replace` on the way out, not `back`: the plugin page belongs to the
 * server just added, and a form that has been submitted is nothing to
 * return to.
 */
export default function AddServerScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()

  /**
   * Whether a card is already holding this screen off the top of the window.
   *
   * Only an iOS modal presentation does. Android draws its modal full-bleed,
   * so there the status bar is ours to clear.
   */
  const hostedInCard = Platform.OS === 'ios' && router.canGoBack()

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Connect a server"
        onBack={() => router.back()}
        // No agent selector on a modal that exists to add one. Switching from
        // inside it would send you to New session with this sheet still up.
        insetTop={!hostedInCard}
      />

      <ConnectForm
        topInset={headerInset}
        bottomInset={insets.bottom}
        onConnected={() => router.replace('/setup/plugin' as never)}
        header={<Text variant="secondary">Agents stay separate. Sessions, settings, and history never mix between them.</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 }
})
