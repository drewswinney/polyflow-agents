/**
 * The host's cron record is wider than the vendored `CronJob` and its status
 * is spread across four fields; these pin how that becomes one job the phone
 * can show, and that an edit round-trips the schedule in a form the host
 * parses back.
 */
import { describe, expect, it } from '@jest/globals'

import { type HermesCronJob, toCreatePayload, toScheduledJob, toScheduledJobRun, toUpdatePayload } from '@/backends/hermes/scheduled'

const greg: HermesCronJob = {
  id: '94310b4ebf56',
  name: 'mealplan-sunday-generate',
  enabled: true,
  prompt: 'You are generating the weekly meal plan.\n\nLoad the skill `weekly-meal-plan` and follow it.',
  schedule: { kind: 'cron', expr: '0 6 * * 0', display: '0 6 * * 0' },
  schedule_display: '0 6 * * 0',
  deliver: 'polyflow_agents_push',
  skills: ['weekly-meal-plan'],
  model: null,
  next_run_at: '2026-09-13T06:00:00-04:00',
  last_run_at: null,
  last_status: null,
  last_error: null,
  failure_streak: 0,
  context_from: ['a4bc5d151ad1'],
  no_agent: false
}

describe('toScheduledJob', () => {
  it('maps a prompt job that has not run yet', () => {
    const job = toScheduledJob(greg)

    expect(job).toMatchObject({
      id: '94310b4ebf56',
      name: 'mealplan-sunday-generate',
      kind: 'prompt',
      schedule: '0 6 * * 0',
      scheduleExpr: '0 6 * * 0',
      enabled: true,
      skills: ['weekly-meal-plan'],
      deliver: 'polyflow_agents_push',
      outcome: 'never',
      lastRunAt: null,
      contextFrom: ['a4bc5d151ad1']
    })
    expect(job.nextRunAt).toBe(Date.parse('2026-09-13T06:00:00-04:00'))
  })

  it('is a script job when the host says no agent, and falls back to the id for a name', () => {
    const job = toScheduledJob({ ...greg, id: 'x', name: '  ', no_agent: true, script: 'scrub.sh', prompt: '' })

    expect(job).toMatchObject({ kind: 'script', script: 'scrub.sh', name: 'x' })
  })

  it('reads the outcome off the execution ledger first, then the last status', () => {
    const ran = { ...greg, last_run_at: '2026-09-09T15:19:13-04:00' }

    expect(toScheduledJob({ ...ran, latest_execution: { status: 'running' } }).outcome).toBe('running')
    expect(toScheduledJob({ ...ran, last_status: 'ok' }).outcome).toBe('ok')
    expect(toScheduledJob({ ...ran, last_status: 'delivery_failed', last_delivery_error: 'no live adapter' }).outcome).toBe('delivery_failed')
    expect(toScheduledJob({ ...ran, last_status: 'error', last_error: 'Script not found' }).outcome).toBe('failed')
    expect(toScheduledJob({ ...ran, last_error: 'boom' }).outcome).toBe('failed')
    expect(toScheduledJob(ran).outcome).toBe('ok')
  })

  it('turns an interval or a one-shot back into the string the host parses', () => {
    expect(toScheduledJob({ ...greg, schedule: { kind: 'interval', minutes: 120, display: 'every 120m' } }).scheduleExpr).toBe('every 120m')
    expect(toScheduledJob({ ...greg, schedule: { kind: 'once', run_at: '2026-10-01T09:00:00', display: 'once' } }).scheduleExpr).toBe('2026-10-01T09:00:00')
  })

  it('accepts a single legacy skill and a string context_from', () => {
    const job = toScheduledJob({ ...greg, skills: null, skill: 'maps', context_from: 'a4bc5d151ad1' })

    expect(job.skills).toEqual(['maps'])
    expect(job.contextFrom).toEqual(['a4bc5d151ad1'])
  })
})

describe('toScheduledJobRun', () => {
  it('reads a run off the sessions-shaped row', () => {
    const run = toScheduledJobRun({
      id: 'cron_94310b4ebf56_20260913T060000',
      started_at: 1_789_000_000,
      ended_at: 1_789_000_090,
      last_active: 1_789_000_090,
      is_active: false,
      message_count: 5,
      preview: '  Plan for the week: …  ',
      title: 'meal plan',
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      source: 'cron',
      tool_call_count: 2
    })

    expect(run).toEqual({
      sessionId: 'cron_94310b4ebf56_20260913T060000',
      startedAt: 1_789_000_000_000,
      endedAt: 1_789_000_090_000,
      active: false,
      preview: 'Plan for the week: …',
      messageCount: 5
    })
  })
})

describe('toScheduledJobRun preview', () => {
  it("cuts the scheduler's preamble off a run that never answered", () => {
    const row = { id: 'r', started_at: 1, ended_at: 2, last_active: 2, is_active: false, message_count: 1, model: null, input_tokens: 0, output_tokens: 0, source: 'cron', title: null, tool_call_count: 0 }

    expect(toScheduledJobRun({ ...row, preview: '[IMPORTANT: You are running as a scheduled cron job. DELIVER the result.] Gather the digest.' }).preview).toBe('Gather the digest.')
    expect(toScheduledJobRun({ ...row, preview: '[IMPORTANT: You are running as a scheduled cron job. DELIVER…' }).preview).toBe('')
    expect(toScheduledJobRun({ ...row, preview: 'Plan for the week.' }).preview).toBe('Plan for the week.')
  })
})

describe('payloads', () => {
  it('sends only the fields an edit changed, in the host\'s names', () => {
    expect(toUpdatePayload({ schedule: 'every 2h', contextFrom: ['a4'] })).toEqual({ updates: { schedule: 'every 2h', context_from: ['a4'] } })
    expect(toUpdatePayload({ deliver: '' })).toEqual({ updates: { deliver: 'local' } })
  })

  it('defaults a new job to local delivery and omits empty skills', () => {
    expect(toCreatePayload({ name: 'n', schedule: '0 6 * * 0', prompt: 'p', deliver: '' })).toEqual({
      prompt: 'p',
      schedule: '0 6 * * 0',
      name: 'n',
      deliver: 'local'
    })
  })
})
