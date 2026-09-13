import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MOCK_HOST } from '@/backends/mock-host'
import { useAgents } from '@/state/agents'
import { Icon } from '@/ui/components/Icon'
import { SetupButton, SetupFooter, SetupLink } from '@/ui/components/SetupChrome'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Setup, page one of three (§7.8): what this app is, before it asks for anything.
 *
 * The logo and the name, one line on what the app is, and the three things
 * you will do here — talk to the agent, see what it makes (its Artifacts),
 * approve what needs approving — each of which is a screen in the app.
 * Then one button, to the page that asks for a host — and under it, the way
 * in for someone with no host: a demo agent that runs inside the app
 * (`MockBackend`), scripted but complete, so the app can be seen working
 * before there is anything to connect it to. That is also what a store
 * reviewer gets, since they have no Hermes either.
 */
export default function WelcomeScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agents = useAgents(state => state.agents)
  const addServer = useAgents(state => state.addServer)
  // Falling back to an empty registry was honest when it meant re-pairing one
  // host. It is not now that one bad read can drop several servers at once, so
  // the first-run screen — where you land when that happens — says so.
  const hydrationError = useAgents(state => state.hydrationError)
  const [startingDemo, setStartingDemo] = useState(false)

  // The only way in is the first-run redirect, which stops applying the moment
  // an agent exists — so arriving here with one means going back out.
  if (agents.length > 0) return <Redirect href="/" />

  /**
   * The demo needs no form: the sentinel host is what selects the in-process
   * backend (`registry`), and the connection layer supplies its credential.
   * Straight home afterwards — there is no host to put a plugin on.
   */
  const startDemo = async () => {
    if (startingDemo) return

    setStartingDemo(true)

    try {
      await addServer(
        { id: `server-${Date.now().toString(36)}`, displayName: 'Demo', kind: 'hermes', host: MOCK_HOST, authMode: 'token', connection: 'idle' },
        [{ scope: null, label: 'Demo agent', isDefault: true }]
      )
      router.replace('/')
    } finally {
      setStartingDemo(false)
    }
  }

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
          <Point icon="comments" title="Talk to your agent from anywhere" detail="Type, dictate, or send a photo. It picks up where you left off." />
          <Point icon="box-archive" title="Everything it makes, kept as Artifacts" detail="Reports, pages, images and files it produces, ready to open and share." />
          <Point icon="circle-check" title="Approve the risky bits" detail="When it needs permission, you get a push and a one-tap Allow or Deny." />
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

        <SetupLink label={startingDemo ? 'Starting the demo…' : 'No host yet? Try the demo agent'} onPress={() => void startDemo()} />
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
