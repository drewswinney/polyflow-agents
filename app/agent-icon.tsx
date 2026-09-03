import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAgents, useSelectedAgentOrNull } from '@/state/agents'
import type { AgentIconName } from '@/domain'
import { Card } from '@/ui/components/Card'
import { AGENT_ICONS, AgentGlyph } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useGradient, useTheme } from '@/ui/ThemeProvider'

/**
 * The glyph one agent wears.
 *
 * Scoped to the selected agent, like every other screen under Settings — you
 * change another agent's glyph by switching to it, not by picking it out of a
 * list here. That keeps one rule for what "this agent" means across the app.
 *
 * The choice is phone-side. The host names an identity and says nothing about
 * how it should look, so nothing here crosses the §4 seam and nothing has to be
 * reconciled when a server re-reports its agents.
 */
export default function AgentIconScreen() {
  const theme = useTheme()
  const gradient = useGradient()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgentOrNull()
  const setAgentIcon = useAgents(state => state.setAgentIcon)

  // Reachable with no agent only by deep link — Settings cannot offer the row
  // without one. Say so rather than rendering an empty grid of glyphs that
  // belong to nothing.
  if (!agent) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
        <ScreenHeader title="Icon" onBack={() => router.back()} />
        <View style={styles.empty}>
          <Text variant="secondary">Add a server before choosing an icon.</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Icon"
        subtitle={<Text variant="monoSmall">{agent.displayName}</Text>}
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card style={styles.grid}>
          {AGENT_ICONS.map(icon => (
            <IconTile
              key={icon}
              icon={icon}
              selected={icon === agent.icon}
              gradient={gradient}
              onPress={() => setAgentIcon(agent.id, icon)}
            />
          ))}
        </Card>

        <Text variant="secondary" color={theme.color.gray400} style={styles.footnote}>
          Shown wherever {agent.displayName} appears — the agent pill, the switcher, and a new session.
        </Text>
      </ScrollView>
    </View>
  )
}

/**
 * One glyph to choose. The selected one wears the same gradient disc the new
 * session screen gives it, so the picker shows the thing itself rather than a
 * swatch you have to imagine in place.
 */
function IconTile({
  icon,
  selected,
  gradient,
  onPress
}: {
  icon: AgentIconName
  selected: boolean
  gradient: ReturnType<typeof useGradient>
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={icon}
      onPress={onPress}
      style={styles.tileSlot}
    >
      {selected ? (
        <LinearGradient colors={gradient.colors} start={gradient.start} end={gradient.end} style={styles.tile}>
          <AgentGlyph name={icon} size={18} color={theme.color.onAccent} />
        </LinearGradient>
      ) : (
        <View style={[styles.tile, { backgroundColor: theme.color.bgSubtle }]}>
          <AgentGlyph name={icon} size={18} color={theme.color.gray500} />
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 9 },
  // Six per row on the narrowest phone the design targets, and the tile centred
  // in whatever that leaves — a fixed gap would round differently per width and
  // leave the last column short.
  tileSlot: { width: '16.66%', alignItems: 'center', paddingVertical: 7 },
  tile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  footnote: { paddingHorizontal: 4, paddingTop: 12 }
})
