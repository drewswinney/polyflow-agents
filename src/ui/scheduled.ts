import type { ScheduledJob, TranscriptEntry } from '@/domain'

import type { StatusTone } from './kanban'
import type { Theme } from './theme'

/**
 * A job's tone comes from how its last run went, off the same info / warning /
 * success / error ramp a board card reads — a schedule is a state the job is
 * in, not the agent's identity. Paused outranks everything: a job that will
 * not fire is quiet whatever its history says.
 */
export function outcomeTone(theme: Theme, job: Pick<ScheduledJob, 'enabled' | 'outcome'>): StatusTone {
  if (!job.enabled) return { text: theme.color.gray600, bg: theme.color.bgSubtle, border: theme.color.border }

  switch (job.outcome) {
    case 'running':
      return { text: theme.color.info700, bg: theme.color.info50, border: theme.color.info200 }
    case 'ok':
      return { text: theme.color.success700, bg: theme.color.success50, border: theme.color.success200 }
    case 'delivery_failed':
      return { text: theme.color.warning700, bg: theme.color.warning50, border: theme.color.warning200 }
    case 'failed':
      return { text: theme.color.error700, bg: theme.color.error50, border: theme.color.error200 }
    default:
      return { text: theme.color.gray600, bg: theme.color.bgSubtle, border: theme.color.border }
  }
}

export function outcomeLabel(job: Pick<ScheduledJob, 'enabled' | 'outcome'>): string {
  if (!job.enabled) return 'Paused'

  switch (job.outcome) {
    case 'running':
      return 'Running'
    case 'ok':
      return 'Last run OK'
    case 'delivery_failed':
      return 'Delivery failed'
    case 'failed':
      return 'Last run failed'
    default:
      return 'Not yet run'
  }
}

/** How long a one-line description runs. Two lines on a phone, at most. */
const DESCRIBE_MAX = 140

/**
 * What the job does, in a line.
 *
 * The prompt's first paragraph, because that is where a prompt says what it
 * is for before it gets into how. A script job has no prompt; the script's
 * name is the whole of what can be said about it from here.
 */
export function describeJob(job: Pick<ScheduledJob, 'kind' | 'prompt' | 'script'>): string {
  if (job.kind === 'script') return job.script ? `Runs ${job.script}` : 'Runs a script'

  const paragraph = job.prompt
    .split(/\n\s*\n/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .find(Boolean)

  if (!paragraph) return 'No prompt.'
  if (paragraph.length <= DESCRIBE_MAX) return paragraph

  const cut = paragraph.slice(0, DESCRIBE_MAX - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > DESCRIBE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Where the output goes, as a short label for a chip. */
export function deliverLabel(deliver: string): string {
  if (deliver === 'local') return 'Saved on host'
  if (deliver === 'origin') return 'Replies where asked'
  if (deliver === 'polyflow_agents_push') return 'To this app'
  if (deliver === 'all') return 'Every channel'

  return `To ${deliver}`
}

/**
 * A job the agent touched from chat, as read off its `cronjob` tool call.
 *
 * The transcript holds the tool's result — `{"success": true, "job": {…}}`
 * — and nothing else about the job. That is enough to draw a card even after
 * the job is deleted, and to know which live row to open while it exists.
 */
export interface ScheduledJobRef {
  jobId: string
  /** What the agent did: `create`, `update`, `pause`, `resume`, `run`. */
  action: string
  name: string
  schedule: string
  /** The prompt's opening, as the host previews it. */
  summary: string
  deliver: string
  enabled: boolean
  /** When the call finished; the row's place in the transcript. */
  at: number
}

/** The tools whose settling means a job may have changed. */
export const SCHEDULED_JOB_TOOLS: ReadonlySet<string> = new Set(['cronjob'])

/**
 * The job a `cronjob` tool result names, or null when it names none.
 *
 * Tolerant on purpose: the result is a JSON string the tool wrote for the
 * model, not for us, and `list` answers with `jobs`, `remove` with no job at
 * all. Only a result carrying one `job` with an id is a card.
 */
export function parseCronjobResult(output: string | undefined): Omit<ScheduledJobRef, 'action' | 'at'> | null {
  if (!output) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  const result = parsed as { success?: unknown; job?: unknown }

  if (result.success === false || !result.job || typeof result.job !== 'object') return null

  const job = result.job as Record<string, unknown>
  const jobId = text(job.job_id) || text(job.id)

  if (!jobId) return null

  return {
    jobId,
    name: text(job.name) || jobId,
    schedule: text(job.schedule) || text(job.schedule_display) || '',
    summary: text(job.prompt_preview) || text(job.prompt) || (text(job.script) ? `Runs ${text(job.script)}` : ''),
    deliver: text(job.deliver) || 'local',
    enabled: job.enabled !== false
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The action off the call's argument summary — `{"action": "create", …}` is its first key. */
function actionOf(summary: string): string {
  return /"action"\s*:\s*"(\w+)"/.exec(summary)?.[1] ?? 'update'
}

/**
 * The jobs a stretch of working-out touched, one per job.
 *
 * A job the agent created and then edited in the same breath is one card
 * showing its final state, not two; the last call wins and keeps the first
 * call's place so the card does not jump.
 */
export function scheduledJobRefs(entries: readonly TranscriptEntry[]): ScheduledJobRef[] {
  const refs = new Map<string, ScheduledJobRef>()

  for (const entry of entries) {
    if (entry.kind !== 'tool' || !SCHEDULED_JOB_TOOLS.has(entry.call.name) || entry.call.status !== 'ok') continue

    const parsed = parseCronjobResult(entry.call.output)

    if (!parsed) continue

    const previous = refs.get(parsed.jobId)
    const at = entry.call.startedAt + (entry.call.durationMs ?? 0)

    refs.set(parsed.jobId, { ...parsed, action: actionOf(entry.call.summary), at: previous?.at ?? at })
  }

  return [...refs.values()]
}

/** What the card's caption says the agent did. */
export function actionLabel(action: string): string {
  switch (action) {
    case 'create':
      return 'Scheduled'
    case 'pause':
      return 'Paused'
    case 'resume':
      return 'Resumed'
    case 'run':
      return 'Ran now'
    case 'update':
    case 'edit':
      return 'Updated'
    default:
      return 'Scheduled job'
  }
}

/**
 * A job as the card knew it, for when the live list no longer has it.
 *
 * A job deleted after the agent made it still has a card in the transcript;
 * this is what that card shows. Everything the ref did not carry is the
 * quiet default — no runs, no error, no model.
 */
export function jobFromRef(ref: ScheduledJobRef): ScheduledJob {
  return {
    id: ref.jobId,
    name: ref.name,
    kind: ref.summary.startsWith('Runs ') && !ref.summary.includes(' ', 5) ? 'script' : 'prompt',
    schedule: ref.schedule || 'unscheduled',
    scheduleExpr: ref.schedule,
    enabled: ref.enabled,
    prompt: ref.summary,
    script: null,
    skills: [],
    deliver: ref.deliver,
    model: null,
    nextRunAt: null,
    lastRunAt: null,
    outcome: 'never',
    lastError: null,
    lastDeliveryError: null,
    failureStreak: 0,
    contextFrom: []
  }
}
