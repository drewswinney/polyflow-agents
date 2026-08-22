import { LinearGradient } from 'expo-linear-gradient'
import { Redirect, router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAgents } from '@/state/agents'
import { Icon } from '@/ui/components/Icon'
import { Text } from '@/ui/components/Text'
import { useGradient, useTheme } from '@/ui/ThemeProvider'

/**
 * First run — what this app is, before it asks for anything.
 *
 * Pairing used to be the first screen anyone saw: a form asking for a host, a
 * port and a password before saying what any of it was for. This says the three
 * things that make the rest make sense — the agent is not on the phone, it
 * keeps working without you, and it will interrupt you when it needs a decision
 * — and then hands over to that form.
 *
 * Deliberately plain: this is a working baseline for the flow, not a designed
 * splash. Type, spacing and copy are all placeholders for a real pass.
 */
export default function WelcomeScreen() {
  const theme = useTheme()
  const gradient = useGradient()
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
        <View style={[styles.ring, { borderColor: theme.color.secondaryMuted }]}>
          <Icon name="server" size={30} color={theme.color.secondary} />
        </View>

        <View style={styles.headline}>
          <Text variant="screenTitle">Your agent, in your pocket</Text>
          <Text variant="secondary" style={styles.lede}>
            This app is a window onto an agent running somewhere else — your own machine, your own network.
          </Text>
        </View>

        <View style={styles.points}>
          <Point
            icon="server"
            title="It runs on your host, not your phone"
            detail="Sessions live on the machine you pair with. Closing the app does not stop the work."
          />
          <Point
            icon="circle-check"
            title="It waits for you on the decisions"
            detail="Anything needing permission halts that session and asks, in the transcript, with a deadline."
          />
          <Point
            icon="bell"
            title="It says when it is blocked"
            detail="A push tells you an agent is waiting, so you do not have to keep checking."
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
        {hydrationError ? (
          <Text variant="secondary" color={theme.color.error700} style={styles.footnote}>
            {`Saved servers could not be read, so this is starting empty: ${hydrationError}`}
          </Text>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => router.push('/servers/new')}>
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={[styles.primary, { borderRadius: theme.radius.control }]}
          >
            <Text variant="rowLabelStrong" color="#ffffff">
              Next
            </Text>
          </LinearGradient>
        </Pressable>

        <Text variant="secondary" style={styles.footnote}>
          You will need the host and port of a running agent, and its password or token.
        </Text>
      </View>
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
  body: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, gap: 26 },
  ring: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headline: { gap: 8 },
  lede: { lineHeight: 21 },
  points: { gap: 18 },
  point: { flexDirection: 'row', gap: 12 },
  pointTile: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, minWidth: 0, gap: 3 },
  footer: { paddingHorizontal: 24, paddingTop: 8, gap: 10 },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center' },
  footnote: { textAlign: 'center' }
})
