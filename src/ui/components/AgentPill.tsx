import { Pressable, StyleSheet, View } from 'react-native'

import type { Agent } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { AgentGlyph, Icon } from './Icon'
import { Text } from './Text'

/**
 * The centered agent selector. On every top-level screen the selected agent
 * sits absolutely centered in the header, riding above the title's optical
 * centre. Sub-screens do not show it — the agent is established by how you got
 * there (design §Global chrome).
 */
export function AgentPill({ agent, open, onPress }: { agent: Agent; open: boolean; onPress: () => void }) {
  const theme = useTheme()

  const dotColor =
    agent.connection === 'connected'
      ? theme.color.successDot
      : agent.connection === 'idle'
        ? theme.color.gray400
        : theme.color.warning700

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Selected agent ${agent.displayName}`}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: open ? theme.color.secondaryTint : theme.color.bgSubtle,
          borderColor: open ? theme.color.secondaryMuted : theme.color.border,
          borderRadius: theme.radius.pill
        }
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={styles.glyphSlot}>
        <AgentGlyph name={agent.icon} />
      </View>
      <Text variant="pill" numberOfLines={1} color={open ? theme.color.secondaryDeep : theme.color.gray800}>
        {agent.displayName}
      </Text>
      <Icon
        name={open ? 'chevron-up' : 'chevron-down'}
        size={9}
        color={open ? theme.color.secondaryDeep : theme.color.gray600}
      />
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
