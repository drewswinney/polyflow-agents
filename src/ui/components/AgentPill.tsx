import { Pressable, StyleSheet, View } from 'react-native'

import type { Agent, AgentConnection } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { AgentGlyph, Icon } from './Icon'
import { Text } from './Text'

/**
 * The centered agent selector. On every top-level screen the selected agent
 * sits absolutely centered in the header, riding above the title's optical
 * centre. Sub-screens do not show it — the agent is established by how you got
 * there (design §Global chrome).
 *
 * Reachability is passed in rather than read off the agent: it belongs to the
 * server (§5.2 rule 4), because it is one socket serving every agent on a host.
 */
export function AgentPill({
  agent,
  connection,
  open,
  onPress,
  disabled = false
}: {
  agent: Agent
  connection: AgentConnection
  open: boolean
  onPress?: () => void
  disabled?: boolean
}) {
  const theme = useTheme()

  const dotColor =
    connection === 'connected'
      ? theme.color.successDot
      : connection === 'idle'
        ? theme.color.gray400
        : theme.color.warning700

  const pillColor = disabled
    ? theme.color.bgSubtle
    : open
      ? theme.color.secondaryTint
      : theme.color.bgSubtle

  const textColor = disabled
    ? theme.color.gray500
    : open
      ? theme.color.secondaryDeep
      : theme.color.gray800

  const iconColor = disabled
    ? theme.color.gray500
    : open
      ? theme.color.secondaryDeep
      : theme.color.gray600

  return (
    <Pressable
      accessibilityRole={disabled ? undefined : 'button'}
      accessibilityLabel={disabled ? `Selected agent ${agent.displayName}` : undefined}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: pillColor,
          borderColor: disabled ? theme.color.border : open ? theme.color.secondaryMuted : theme.color.border,
          borderRadius: theme.radius.pill
        }
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={styles.glyphSlot}>
        <AgentGlyph name={agent.icon} />
      </View>
      <Text variant="pill" numberOfLines={1} color={textColor}>
        {agent.displayName}
      </Text>
      {!disabled && (
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={9}
          color={iconColor}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 9,
    borderWidth: 1
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  glyphSlot: { width: 18, alignItems: 'center' }
})
