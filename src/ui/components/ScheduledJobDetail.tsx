import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import type { AgentBackend, ScheduledJob, ScheduledJobRun } from '@/domain'
import {
  useScheduledJobDelete,
  useScheduledJobEnable,
  useScheduledJobRuns,
  useScheduledJobTrigger,
  useScheduledJobUpdate
} from '@/state/scheduled'

import { agoTime, untilTime } from '../format'
import { kanbanErrorText as hostErrorText } from '../kanban'
import { Markdown } from '../markdown/Markdown'
import { deliverLabel, outcomeLabel, outcomeTone } from '../scheduled'
import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Text } from './Text'

/**
 * The whole job, from either place it can be opened: its row on the
 * Scheduled screen, or a card in the transcript where the agent made it.
 *
 * `editable` switches on the write surface — run now, pause, edit, delete,
 * and the rename on the title. The Scheduled screen passes it; the transcript
 * opens the same sheet read-only, which is all a card in a message needs.
 * The runs list is shown either way: a run is a session, and opening one is
 * navigation, not a write.
 */
export function ScheduledJobDetail({
  job,
  onDismiss,
  scope,
  backend,
  editable = false,
  onEdit
}: {
  job: ScheduledJob | null
  onDismiss: () => void
  scope: string
  backend: AgentBackend | null
  editable?: boolean
  onEdit?: (job: ScheduledJob) => void
}) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = useScheduledJobUpdate(scope, backend)
  const enable = useScheduledJobEnable(scope, backend)
  const trigger = useScheduledJobTrigger(scope, backend)
  const remove = useScheduledJobDelete(scope, backend)
  // Only agent runs leave a session behind. A script job's output is what was
  // delivered, and asking for its runs would be a list of nothing.
  const runs = useScheduledJobRuns(scope, backend, job && job.kind === 'prompt' ? job.id : null)

  // The sheet can swap jobs while open; a stale error or a check from the
  // previous one must not hang off the new job.
  useEffect(() => {
    setCopied(false)
    setError(null)
  }, [job?.id])

  if (!job) return null

  const tone = outcomeTone(theme, job)
  const busy = update.isPending || enable.isPending || trigger.isPending || remove.isPending

  const copyId = async () => {
    await Clipboard.setStringAsync(job.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const rename = (name: string) => {
    setError(null)
    update.mutate({ id: job.id, update: { name } }, { onError: e => setError(hostErrorText(e)) })
  }

  const runNow = () => {
    setError(null)
    trigger.mutate(job.id, { onError: e => setError(hostErrorText(e)) })
  }

  const toggleEnabled = () => {
    setError(null)
    enable.mutate({ id: job.id, enabled: !job.enabled }, { onError: e => setError(hostErrorText(e)) })
  }

  // Worded as what it does: the job is removed from the host's schedule, and
  // its past runs stay where they are, as sessions.
  const confirmDelete = () => {
    Alert.alert(`Delete ${job.name}?`, 'It stops being scheduled. Runs it already made stay in Sessions.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setError(null)
          remove.mutate(job.id, { onSuccess: onDismiss, onError: e => setError(hostErrorText(e)) })
        }
      }
    ])
  }

  const openRun = (run: ScheduledJobRun) => {
    onDismiss()
    router.push(`/chat/${run.sessionId}`)
  }

  const facts: [string, string][] = [
    ['Next run', job.enabled ? (job.nextRunAt ? untilTime(job.nextRunAt) : '—') : 'paused'],
    ['Last run', job.lastRunAt ? agoTime(job.lastRunAt) : 'never'],
    ['Delivers', deliverLabel(job.deliver)],
    ...(job.model ? [['Model', job.model] as [string, string]] : []),
    ...(job.skills.length ? [['Skills', job.skills.join(', ')] as [string, string]] : []),
    ...(job.contextFrom.length ? [['Reads from', job.contextFrom.join(', ')] as [string, string]] : []),
    ...(job.failureStreak > 1 ? [['Failed in a row', String(job.failureStreak)] as [string, string]] : [])
  ]

  return (
    <Sheet visible title={job.name} onDismiss={onDismiss} expandable titleLines={2} onRename={editable ? rename : undefined}>
      <View style={styles.sheetBody}>
        {/* The subtitle: state, schedule, id — the facts about the job in one
            quiet line. The id copies on tap; it is the handle for this job in
            chat and in `hermes cron`. */}
        <View style={styles.subtitle}>
          <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <View style={[styles.dot, { backgroundColor: tone.text }]} />
            <Text variant="pill" color={tone.text}>
              {outcomeLabel(job)}
            </Text>
          </View>

          <Text variant="secondary" color={theme.color.gray400}>
            ·
          </Text>

          <Text variant="mono" color={theme.color.gray600} numberOfLines={1} style={styles.schedule}>
            {job.schedule}
          </Text>

          <Text variant="secondary" color={theme.color.gray400}>
            ·
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied job id' : `Copy job id ${job.id}`}
            onPress={() => void copyId()}
            hitSlop={8}
            style={styles.idButton}
          >
            <Text variant="mono" color={copied ? theme.color.primary : theme.color.gray500} numberOfLines={1}>
              {job.id}
            </Text>
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? theme.color.primary : theme.color.gray400} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {editable ? (
            <View style={styles.actions}>
              <ActionButton icon="play" label={trigger.isPending ? 'Running…' : 'Run now'} disabled={busy} onPress={runNow} />
              <ActionButton
                icon={job.enabled ? 'pause' : 'circle-play'}
                label={job.enabled ? 'Pause' : 'Resume'}
                disabled={busy}
                onPress={toggleEnabled}
              />
              {onEdit ? <ActionButton icon="pen" label="Edit" disabled={busy} onPress={() => onEdit(job)} /> : null}
            </View>
          ) : null}

          {trigger.isPending ? (
            <Text variant="secondary">The host runs the whole job before it answers; the list refreshes when it is done.</Text>
          ) : null}

          <View style={styles.factGrid}>
            {facts.map(([label, value]) => (
              <View key={label} style={[styles.fact, { borderColor: theme.color.border, backgroundColor: theme.color.bgSubtle }]}>
                <Text variant="sectionHeader">{label}</Text>
                <Text variant="secondary" numberOfLines={2}>
                  {value}
                </Text>
              </View>
            ))}
          </View>

          {job.lastError && job.outcome === 'failed' ? (
            <Notice tone="error" text={job.lastError} />
          ) : job.lastDeliveryError && job.outcome === 'delivery_failed' ? (
            <Notice tone="warning" text={`Ran, but could not deliver: ${job.lastDeliveryError}`} />
          ) : null}

          <View style={styles.section}>
            <Text variant="sectionHeader" style={styles.sectionLabel}>
              What it does
            </Text>
            {job.kind === 'script' ? (
              <Text variant="body">
                {job.script ? `Runs ${job.script} on the host, with no agent. ` : 'Runs a script on the host, with no agent. '}
                Whatever the script prints is what gets delivered.
              </Text>
            ) : job.prompt ? (
              // The prompt is what the agent is told, and it is written as
              // markdown more often than not — same renderer as the transcript.
              <Markdown source={job.prompt} />
            ) : (
              <Text variant="secondary">No prompt.</Text>
            )}
          </View>

          {job.kind === 'prompt' ? (
            <View style={styles.section}>
              <Text variant="sectionHeader" style={styles.sectionLabel}>
                Runs
              </Text>
              {runs.isPending ? (
                <Text variant="secondary">Loading runs…</Text>
              ) : runs.error ? (
                <Text variant="secondary" color={theme.color.error700}>
                  {hostErrorText(runs.error)}
                </Text>
              ) : (runs.data ?? []).length === 0 ? (
                <Text variant="secondary">No runs yet. Each run is a session, and opens like one.</Text>
              ) : (
                <View style={[styles.runs, { borderColor: theme.color.border }]}>
                  {(runs.data ?? []).map((run, index) => (
                    <RunRow key={run.sessionId} run={run} first={index === 0} onPress={() => openRun(run)} />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {editable ? (
            // Full width and last: you scroll past everything the job is
            // before you reach the button that removes it.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete job"
              disabled={busy}
              onPress={confirmDelete}
              style={({ pressed }) => [
                styles.delete,
                {
                  borderColor: theme.color.error200,
                  backgroundColor: theme.color.error50,
                  opacity: busy ? 0.5 : pressed ? 0.75 : 1
                }
              ]}
            >
              <Icon name="trash" size={13} color={theme.color.error700} />
              <Text variant="rowLabelStrong" color={theme.color.error700}>
                {remove.isPending ? 'Deleting…' : 'Delete job'}
              </Text>
            </Pressable>
          ) : null}

          {error ? <Notice tone="error" text={error} /> : null}
        </ScrollView>
      </View>
    </Sheet>
  )
}

function ActionButton({ icon, label, disabled, onPress }: { icon: string; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: theme.color.border,
          borderRadius: theme.radius.control,
          backgroundColor: pressed ? theme.color.bgSubtle : theme.color.surface,
          opacity: disabled ? 0.5 : 1
        }
      ]}
    >
      <Icon name={icon} size={12} color={theme.color.primary} />
      <Text variant="rowLabelStrong" color={theme.color.primary}>
        {label}
      </Text>
    </Pressable>
  )
}

function RunRow({ run, first, onPress }: { run: ScheduledJobRun; first: boolean; onPress: () => void }) {
  const theme = useTheme()
  const took = run.endedAt ? runDuration(run.endedAt - run.startedAt) : run.active ? 'running' : ''

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open run from ${agoTime(run.startedAt)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.run,
        { borderTopColor: theme.color.divider, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth },
        { backgroundColor: pressed ? theme.color.bgSubtle : 'transparent' }
      ]}
    >
      <View style={styles.runBody}>
        <Text variant="rowLabel" numberOfLines={1}>
          {agoTime(run.startedAt)}
          {took ? (
            <Text variant="monoSmall" color={theme.color.gray500}>
              {`  ${took}`}
            </Text>
          ) : null}
        </Text>
        {run.preview ? (
          <Text variant="secondary" numberOfLines={2}>
            {run.preview}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={11} color={theme.color.gray400} />
    </Pressable>
  )
}

/** How long a run took: `42s`, `3m`, `21h 2m`. A run is minutes, not milliseconds. */
function runDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function Notice({ tone, text }: { tone: 'error' | 'warning'; text: string }) {
  const theme = useTheme()
  const colors =
    tone === 'error'
      ? { bg: theme.color.error50, border: theme.color.error200, text: theme.color.error700 }
      : { bg: theme.color.warning50, border: theme.color.warning200, text: theme.color.warning700 }

  return (
    <View style={[styles.notice, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Icon name="triangle-exclamation" size={13} color={colors.text} />
      <Text variant="secondary" color={colors.text} style={styles.noticeText}>
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  sheetBody: { flex: 1, paddingHorizontal: 16, gap: 12 },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  schedule: { flexShrink: 1 },
  idButton: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  body: { gap: 14, paddingBottom: 24 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth
  },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: {
    minWidth: '30%',
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  section: { gap: 6 },
  sectionLabel: { marginBottom: 2 },
  runs: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  run: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  runBody: { flex: 1, minWidth: 0, gap: 2 },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  noticeText: { flex: 1, minWidth: 0 }
})
