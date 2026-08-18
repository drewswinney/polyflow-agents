import { router } from 'expo-router'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useNotificationPrefs } from '@/state/notification-prefs'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { Toggle } from '@/ui/components/Toggle'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Notifications (§7.12) — device-local preferences.
 *
 * What this screen can honestly promise is bounded by what exists. Hermes has
 * no push support and there is no relay on the host (§10.2), so these govern
 * **local** notifications raised while the app is running. The card at the
 * bottom says so rather than letting the toggles imply delivery the app cannot
 * make. Lock-screen Allow/Deny actions need the relay too — they have to
 * round-trip `approval.respond`, which needs a real endpoint.
 */
export default function NotificationsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const prefs = useNotificationPrefs()

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

        <Card style={styles.noticeCard}>
          <View style={styles.noticeHead}>
            <Icon name="circle-info" size={14} color={theme.color.warning700} />
            <Text variant="rowLabelStrong">These arrive only while the app is running</Text>
          </View>
          <Text variant="secondary">
            Hermes has no push support, so there is nothing to deliver a notification once this app is closed. That
            needs a small relay on the agent host watching the event stream. Until it exists, these settings govern
            local notifications, and lock-screen Allow / Deny actions are not available.
          </Text>
        </Card>
      </ScrollView>
    </View>
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
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }
})
