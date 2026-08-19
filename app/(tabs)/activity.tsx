import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { useEventLog } from '@/state/event-log'
import { AgentPill } from '@/ui/components/AgentPill'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { Card, Divider } from '@/ui/components/Card'
import { ConnectionBanner } from '@/ui/components/ConnectionBanner'
import { EventRow } from '@/ui/components/EventRow'
import { IconButton } from '@/ui/components/IconButton'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { StatTile } from '@/ui/components/StatTile'
import { Text } from '@/ui/components/Text'
import { compactTokens, usd } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Activity (§7.5).
 *
 * The design's 2×2 grid also shows CPU, memory and disk. Those three are cut —
 * no endpoint backs them, and `hermes monitoring` is OTLP export that is
 * content-free by construction (§2.6). Applying the design's own rule, the
 * absence is stated once instead of rendering three tiles that always read zero.
 *
 * Everything else here is real: spend and turns from `/api/analytics/usage`,
 * and an event stream fed live off the socket rather than polled.
 */
export default function ActivityScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const { backend, state, attempt } = useActiveConnection()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const capabilities = backend?.capabilities
  const liveEvents = useEventLog(store => store.records)

  const usage = useQuery({
    queryKey: ['agent', agent.id, 'usage'],
    enabled: Boolean(backend) && (capabilities?.activity.spend ?? false),
    queryFn: () => backend!.getUsage()
  })

  // History fills the screen before anything arrives on the socket; the live
  // tail then sits above it.
  const history = useQuery({
    queryKey: ['agent', agent.id, 'events'],
    enabled: Boolean(backend) && (capabilities?.activity.events ?? false),
    queryFn: () => backend!.listEvents(50)
  })

  const events = [...liveEvents, ...(history.data ?? [])].slice(0, 60)

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Activity"
        center={<AgentPill agent={agent} open={switcherOpen} onPress={() => setSwitcherOpen(true)} />}
        right={
          <IconButton
            name="arrows-rotate"
            accessibilityLabel="Refresh activity"
            edge="right"
            disabled={usage.isFetching || history.isFetching}
            onPress={() => {
              void usage.refetch()
              void history.refetch()
            }}
          />
        }
      />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={usage.isFetching || history.isFetching}
            onRefresh={() => {
              void usage.refetch()
              void history.refetch()
            }}
          />
        }
      >
        <ConnectionBanner state={state} attempt={attempt} />

        {capabilities?.activity.spend ? (
          <View style={styles.tiles}>
            <StatTile
              label="Spend today"
              value={usage.data?.spendTodayUsd === null || usage.data === undefined ? '—' : usd(usage.data.spendTodayUsd)}
              detail={usage.data?.spendCapUsd ? `cap ${usd(usage.data.spendCapUsd)}` : 'no cap set'}
              progress={
                usage.data?.spendTodayUsd && usage.data.spendCapUsd
                  ? usage.data.spendTodayUsd / usage.data.spendCapUsd
                  : undefined
              }
              barColor={theme.color.primary}
            />
            <StatTile
              label="Turns today"
              value={usage.data ? String(usage.data.turnsToday) : '—'}
              detail={usage.data ? `${compactTokens(usage.data.tokensToday)} tokens` : undefined}
            />
          </View>
        ) : null}

        <Card style={styles.card}>
          <Text variant="rowLabelStrong">Host metrics are not reported</Text>
          <Text variant="secondary">
            Hermes exposes no CPU, memory or disk endpoint, so those tiles are omitted rather than shown empty. What
            you see above is what the agent itself reports.
          </Text>
        </Card>

        {capabilities?.activity.events ? (
          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text variant="sectionHeader">Event stream</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/logs')}>
                <Text variant="secondary" color={theme.color.primary}>
                  Open logs
                </Text>
              </Pressable>
            </View>

            <Card>
              {events.length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="secondary">
                    {state === 'open' ? 'Nothing yet. Events appear here as the agent works.' : 'Connect to see events.'}
                  </Text>
                </View>
              ) : (
                events.map((record, index) => (
                  <View key={record.id}>
                    {index > 0 ? <Divider /> : null}
                    <EventRow record={record} />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}
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
  tiles: { flexDirection: 'row', gap: 12 },
  card: { padding: 14, gap: 6 },
  group: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  empty: { padding: 16 }
})
