import { router } from 'expo-router'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useSelectedAgent } from '@/state/agents'
import { useBackend } from '@/state/ConnectionProvider'
import { useNotificationPrefs } from '@/state/notification-prefs'
import { usePushRegistration, type PushStatus } from '@/state/push-sync'
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
 * `polyflow_agents_push` plugin at registration — see `docs/push-relay.md`.
 *
 * Quiet hours are the exception and stay device-side: they depend on this
 * phone's clock and timezone, which the host does not know.
 */
export default function NotificationsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const prefs = useNotificationPrefs()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const status = usePushRegistration(backend, agent)

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

        <PushDelivery status={status} />

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
 * Whether this device will hear anything while the app is closed.
 *
 * There is nothing to configure any more — registration rides the connection
 * the app already has — so this is a status line and a sentence of context, not
 * a form. It stays on screen precisely because the successful case is silent:
 * without it, "the host has no plugin" and "everything is fine" look identical.
 */
function PushDelivery({ status }: { status: PushStatus }) {
  return (
    <View style={styles.group}>
      <Text variant="sectionHeader" style={styles.groupLabel}>
        Push delivery
      </Text>

      <Card style={styles.pushCard}>
        <StatusLine status={status} />
      </Card>
    </View>
  )
}

/** What the host currently knows, said plainly — including when it knows nothing. */
function StatusLine({ status }: { status: PushStatus }) {
  const theme = useTheme()

  const [label, color] = {
    idle: ['Connect an agent to register this device.', theme.color.gray500],
    // Not a fault and not fixable here: this agent kind has no host process to
    // hold a device registry.
    unsupported: ['This agent cannot deliver push. Notifications arrive only while the app is open.', theme.color.gray500],
    // The one case a person can act on, so it says what to do rather than that
    // something went wrong.
    not_installed: [
      'The host has no polyflow_agents_push plugin enabled. Install it there to get notifications while the app is closed.',
      theme.color.warning700
    ],
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
