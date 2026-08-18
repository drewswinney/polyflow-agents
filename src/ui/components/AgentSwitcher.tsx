import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, AgentId } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { AgentGlyph, Icon } from './Icon'
import { Text } from './Text'

/**
 * The agent switcher popover (§7.13).
 *
 * Selecting an agent re-scopes the entire app — sessions, activity, settings,
 * history. Nothing merges across agents (§5.2), which is why this is a switch
 * and not a filter.
 *
 * Offline agents stay listed, dimmed, rather than disappearing: an agent you
 * cannot reach is still an agent you own.
 */
export function AgentSwitcher({
  agents,
  selectedId,
  visible,
  onSelect,
  onAddAgent,
  onDismiss
}: {
  agents: Agent[]
  selectedId: AgentId
  visible: boolean
  onSelect: (id: AgentId) => void
  onAddAgent: () => void
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
          {agents.map(agent => (
            <AgentRow
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              onPress={() => {
                onSelect(agent.id)
                onDismiss()
              }}
            />
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onDismiss()
              onAddAgent()
            }}
            style={styles.row}
          >
            <View style={styles.dotSlot}>
              <Icon name="plus" size={10} color={theme.color.primary} />
            </View>
            <Text variant="rowLabel" color={theme.color.primary} style={styles.addLabel}>
              Add an agent
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function AgentRow({ agent, selected, onPress }: { agent: Agent; selected: boolean; onPress: () => void }) {
  const theme = useTheme()
  const offline = agent.connection === 'offline'

  const dotColor = offline
    ? theme.color.warning700
    : agent.connection === 'connected'
      ? theme.color.successDot
      : theme.color.gray400

  const token = offline
    ? `${agent.kind} · offline`
    : agent.connection === 'idle'
      ? `${agent.kind} · idle`
      : agent.latencyMs
        ? `${agent.kind} · ${agent.latencyMs}ms`
        : agent.kind

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.dotSlot}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      </View>
      <View style={styles.glyphSlot}>
        <AgentGlyph name={agent.icon} size={13} />
      </View>

      {/* name flexes and never wraps; the token never shrinks (design §13). */}
      <Text
        variant={selected ? 'rowLabelStrong' : 'rowLabel'}
        numberOfLines={1}
        color={offline ? theme.color.gray400 : theme.color.gray900}
        style={styles.name}
      >
        {agent.displayName}
      </Text>
      <Text variant="monoSmall" numberOfLines={1} color={offline ? theme.color.warning700 : theme.color.gray400}>
        {token}
      </Text>

      {selected ? <Icon name="check" size={11} color={theme.color.secondary} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,17,32,0.28)' },
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  popover: { width: 256, paddingVertical: 5, overflow: 'hidden' },
  row: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 },
  dotSlot: { width: 8, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  glyphSlot: { width: 13, alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 13.5 },
  addLabel: { flex: 1, fontSize: 13.5 }
})
