import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { missingCapabilityLabels } from '@/domain'
import { useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { AgentPill } from '@/ui/components/AgentPill'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { Card, Divider } from '@/ui/components/Card'
import { AgentGlyph, Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Settings (§7.4).
 *
 * The list is generated from the connected agent's reported capabilities (§4.1):
 * a row appears because the backend says it has that surface, never because the
 * app hardcodes it. What the agent does not report is named once, as chips —
 * never a blank tile, never a disabled row.
 *
 * Rendering the Hermes settings *forms* from `/api/config/schema` is M4; this
 * screen ships the connection card and the capability-gated navigation.
 */
export default function SettingsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const { backend, state, reconnect } = useActiveConnection()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const capabilities = backend?.capabilities
  const missing = capabilities ? missingCapabilityLabels(capabilities) : []

  const agentRows = [
    { key: 'model', label: 'Model & providers', icon: 'microchip', show: capabilities?.settings.model ?? false },
    { key: 'skills', label: 'Skills', icon: 'book', show: capabilities?.extras.skills ?? false },
    { key: 'mcp', label: 'MCP servers', icon: 'plug', show: capabilities?.extras.mcp ?? false },
    { key: 'cron', label: 'Cron jobs', icon: 'clock', show: capabilities?.extras.cron ?? false }
  ].filter(row => row.show)

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Settings"
        center={<AgentPill agent={agent} open={switcherOpen} onPress={() => setSwitcherOpen(true)} />}
      />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card style={styles.connection}>
          <View style={styles.connectionHead}>
            <View style={[styles.tile, { backgroundColor: theme.color.secondaryTint }]}>
              <AgentGlyph name={agent.icon} size={16} />
            </View>
            <View style={styles.connectionText}>
              <Text variant="rowLabelStrong">{agent.displayName}</Text>
              <Text variant="monoSmall">{agent.host}</Text>
            </View>
            <StateChip state={state} />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={reconnect}
            style={[styles.outlineButton, { borderColor: theme.color.border, borderRadius: theme.radius.control }]}
          >
            <Text variant="rowLabelStrong">Reconnect</Text>
          </Pressable>
        </Card>

        {agentRows.length ? (
          <View style={styles.group}>
            <Text variant="sectionHeader" style={styles.groupLabel}>
              Agent
            </Text>
            <Card>
              {agentRows.map((row, index) => (
                <View key={row.key}>
                  {index > 0 ? <Divider /> : null}
                  <SettingsRow label={row.label} icon={row.icon} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text variant="sectionHeader" style={styles.groupLabel}>
            This phone
          </Text>
          <Card>
            <SettingsRow label="Notifications" icon="bell" />
            <Divider />
            <SettingsRow label="Logs & usage" icon="list" />
          </Card>
        </View>

        {missing.length ? (
          <Card style={styles.missingCard}>
            <Text variant="rowLabelStrong">{`${agent.displayName} does not report`}</Text>
            <View style={styles.chips}>
              {missing.map(label => (
                <View
                  key={label}
                  style={[
                    styles.chip,
                    { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, borderRadius: theme.radius.pill }
                  ]}
                >
                  <Text variant="pill" color={theme.color.gray500}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
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

function SettingsRow({ label, icon, value }: { label: string; icon: string; value?: string }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="button" style={styles.row}>
      <View style={[styles.rowTile, { backgroundColor: theme.color.secondaryTint }]}>
        <Icon name={icon} size={13} color={theme.color.secondary} />
      </View>
      <Text variant="rowLabel" style={styles.rowLabel}>
        {label}
      </Text>
      {value ? <Text variant="monoSmall">{value}</Text> : null}
      <Icon name="chevron-right" size={11} color={theme.color.gray400} />
    </Pressable>
  )
}

function StateChip({ state }: { state: string }) {
  const theme = useTheme()
  const connected = state === 'open'

  return (
    <View
      style={[
        styles.stateChip,
        {
          backgroundColor: connected ? theme.color.success50 : theme.color.warning50,
          borderColor: connected ? theme.color.success200 : theme.color.warning200,
          borderRadius: theme.radius.pill
        }
      ]}
    >
      <Text variant="pill" color={connected ? theme.color.success700 : theme.color.warning700}>
        {connected ? 'Connected' : state}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  connection: { padding: 14, gap: 12 },
  connectionHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  connectionText: { flex: 1, minWidth: 0, gap: 2 },
  tile: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outlineButton: { height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  rowTile: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, minWidth: 0 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth },
  missingCard: { padding: 14, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderWidth: StyleSheet.hairlineWidth }
})
