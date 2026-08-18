import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { AgentPill } from '@/ui/components/AgentPill'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { Card } from '@/ui/components/Card'
import { ConnectionBanner } from '@/ui/components/ConnectionBanner'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Activity (§7.5).
 *
 * The design's 2×2 grid also shows CPU, memory and disk. Those three are cut:
 * no endpoint backs them — `hermes monitoring` is OTLP export to an operator
 * endpoint and is "content-free by construction" (§2.6). Applying the design's
 * own rule, the absence is stated once here rather than rendered as three tiles
 * that would always read zero.
 *
 * What is backed — spend, latency, uptime, the event stream — lands in the
 * remaining milestone (M5); this screen currently ships the honest frame.
 */
export default function ActivityScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const { state, attempt } = useActiveConnection()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Activity"
        center={<AgentPill agent={agent} open={switcherOpen} onPress={() => setSwitcherOpen(true)} />}
      />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <ConnectionBanner state={state} attempt={attempt} />

        <Card style={styles.card}>
          <Text variant="rowLabelStrong">Host metrics are not reported</Text>
          <Text variant="secondary">
            Hermes exposes no CPU, memory or disk endpoint, so those tiles are omitted rather than shown empty. Spend,
            latency and the event stream come from the agent itself and land with the Activity milestone.
          </Text>
        </Card>
      </ScrollView>

      <AgentSwitcher
        agents={agents}
        selectedId={agent.id}
        visible={switcherOpen}
        onSelect={select}
        onAddAgent={() => router.push('/agents/new')}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  card: { padding: 14, gap: 6 }
})
