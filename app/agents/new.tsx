import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Agent, AgentKind } from '@/domain'
import { saveAgentToken } from '@/platform/secure-store'
import { useAgents } from '@/state/agents'
import { Card } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useGradient, useTheme } from '@/ui/ThemeProvider'

/**
 * Add an agent (§7.14).
 *
 * Kind comes first because it determines everything after it — a Hermes agent
 * gets the full surface, anything else is reduced to model and tools (§4.1).
 *
 * Enrolment is host + token, typed. The design leads with a QR scanner and names
 * `hermes pair`; neither exists — `hermes pairing` is list/approve/revoke/
 * clear-pending with no token issuance and no QR flow (§2.6) — so the manual
 * path is the primary one until the CLI grows the other.
 */
export default function AddAgentScreen() {
  const theme = useTheme()
  const gradient = useGradient()
  const insets = useSafeAreaInsets()
  const add = useAgents(state => state.add)

  const [kind, setKind] = useState<AgentKind>('hermes')
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [revealToken, setRevealToken] = useState(false)
  const [saving, setSaving] = useState(false)

  const ready = host.trim().length > 0 && token.trim().length > 0 && displayName.trim().length > 0

  const save = async () => {
    if (!ready || saving) return

    setSaving(true)

    const agent: Agent = {
      id: `agent-${Date.now().toString(36)}`,
      displayName: displayName.trim(),
      kind,
      icon: kind === 'hermes' ? 'server' : 'cloud',
      host: host.trim(),
      authMode: 'token',
      // Reachability is probed on connect; an offline host can still be saved.
      connection: 'offline'
    }

    await saveAgentToken(agent.id, token.trim())
    await add(agent)
    router.back()
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Add an agent" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Text variant="secondary">
          Agents stay separate. Sessions, settings, and history never mix between them.
        </Text>

        <KindCard
          selected={kind === 'hermes'}
          title="Another Hermes"
          detail="Full support — voice, skills, cron, MCP, approvals"
          onPress={() => setKind('hermes')}
        />
        <KindCard
          selected={kind === 'other'}
          title="Something else"
          detail="Any agent that speaks OpenAI-compatible streaming"
          onPress={() => setKind('other')}
        />

        <Field label="Host and port" value={host} onChange={setHost} placeholder="hermes.tailnet.ts.net:9119" mono />
        <Field
          label="Pairing token"
          value={token}
          onChange={setToken}
          placeholder="paste the token from the host"
          secure={!revealToken}
          mono
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={revealToken ? 'Hide token' : 'Show token'}
              onPress={() => setRevealToken(value => !value)}
            >
              <Icon name={revealToken ? 'eye-slash' : 'eye'} size={14} color={theme.color.gray400} />
            </Pressable>
          }
        />
        <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="garage pi" />

        <Text variant="secondary">
          Approve this device on the host with `hermes pairing approve`. Reachability is checked when you connect —
          an offline host can still be saved.
        </Text>

        <Pressable accessibilityRole="button" disabled={!ready} onPress={() => void save()}>
          <LinearGradient
            colors={ready ? gradient.colors : [theme.color.bgSubtle, theme.color.bgSubtle]}
            start={gradient.start}
            end={gradient.end}
            style={[styles.primary, { borderRadius: theme.radius.control }]}
          >
            <Text variant="rowLabelStrong" color={ready ? '#ffffff' : theme.color.gray400}>
              Pair and connect
            </Text>
          </LinearGradient>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function KindCard({
  selected,
  title,
  detail,
  onPress
}: {
  selected: boolean
  title: string
  detail: string
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card style={{ ...styles.kindCard, borderColor: selected ? theme.color.secondaryMuted : theme.color.border }}>
        <Icon
          name={selected ? 'circle-check' : 'circle'}
          size={16}
          color={selected ? theme.color.secondary : theme.color.gray400}
        />
        <View style={styles.kindText}>
          <Text variant="rowLabelStrong">{title}</Text>
          <Text variant="secondary">{detail}</Text>
        </View>
      </Card>
    </Pressable>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  mono,
  trailing
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  secure?: boolean
  mono?: boolean
  trailing?: React.ReactNode
}) {
  const theme = useTheme()

  return (
    <View style={styles.field}>
      <Text variant="sectionHeader">{label}</Text>
      <View
        style={[
          styles.input,
          { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, borderRadius: theme.radius.control }
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.gray400}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.inputText,
            { color: theme.color.gray800, fontFamily: mono ? theme.font.mono : theme.font.body }
          ]}
        />
        {trailing}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  kindCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  kindText: { flex: 1, minWidth: 0, gap: 2 },
  field: { gap: 6 },
  input: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1 },
  inputText: { flex: 1, fontSize: 14 },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4 }
})
