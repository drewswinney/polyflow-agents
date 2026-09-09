import type { CronDeliveryTarget, CronJob, SessionInfo } from '@hermes/types'

import type {
  DeliveryTarget,
  ScheduledJob,
  ScheduledJobDraft,
  ScheduledJobOutcome,
  ScheduledJobRun,
  ScheduledJobUpdate
} from '@/domain'

import { toMillis } from './normalize'

/**
 * The job record as the host actually stores it.
 *
 * Wider than the vendored `CronJob`, which is the desktop's read of the same
 * row: the phone shows what a job does and how its last run went, and those
 * fields — skills, the failure streak, the delivery error, what it chains
 * from — are all on disk in `cron/jobs.json` and come back from every job
 * route unchanged. Declared here rather than in `vendor/` so the vendored
 * types stay the upstream copy.
 */
export interface HermesCronJob extends CronJob {
  skill?: string | null
  skills?: string[] | null
  failure_streak?: number | null
  last_status?: string | null
  last_delivery_error?: string | null
  context_from?: string | string[] | null
  /** Stamped by `list_jobs` from the execution ledger; the live signal for "running". */
  latest_execution?: { status?: string | null } | null
  schedule?: CronJob['schedule'] & { minutes?: number; run_at?: string }
}

/** A run row: a session, plus the flag the runs route adds. */
export type HermesCronRun = SessionInfo & { is_active?: boolean }

/** What `POST /api/cron/jobs` takes. Wider than the vendored payload by `skills`. */
export interface HermesCronCreate {
  prompt: string
  schedule: string
  name: string
  deliver: string
  skills?: string[]
}

/** What `PUT /api/cron/jobs/{id}` takes: only the keys present change. */
export interface HermesCronUpdate {
  updates: {
    name?: string
    schedule?: string
    prompt?: string
    deliver?: string
    skills?: string[]
    context_from?: string[]
  }
}

export function toScheduledJob(job: HermesCronJob): ScheduledJob {
  const id = String(job.id)
  const scheduleExpr = scheduleExprOf(job)
  const skills = (job.skills ?? []).filter(Boolean)

  if (skills.length === 0 && job.skill) skills.push(job.skill)

  return {
    id,
    name: (job.name ?? '').trim() || id,
    kind: job.no_agent === true ? 'script' : 'prompt',
    schedule: job.schedule_display ?? job.schedule?.display ?? scheduleExpr ?? 'unscheduled',
    scheduleExpr: scheduleExpr ?? '',
    enabled: job.enabled !== false,
    prompt: job.prompt ?? '',
    script: job.script ?? null,
    skills,
    deliver: (job.deliver ?? '').trim() || 'local',
    model: job.model ?? null,
    nextRunAt: parseTimestamp(job.next_run_at),
    lastRunAt: parseTimestamp(job.last_run_at),
    outcome: outcomeOf(job),
    lastError: job.last_error ?? null,
    lastDeliveryError: job.last_delivery_error ?? null,
    failureStreak: typeof job.failure_streak === 'number' ? job.failure_streak : 0,
    contextFrom: listOf(job.context_from)
  }
}

/**
 * The schedule in the form the host parses back, for the edit form.
 *
 * The host stores a parsed schedule — `{kind, expr}` for a cron expression,
 * `{kind, minutes}` for an interval, `{kind, run_at}` for a one-shot — and
 * accepts a string on write. Each kind has one string that round-trips.
 */
function scheduleExprOf(job: HermesCronJob): string | null {
  const schedule = job.schedule

  if (!schedule) return null
  if (schedule.kind === 'interval' && typeof schedule.minutes === 'number') return `every ${schedule.minutes}m`
  if (schedule.kind === 'once' && schedule.run_at) return schedule.run_at

  return schedule.expr ?? schedule.display ?? null
}

/**
 * How the last run went.
 *
 * `last_status` is what the host writes after a run — `ok`, `error`, or
 * `delivery_failed` when the agent finished and only the hand-off failed.
 * The execution ledger says whether one is going right now, which outranks
 * all of that: a job mid-run is not "ok" or "failed" yet.
 */
function outcomeOf(job: HermesCronJob): ScheduledJobOutcome {
  const executing = (job.latest_execution?.status ?? '').toLowerCase()

  if (executing === 'claimed' || executing === 'running') return 'running'

  const status = (job.last_status ?? '').toLowerCase()

  if (status === 'delivery_failed') return 'delivery_failed'
  if (status === 'error' || status === 'failed' || (job.last_error && status !== 'ok')) return 'failed'
  if (!job.last_run_at) return 'never'

  return 'ok'
}

function listOf(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value) return [value]

  return []
}

/** Cron timestamps come back as ISO strings, not epochs. */
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A run, from the session it wrote.
 *
 * The runs route answers in the sessions list's row shape on purpose (the
 * desktop reuses its session row for it), so the timestamps are the same
 * epoch seconds every other session carries.
 */
export function toScheduledJobRun(row: HermesCronRun): ScheduledJobRun {
  return {
    sessionId: row.id,
    startedAt: toMillis(row.started_at),
    endedAt: row.ended_at == null ? null : toMillis(row.ended_at),
    active: row.is_active === true,
    preview: runPreview(row.preview),
    messageCount: typeof row.message_count === 'number' ? row.message_count : 0
  }
}

/**
 * The run's preview without the scheduler's preamble.
 *
 * A cron run's prompt opens with a bracketed `[IMPORTANT: You are running as
 * a scheduled cron job. …]` block the scheduler injects, and for a run that
 * failed before answering that block *is* the session's last message. It
 * says nothing about this run, so it is cut; a preview the host truncated
 * inside the block is left empty rather than shown as a dangling bracket.
 */
function runPreview(preview: string | null | undefined): string {
  const text = (preview ?? '').trim()

  if (!text.startsWith('[IMPORTANT')) return text

  const close = text.indexOf(']')

  return close === -1 ? '' : text.slice(close + 1).trim()
}

export function toDeliveryTarget(target: CronDeliveryTarget): DeliveryTarget {
  return {
    id: target.id,
    name: target.name || target.id,
    ready: target.home_target_set !== false,
    hint: target.home_env_var ?? null
  }
}

export function toCreatePayload(draft: ScheduledJobDraft): HermesCronCreate {
  return {
    prompt: draft.prompt,
    schedule: draft.schedule,
    name: draft.name,
    deliver: draft.deliver || 'local',
    ...(draft.skills && draft.skills.length ? { skills: draft.skills } : {})
  }
}

export function toUpdatePayload(update: ScheduledJobUpdate): HermesCronUpdate {
  const updates: HermesCronUpdate['updates'] = {}

  if (update.name !== undefined) updates.name = update.name
  if (update.schedule !== undefined) updates.schedule = update.schedule
  if (update.prompt !== undefined) updates.prompt = update.prompt
  if (update.deliver !== undefined) updates.deliver = update.deliver || 'local'
  if (update.skills !== undefined) updates.skills = update.skills
  if (update.contextFrom !== undefined) updates.context_from = update.contextFrom

  return { updates }
}
