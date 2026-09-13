import { Redirect, router } from 'expo-router'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAgents } from '@/state/agents'
import { Icon } from '@/ui/components/Icon'
import { SetupButton, SetupFooter } from '@/ui/components/SetupChrome'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Setup, page one of three (§7.8): what this app is, before it asks for anything.
 *
 * The logo and the name, one line on what the app is, and the three things
 * that make the rest make sense — the agent is not on the phone, it keeps
 * working without you, and it will interrupt you when it needs a decision.
 * Then one button, to the page that asks for a host.
 */
export default function WelcomeScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agents = useAgents(state => state.agents)
  // Falling back to an empty registry was honest when it meant re-pairing one
  // host. It is not now that one bad read can drop several servers at once, so
  // the first-run screen — where you land when that happens — says so.
  const hydrationError = useAgents(state => state.hydrationError)

  // The only way in is the first-run redirect, which stops applying the moment
  // an agent exists — so arriving here with one means going back out.
  if (agents.length > 0) return <Redirect href="/" />

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.brand}>
          {/* The splash mark, not the app icon: no tile behind it, so it sits
              on the page's own background in either theme. */}
          <Image source={require('../../assets/images/splash-icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text variant="screenTitle" style={styles.name}>
            Polyflow Agents
          </Text>
          <Text variant="secondary" style={styles.lede}>
            A window onto an agent running on your own machine — talk to it, see what it makes, and answer it when it asks.
          </Text>
        </View>

        <View style={styles.points}>
          <Point icon="server" title="It runs on your host, not your phone" detail="Sessions live on the machine you connect to. Closing the app does not stop the work." />
          <Point icon="circle-check" title="It waits for you on the decisions" detail="Anything needing permission halts that session and asks, in the transcript." />
          <Point icon="bell" title="It says when it is blocked" detail="A push tells you an agent is waiting, so you do not have to keep checking." />
        </View>
      </ScrollView>

      <SetupFooter step="welcome" bottomInset={insets.bottom}>
        {hydrationError ? (
          <Text variant="secondary" color={theme.color.error700} style={styles.footnote}>
            {`Saved servers could not be read, so this is starting empty: ${hydrationError}`}
          </Text>
        ) : null}

        <SetupButton label="Get started" onPress={() => router.push('/setup/connect' as never)} />

        <Text variant="secondary" style={styles.footnote}>
          You will need the address of a running Hermes and its sign-in.
        </Text>
      </SetupFooter>
    </View>
  )
}

function Point({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  const theme = useTheme()

  return (
    <View style={styles.point}>
      <View style={[styles.pointTile, { backgroundColor: theme.color.secondaryTint }]}>
        <Icon name={icon} size={13} color={theme.color.secondary} />
      </View>
      <View style={styles.pointText}>
        <Text variant="rowLabelStrong">{title}</Text>
        <Text variant="secondary">{detail}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 34 },
  brand: { alignItems: 'center', gap: 10 },
  logo: { width: 120, height: 120 },
  name: { textAlign: 'center' },
  lede: { textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  points: { gap: 18 },
  point: { flexDirection: 'row', gap: 12 },
  pointTile: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, minWidth: 0, gap: 3 },
  footnote: { textAlign: 'center' }
})
