import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { readPushConfig, savePushConfig } from '@/platform/secure-store'
import { useSelectedAgent } from '@/state/agents'
import { useNotificationPrefs } from '@/state/notification-prefs'
import { usePushConfigRevision, usePushRegistration, type PushStatus } from '@/state/push-sync'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { Toggle } from '@/ui/components/Toggle'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Notifications (§7.12) — device-local preferences.
 *
 * These preferences are enforced in two places, and that is deliberate. While
 * the app runs it filters its own local notifications. Once it is closed only
 * the host can decide anything, so the same preferences are sent to the
 * `handheld-push` plugin at registration — see `docs/push-relay.md`.
 *
 * Quiet hours are the exception and stay device-side: they depend on this
 * phone's clock and timezone, which the host does not know.
 */
export default function NotificationsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const prefs = useNotificationPrefs()
  const agent = useSelectedAgent()
  const status = usePushRegistration(agent)

  useEffect(() => {
    void prefs.hydrate()
  }, [prefs])

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Notifications" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card>
          <PrefRow
            label="Approval requests"
            detail="Always, even during quiet hours"
            value={prefs.approvals}
            onChange={next => prefs.set('approvals', next)}
          />
          <Divider />
          <PrefRow
            label="Turn finished"
            detail="When a turn completes while you are away"
            value={prefs.turnComplete}
            onChange={next => prefs.set('turnComplete', next)}
          />
          <Divider />
          <PrefRow
            label="Cron failures"
            detail="Failures only, never successful runs"
            value={prefs.cronFailures}
            onChange={next => prefs.set('cronFailures', next)}
          />
          <Divider />
          <PrefRow
            label="Questions"
            detail="The agent asked something and is waiting"
            value={prefs.clarify}
            onChange={next => prefs.set('clarify', next)}
          />
          <Divider />
          <PrefRow
            label="Artifacts"
            detail="A file, image or video the agent produced"
            value={prefs.artifacts}
            onChange={next => prefs.set('artifacts', next)}
          />
        </Card>

        <View style={styles.group}>
          <Text variant="sectionHeader" style={styles.groupLabel}>
            Quiet hours
          </Text>
          <Card>
            <PrefRow
              label={`Mute ${formatHour(prefs.quietFrom)} – ${formatHour(prefs.quietTo)}`}
              detail="Approvals still ring — the agent is stopped until you answer"
              value={prefs.quietHours}
              onChange={next => prefs.set('quietHours', next)}
            />
          </Card>
        </View>

        <PushSetup agentId={agent.id} status={status} />

        <Card style={styles.noticeCard}>
          <View style={styles.noticeHead}>
            <Icon name="circle-info" size={14} color={theme.color.warning700} />
            <Text variant="rowLabelStrong">Lock-screen Allow / Deny is not available</Text>
          </View>
          <Text variant="secondary">
            A notification opens the session; answering happens in the app. Resolving an approval from the lock screen
            needs the host plugin to present it rather than observe it, which would take over approvals for every
            client on that host — a deliberate second step.
          </Text>
        </Card>
      </ScrollView>
    </View>
  )
}

/**
 * Where this device registers for push.
 *
 * Deliberately plain: two fields and a status line. It exists to prove the path
 * end to end, and the host's own setup (`host/handheld-push/README.md`) is
 * where the URL and secret come from.
 */
function PushSetup({ agentId, status }: { agentId: string; status: PushStatus }) {
  const theme = useTheme()
  const bump = usePushConfigRevision(state => state.bump)
  const [baseUrl, setBaseUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    void readPushConfig(agentId).then(config => {
      if (cancelled) return

      setBaseUrl(config?.baseUrl ?? '')
      // Never re-displayed. Showing a stored secret buys nothing and puts it on
      // screen; an empty field means "unchanged".
      setSecret('')
      setLoaded(true)
    })

    return () => {
      cancelled = true
    }
  }, [agentId])

  const save = async () => {
    const existing = await readPushConfig(agentId)

    await savePushConfig(agentId, {
      baseUrl: baseUrl.trim(),
      secret: secret.trim() || existing?.secret || ''
    })

    // The keychain is not observable, so saving has to say so out loud.
    bump()
  }

  return (
    <View style={styles.group}>
      <Text variant="sectionHeader" style={styles.groupLabel}>
        Push delivery
      </Text>

      <Card style={styles.pushCard}>
        <Text variant="secondary">
          The webhook endpoint on the agent host that registers this device. Its port is the messaging gateway&apos;s,
          not the one the app talks to.
        </Text>

        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          editable={loaded}
          placeholder="http://host:8644"
          placeholderTextColor={theme.color.gray400}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          style={[styles.input, { borderColor: theme.color.border, color: theme.color.gray800 }]}
        />

        <TextInput
          value={secret}
          onChangeText={setSecret}
          editable={loaded}
          placeholder="Route secret (leave blank to keep)"
          placeholderTextColor={theme.color.gray400}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={[styles.input, { borderColor: theme.color.border, color: theme.color.gray800 }]}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => void save()}
          style={[styles.save, { borderColor: theme.color.secondaryMuted, borderRadius: theme.radius.control }]}
        >
          <Text variant="rowLabelStrong" color={theme.color.secondaryDeep}>
            Save and register
          </Text>
        </Pressable>

        <StatusLine status={status} />
      </Card>
    </View>
  )
}

/** What the host currently knows, said plainly — including when it knows nothing. */
function StatusLine({ status }: { status: PushStatus }) {
  const theme = useTheme()

  const [label, color] = {
    unconfigured: ['Not set up — this device receives nothing while closed.', theme.color.gray500],
    unavailable: ['No push token. Remote push needs a development build, not Expo Go.', theme.color.warning700],
    registering: ['Registering…', theme.color.gray500],
    registered: ['Registered. The host will push to this device.', theme.color.success700],
    error: [status.state === 'error' ? status.message : '', theme.color.error700]
  }[status.state] as [string, string]

  return (
    <Text variant="secondary" color={color}>
      {label}
    </Text>
  )
}

function PrefRow({
  label,
  detail,
  value,
  onChange
}: {
  label: string
  detail: string
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text variant="rowLabel">{label}</Text>
        <Text variant="secondary">{detail}</Text>
      </View>
      <Toggle label={label} value={value} onChange={onChange} />
    </View>
  )
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? 'pm' : 'am'
  const twelve = hour % 12 === 0 ? 12 : hour % 12

  return `${twelve}${suffix}`
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 12 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  noticeCard: { padding: 14, gap: 8 },
  pushCard: { padding: 14, gap: 10 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 15
  },
  save: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }
})
