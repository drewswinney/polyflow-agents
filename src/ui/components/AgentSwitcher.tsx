import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, AgentId, Server, ServerId } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { AgentGlyph, Icon } from './Icon'
import { Text } from './Text'

/**
 * The agent switcher popover (§7.13), grouped by server.
 *
 * Selecting an agent re-scopes the entire app — sessions, activity, settings,
 * history. Nothing merges across agents (§5.2), which is why this is a switch
 * and not a filter.
 *
 * Reachability is drawn **once per group**, not once per row: one host is one
 * socket, so every agent under an unreachable server is unreachable together
 * (§5.2 rule 4). Offline servers stay listed and dimmed rather than
 * disappearing — a host you cannot reach is still a host you own.
 */
export function AgentSwitcher({
  servers,
  agents,
  selectedId,
  visible,
  onSelect,
  onDismissAgent,
  onAddServer,
  onDismiss
}: {
  servers: Server[]
  agents: Agent[]
  selectedId: AgentId
  visible: boolean
  onSelect: (id: AgentId) => void
  /** Forgets an agent the host has stopped reporting (§5.2a). */
  onDismissAgent: (id: AgentId) => void
  onAddServer: () => void
  onDismiss: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  if (!visible) return null

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      {/* The scrim covers the list region only; the header stays clear so the
          pill you just tapped remains legible. */}
      <Pressable style={[styles.scrim, { top: insets.top + 52 }]} onPress={onDismiss} />

      <View style={[styles.anchor, { top: insets.top + 52 + 10 }]} pointerEvents="box-none">
        <View
          style={[
            styles.popover,
            theme.shadow.sheet,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.row }
          ]}
        >
          {servers.map((server, index) => (
            <ServerGroup
              key={server.id}
              server={server}
              first={index === 0}
              agents={agents.filter(agent => agent.serverId === server.id)}
              selectedId={selectedId}
              onSelect={id => {
                onSelect(id)
                onDismiss()
              }}
              onDismissAgent={onDismissAgent}
            />
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onDismiss()
              onAddServer()
            }}
            style={styles.row}
          >
            <View style={styles.dotSlot}>
              <Icon name="plus" size={10} color={theme.color.primary} />
            </View>
            <Text variant="rowLabel" color={theme.color.primary} style={styles.addLabel}>
              Connect a server
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

/**
 * One host and everything on it.
 *
 * The header carries the name, the kind and the state — the three things that
 * used to be crammed into every row's token, back when one agent meant one
 * host. Saying it once is both less noise and more truthful.
 */
function ServerGroup({
  server,
  agents,
  first,
  selectedId,
  onSelect,
  onDismissAgent
}: {
  server: Server
  agents: Agent[]
  first: boolean
  selectedId: AgentId
  onSelect: (id: AgentId) => void
  onDismissAgent: (id: ServerId) => void
}) {
  const theme = useTheme()
  const offline = server.connection === 'offline'

  const dotColor = offline
    ? theme.color.warning700
    : server.connection === 'connected'
      ? theme.color.successDot
      : theme.color.gray400

  const token = offline
    ? `${server.kind} · offline`
    : server.connection === 'idle'
      ? `${server.kind} · idle`
      : server.latencyMs
        ? `${server.kind} · ${server.latencyMs}ms`
        : server.kind

  return (
    <View>
      <View style={[styles.groupHead, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border }]}>
        <View style={styles.dotSlot}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>
        <Text variant="pill" numberOfLines={1} color={theme.color.gray500} style={styles.groupName}>
          {server.displayName}
        </Text>
        <Text variant="monoSmall" numberOfLines={1} color={offline ? theme.color.warning700 : theme.color.gray400}>
          {token}
        </Text>
      </View>

      {agents.map(agent => (
        <AgentRow
          key={agent.id}
          agent={agent}
          offline={offline}
          selected={agent.id === selectedId}
          onPress={() => onSelect(agent.id)}
          onDismiss={() => onDismissAgent(agent.id)}
        />
      ))}
    </View>
  )
}

function AgentRow({
  agent,
  offline,
  selected,
  onPress,
  onDismiss
}: {
  agent: Agent
  offline: boolean
  selected: boolean
  onPress: () => void
  onDismiss: () => void
}) {
  const theme = useTheme()
  // An agent the host has stopped reporting (§5.2a). Still selectable — its
  // stored sessions are still worth reading — but it will not accept a turn,
  // and the row says so rather than letting a send fail to explain itself.
  const missing = Boolean(agent.missing)
  const dimmed = offline || missing

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.dotSlot} />
      <View style={styles.glyphSlot}>
        <AgentGlyph name={agent.icon} size={13} />
      </View>

      {/* name flexes and never wraps; the token never shrinks (design §13). */}
      <Text
        variant={selected ? 'rowLabelStrong' : 'rowLabel'}
        numberOfLines={1}
        color={dimmed ? theme.color.gray400 : theme.color.gray900}
        style={styles.name}
      >
        {agent.displayName}
      </Text>

      {missing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Forget ${agent.displayName}`}
          hitSlop={8}
          onPress={onDismiss}
        >
          <Icon name="trash" size={11} color={theme.color.warning700} />
        </Pressable>
      ) : agent.hint ? (
        <Text variant="monoSmall" numberOfLines={1} color={theme.color.gray400}>
          {agent.hint}
        </Text>
      ) : null}

      {selected ? <Icon name="check" size={11} color={theme.color.secondary} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,17,32,0.28)' },
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  popover: { width: 256, paddingVertical: 5, overflow: 'hidden' },
  groupHead: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 },
  groupName: { flex: 1, minWidth: 0 },
  row: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 },
  dotSlot: { width: 8, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  glyphSlot: { width: 13, alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 13.5 },
  addLabel: { flex: 1, fontSize: 13.5 }
})
