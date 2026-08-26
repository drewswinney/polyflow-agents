import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { missingCapabilityLabels, NO_CAPABILITIES } from '@/domain'
import { forgetAgentCredential } from '@/platform/secure-store'
import { useBackend, useConnectionState, useReconnect } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent, useSelectedAgentOrNull, useSelectedServerOrNull, useSelectAgent } from '@/state/agents'
import { useSidebar } from '@/state/sidebar'
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
  // Nullable *and* not: removing the agent this screen is about empties the
  // registry under it, and the render that follows must not read a row that is
  // no longer there. The redirect below is the guard; `agent` is what every
  // line past it uses.
  const maybeAgent = useSelectedAgentOrNull()
  const agent = useSelectedAgent()
  const server = useSelectedServerOrNull()
  const servers = useAgents(state => state.servers)
  const agents = useAgents(state => state.agents)
  const selectAgent = useSelectAgent()
  const dismissAgent = useAgents(state => state.dismissAgent)
  const removeServer = useAgents(state => state.removeServer)
  const backend = useBackend()
  
  // Compute this from the already-subscribed `agents` list, not a second selector.
  // A filter inside a selector builds a new array on every read, and zustand compares
  // by identity — one that never returns the same value causes infinite re-renders.
  const onThisServer = agents.filter(candidate => candidate.serverId === server?.id)
  const state = useConnectionState()
  const reconnect = useReconnect()
  const openSidebar = useSidebar(store => store.show)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // Home is the app's one gate on an empty registry: it sends you to the
  // introduction, and that is where removing the last server should land.
  // Narrowed past this point for the same reason `agent` is: an agent without
  // its server is not a state the registry can be in.
  if (!maybeAgent || !server) return <Redirect href="/" />

  const forgetServer = async () => {
    const id = server.id

    // The credential first. The registry row is what makes it findable, so
    // dropping the row first is what strands a secret in the keychain. Push
    // registration is no longer among them — it lives on the host, keyed by the
    // device's own token, and is dropped when Expo reports the token dead.
    await forgetAgentCredential(id)
    await removeServer(id)

    router.replace('/')
  }

  const confirmForget = () => {
    // Naming the count is the whole point. You reached this row from one agent,
    // and on a host with three the damage is three times what the button looks
    // like it does.
    const count = onThisServer.length
    const scope = count > 1 ? `all ${count} agents on it` : 'the agent on it'

    Alert.alert(
      `Remove ${server.displayName}?`,
      `This phone forgets its address, its credential and ${scope}. Nothing on the host changes — sessions there keep running, and pairing again picks them back up.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void forgetServer() }
      ]
    )
  }

  const capabilities = backend?.capabilities ?? NO_CAPABILITIES
  const missing = missingCapabilityLabels(capabilities)

  // A row appears because the backend reports that surface *and* there is a
  // screen behind it. A row that navigates nowhere is worse than an absent one —
  // the design's rule is that what is missing is stated once, never rendered as
  // something you can press.
  const agentRows = [
    {
      key: 'model',
      label: 'Model & providers',
      icon: 'microchip',
      show: capabilities?.settings.model ?? false,
      go: () => router.push('/model')
    },
    {
      key: 'tools',
      label: 'Tools & integrations',
      icon: 'plug',
      show: (capabilities?.extras.mcp ?? false) || (capabilities?.extras.skills ?? false),
      go: () => router.push('/tools')
    },
    {
      key: 'cron',
      label: 'Cron jobs',
      icon: 'clock',
      show: capabilities?.extras.cron ?? false,
      go: () => router.push('/cron')
    },
    {
      key: 'config',
      label: 'Agent configuration',
      icon: 'sliders',
      show: capabilities?.settings.schemaDriven ?? false,
      go: () => router.push('/config')
    }
  ].filter(row => row.show)

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Settings"
        onMenu={openSidebar}
        center={
            <AgentPill
              agent={agent}
              connection={server?.connection ?? 'offline'}
              open={switcherOpen}
              onPress={() => setSwitcherOpen(true)}
            />
          }
      />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card style={styles.connection}>
          <View style={styles.connectionHead}>
            <View style={[styles.tile, { backgroundColor: theme.color.secondaryTint }]}>
              <AgentGlyph name={agent.icon} size={16} />
            </View>
            <View style={styles.connectionText}>
              <Text variant="rowLabelStrong">{server.displayName}</Text>
              <Text variant="monoSmall">
                {server.version ? `${server.host} · ${server.kind} ${server.version}` : server.host}
              </Text>
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
              {agent.displayName}
            </Text>
            <Card>
              {agentRows.map((row, index) => (
                <View key={row.key}>
                  {index > 0 ? <Divider /> : null}
                  <SettingsRow label={row.label} icon={row.icon} onPress={row.go} />
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
            <SettingsRow label="Notifications" icon="bell" onPress={() => router.push('/notifications')} />
            <Divider />
            <SettingsRow label="Theme" icon="moon" onPress={() => router.push('/theme')} />
            <Divider />
            <SettingsRow label="Logs & events" icon="list" onPress={() => router.push('/logs')} />
          </Card>
        </View>

        <View style={styles.group}>
          <Text variant="sectionHeader" style={styles.groupLabel}>
            Server
          </Text>
          <Card>
            {/* The server, not the agent. An agent is a thing the host reports,
                so removing one here would leave a row the next connect restores
                (§5.2a) — what you can actually forget is the host. */}
            <Pressable accessibilityRole="button" onPress={confirmForget} style={styles.row}>
              <View style={[styles.rowTile, { backgroundColor: theme.color.error50 }]}>
                <Icon name="trash" size={13} color={theme.color.error700} />
              </View>
              <Text variant="rowLabel" color={theme.color.error700} style={styles.rowLabel}>
                {`Remove ${server.displayName}`}
              </Text>
              {onThisServer.length > 1 ? (
                <Text variant="monoSmall" color={theme.color.gray400}>
                  {`${onThisServer.length} agents`}
                </Text>
              ) : null}
            </Pressable>
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
        servers={servers}
        agents={agents}
        selectedId={agent.id}
        visible={switcherOpen}
        onSelect={selectAgent}
        onDismissAgent={id => void dismissAgent(id)}
        onAddServer={() => router.push('/servers/new')}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </View>
  )
}

function SettingsRow({
  label,
  icon,
  value,
  onPress
}: {
  label: string
  icon: string
  value?: string
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
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
