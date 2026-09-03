import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { CronJobSummary } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { Card, Divider } from '@/ui/components/Card'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { Toggle } from '@/ui/components/Toggle'
import { relativeTime, untilTime } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Cron jobs (§7.4's Agent group).
 *
 * Enabled/disabled is a genuine on/off preference, so it is a toggle. Running a
 * job now is an action with a consequence on the host, so it is a labelled
 * button rather than a swipe or a long-press — nothing here should fire by
 * accident from a pocket.
 */
export default function CronScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const queryClient = useQueryClient()

  const jobsKey = ['agent', agent.id, 'cron'] as const

  const jobs = useQuery({
    queryKey: jobsKey,
    enabled: Boolean(backend) && (backend?.capabilities.extras.cron ?? false),
    queryFn: () => backend!.listCronJobs()
  })

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => backend!.setCronJobEnabled(id, enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: jobsKey })
  })

  const trigger = useMutation({
    mutationFn: (id: string) => backend!.triggerCronJob(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: jobsKey })
  })

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Cron jobs" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {jobs.isLoading ? (
          <Text variant="secondary">Loading jobs…</Text>
        ) : jobs.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((jobs.error as Error).message)}
          </Text>
        ) : (jobs.data ?? []).length === 0 ? (
          <Card style={styles.card}>
            <Text variant="secondary">No cron jobs on this agent.</Text>
          </Card>
        ) : (
          <Card>
            {(jobs.data ?? []).map((job, index) => (
              <View key={job.id}>
                {index > 0 ? <Divider /> : null}
                <CronRow
                  job={job}
                  busy={setEnabled.isPending || trigger.isPending}
                  onToggle={enabled => setEnabled.mutate({ id: job.id, enabled })}
                  onRun={() => trigger.mutate(job.id)}
                />
              </View>
            ))}
          </Card>
        )}

        {trigger.isPending ? (
          <Text variant="secondary">Running — the result arrives on the event stream.</Text>
        ) : null}
      </ScrollView>

    </View>
  )
}

function CronRow({
  job,
  busy,
  onToggle,
  onRun
}: {
  job: CronJobSummary
  busy: boolean
  onToggle: (enabled: boolean) => void
  onRun: () => void
}) {
  const theme = useTheme()

  const schedule = job.enabled
    ? job.nextRunAt
      ? `${job.schedule} · next ${untilTime(job.nextRunAt)}`
      : job.schedule
    : 'paused'

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={styles.rowBody}>
          <Text variant="rowLabelStrong" numberOfLines={1} color={job.enabled ? theme.color.gray900 : theme.color.gray400}>
            {job.name}
          </Text>
          <Text variant="monoSmall" numberOfLines={1}>
            {schedule}
          </Text>
        </View>

        <Toggle label={`${job.name} enabled`} value={job.enabled} disabled={busy} onChange={onToggle} />
      </View>

      {job.lastError ? (
        <Text variant="secondary" color={theme.color.error700} numberOfLines={2}>
          {`last run failed — ${job.lastError}`}
        </Text>
      ) : job.lastRunAt ? (
        <Text variant="secondary">{`last ran ${relativeTime(job.lastRunAt)} ago`}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onRun}
        style={[styles.runButton, { borderColor: theme.color.border, borderRadius: theme.radius.control }]}
      >
        <Text variant="rowLabelStrong" color={theme.color.primary}>
          Run now
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  card: { padding: 14 },
  row: { paddingHorizontal: 13, paddingVertical: 12, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  runButton: { height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth }
})
