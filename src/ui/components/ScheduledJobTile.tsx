import { Pressable, StyleSheet, View } from 'react-native'

import type { ScheduledJob } from '@/domain'

import { relativeTime, untilTime } from '../format'
import { deliverLabel, describeJob, outcomeLabel, outcomeTone } from '../scheduled'
import { useTheme } from '../ThemeProvider'
import { PREVIEW_HEIGHT } from './ArtifactCards'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One job in the Scheduled list.
 *
 * Reads top to bottom as the questions you have about a job: what state is
 * it in, what is it called, when does it fire, what does it do, where does
 * the output go. The row opens the sheet; nothing on it fires by accident
 * from a pocket — pausing and running live behind the tap.
 */
export function ScheduledJobTile({ job, onPress }: { job: ScheduledJob; onPress: () => void }) {
  const theme = useTheme()
  const tone = outcomeTone(theme, job)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${job.name}, ${outcomeLabel(job)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.color.bgSubtle : 'transparent' }]}
    >
      <View style={styles.head}>
        <Text variant="rowLabelStrong" numberOfLines={1} color={job.enabled ? theme.color.gray900 : theme.color.gray500} style={styles.name}>
          {job.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <View style={[styles.dot, { backgroundColor: tone.text }]} />
          <Text variant="pill" color={tone.text} numberOfLines={1}>
            {outcomeLabel(job)}
          </Text>
        </View>
      </View>

      <Text variant="monoSmall" numberOfLines={1} color={theme.color.gray600}>
        {scheduleLine(job)}
      </Text>

      <Text variant="secondary" numberOfLines={2} color={theme.color.gray800}>
        {describeJob(job)}
      </Text>

      {job.lastError && job.outcome === 'failed' ? (
        <Text variant="secondary" color={theme.color.error700} numberOfLines={2}>
          {job.lastError}
        </Text>
      ) : job.lastDeliveryError && job.outcome === 'delivery_failed' ? (
        <Text variant="secondary" color={theme.color.warning700} numberOfLines={2}>
          {job.lastDeliveryError}
        </Text>
      ) : null}

      <View style={styles.chipRow}>
        <Chip icon="paper-plane" label={deliverLabel(job.deliver)} />
        {job.skills.map(skill => (
          <Chip key={skill} icon="wand-magic-sparkles" label={skill} />
        ))}
        {job.contextFrom.length ? <Chip icon="arrow-right-to-bracket" label={`reads ${job.contextFrom.length}`} /> : null}
      </View>
    </Pressable>
  )
}

/** `every day at 06:00 · next in 3h`, or the last run when it will not fire again. */
export function scheduleLine(job: ScheduledJob): string {
  if (!job.enabled) return job.lastRunAt ? `${job.schedule} · last ran ${relativeTime(job.lastRunAt)} ago` : job.schedule
  if (job.outcome === 'running') return `${job.schedule} · running now`
  if (job.nextRunAt) return `${job.schedule} · next ${untilTime(job.nextRunAt)}`

  return job.schedule
}

function Chip({ icon, label }: { icon: string; label: string }) {
  const theme = useTheme()

  return (
    <View style={[styles.chip, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border }]}>
      <Icon name={icon} size={9} color={theme.color.gray500} />
      <Text variant="monoSmall" color={theme.color.gray600} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** A compact card's width: room for a name and two lines of prompt. */
const PREVIEW_WIDTH = 200

/**
 * A job at the size of an artifact tile, for the strip under a message.
 *
 * The same footprint as the kanban and artifact previews, so a turn that
 * scheduled a job and wrote a file shows two strips of the same kind of
 * thing. `caption` is what the agent did — Scheduled, Updated, Paused — and
 * sits where the kanban tile puts its status, because for a card in a
 * transcript that is the news.
 */
export function ScheduledJobPreview({
  job,
  caption,
  onPress
}: {
  job: ScheduledJob
  caption: string
  onPress: () => void
}) {
  const theme = useTheme()
  const tone = outcomeTone(theme, job)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${job.name}, ${caption}`}
      onPress={onPress}
      style={({ pressed }) => [styles.preview, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.previewBlock,
          theme.shadow.card,
          { borderRadius: theme.radius.control, borderColor: theme.color.border, backgroundColor: theme.color.surface }
        ]}
      >
        <View style={styles.captionRow}>
          <Icon name="clock" size={10} color={tone.text} />
          <Text variant="sectionHeader" color={tone.text} numberOfLines={1} style={styles.name}>
            {caption}
          </Text>
        </View>

        <Text variant="rowLabelStrong" numberOfLines={2}>
          {job.name}
        </Text>

        <Text variant="monoSmall" numberOfLines={1} color={theme.color.gray600}>
          {job.enabled ? job.schedule : `paused · ${job.schedule}`}
        </Text>

        <Text variant="secondary" numberOfLines={2} style={styles.previewBody}>
          {describeJob(job)}
        </Text>
      </View>

      <Text variant="rowLabel" numberOfLines={1} style={styles.previewName}>
        {deliverLabel(job.deliver)}
      </Text>

      <View style={styles.open}>
        <Text variant="pill" color={theme.color.secondaryDeep}>
          Open
        </Text>
        <Icon name="chevron-right" size={9} color={theme.color.secondaryDeep} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 13, paddingVertical: 12, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, minWidth: 0 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 150
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%'
  },
  preview: { width: PREVIEW_WIDTH, gap: 4, alignItems: 'flex-start' },
  previewBlock: {
    alignSelf: 'stretch',
    height: PREVIEW_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
    overflow: 'hidden'
  },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewBody: { flexShrink: 1 },
  previewName: { paddingTop: 2 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 3 }
})
