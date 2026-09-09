/**
 * The chat's job cards are read off the agent's own `cronjob` tool results,
 * not fetched — so a card survives the job's deletion, and a create followed
 * by an edit in the same breath is one card in its final state. These pin the
 * parsing, the de-duplication, and where the row lands in the transcript.
 */
import { describe, expect, it } from '@jest/globals'

import type { TranscriptEntry } from '@/domain'
import { actionLabel, describeJob, jobFromRef, parseCronjobResult, scheduledJobRefs } from '@/ui/scheduled'
import { groupTranscript, withScheduledJobRows } from '@/ui/transcript-rows'

const created = JSON.stringify({
  success: true,
  job: {
    job_id: 'a4bc5d151ad1',
    name: 'mealplan-sunday-generate',
    prompt_preview: 'You are generating the weekly meal plan. Load the skill...',
    schedule: '0 6 * * 0',
    deliver: 'polyflow_agents_push',
    enabled: true,
    state: 'scheduled'
  }
})

function tool(id: string, output: string | undefined, summary = '{"action": "create", "schedule": "0 6 * * 0"}', status: 'ok' | 'error' = 'ok'): TranscriptEntry {
  return { kind: 'tool', id, call: { id, name: 'cronjob', summary, status, output, startedAt: 1_000, durationMs: 500 } }
}

describe('parseCronjobResult', () => {
  it('reads the job off a create result', () => {
    expect(parseCronjobResult(created)).toEqual({
      jobId: 'a4bc5d151ad1',
      name: 'mealplan-sunday-generate',
      schedule: '0 6 * * 0',
      summary: 'You are generating the weekly meal plan. Load the skill...',
      deliver: 'polyflow_agents_push',
      enabled: true
    })
  })

  it('names a script job by its script when there is no prompt', () => {
    const output = JSON.stringify({ success: true, job: { job_id: 'x1', name: 'scrub', script: 'zfs-scrub.sh', schedule: 'every 1d' } })

    expect(parseCronjobResult(output)?.summary).toBe('Runs zfs-scrub.sh')
  })

  it('is null for a list, a removal, a failure, or non-JSON', () => {
    expect(parseCronjobResult(JSON.stringify({ success: true, count: 2, jobs: [] }))).toBeNull()
    expect(parseCronjobResult(JSON.stringify({ success: true, removed: 'x1' }))).toBeNull()
    expect(parseCronjobResult(JSON.stringify({ success: false, error: 'schedule is required' }))).toBeNull()
    expect(parseCronjobResult('Error: schedule is required')).toBeNull()
    expect(parseCronjobResult(undefined)).toBeNull()
  })
})

describe('scheduledJobRefs', () => {
  it('collapses a create and an update of the same job into one card in its final state', () => {
    const updated = JSON.stringify({ success: true, job: { job_id: 'a4bc5d151ad1', name: 'meal plan', schedule: '0 7 * * 0', deliver: 'local' } })
    const refs = scheduledJobRefs([
      tool('t1', created),
      tool('t2', updated, '{"action": "update", "job_id": "a4bc5d151ad1"}')
    ])

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ jobId: 'a4bc5d151ad1', name: 'meal plan', schedule: '0 7 * * 0', action: 'update', at: 1_500 })
  })

  it('ignores calls that failed and tools that are not cronjob', () => {
    const other: TranscriptEntry = { kind: 'tool', id: 'w', call: { id: 'w', name: 'write_file', summary: '', status: 'ok', output: created, startedAt: 1 } }

    expect(scheduledJobRefs([tool('t1', created, undefined, 'error'), other])).toEqual([])
  })

  it('reads the action off the argument summary, defaulting to update', () => {
    expect(scheduledJobRefs([tool('t1', created, '{"action": "pause", "job_id": "a4"}')])[0].action).toBe('pause')
    expect(scheduledJobRefs([tool('t1', created, 'cronjob a4')])[0].action).toBe('update')
  })
})

describe('withScheduledJobRows', () => {
  it('puts the card row straight after the work section that made the job', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'message', id: 'u1', role: 'user', text: 'schedule the meal plan', at: 900 },
      { kind: 'thinking', id: 'th1', text: 'I will create a job', at: 950 },
      tool('t1', created),
      { kind: 'message', id: 'a1', role: 'agent', text: 'Done — it runs Sundays at 6.', at: 2_000 }
    ]

    const rows = withScheduledJobRows(groupTranscript(entries))

    expect(rows.map(row => row.kind)).toEqual(['entry', 'work', 'scheduled', 'entry'])
    expect(rows[2]).toMatchObject({ id: 'scheduled:th1', at: 1_500 })
  })

  it('leaves a transcript without job calls alone', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'message', id: 'u1', role: 'user', text: 'hi', at: 1 },
      { kind: 'thinking', id: 'th1', text: 'hello', at: 2 }
    ]

    expect(withScheduledJobRows(groupTranscript(entries)).map(row => row.kind)).toEqual(['entry', 'work'])
  })
})

describe('card copy', () => {
  it('describes a prompt job by its first paragraph and a script job by its script', () => {
    expect(describeJob({ kind: 'prompt', prompt: 'Check the backups.\n\nThen report.', script: null })).toBe('Check the backups.')
    expect(describeJob({ kind: 'script', prompt: '', script: 'scrub.sh' })).toBe('Runs scrub.sh')
    expect(describeJob({ kind: 'prompt', prompt: '', script: null })).toBe('No prompt.')
  })

  it('cuts a long first paragraph on a word', () => {
    const prompt = 'word '.repeat(60).trim()
    const line = describeJob({ kind: 'prompt', prompt, script: null })

    expect(line.length).toBeLessThanOrEqual(140)
    expect(line.endsWith('word…')).toBe(true)
  })

  it('labels what the agent did', () => {
    expect(actionLabel('create')).toBe('Scheduled')
    expect(actionLabel('pause')).toBe('Paused')
    expect(actionLabel('whatever')).toBe('Scheduled job')
  })

  it('builds a stand-in job for a card whose job is gone', () => {
    const ref = scheduledJobRefs([tool('t1', created)])[0]

    expect(jobFromRef(ref)).toMatchObject({ id: 'a4bc5d151ad1', name: 'mealplan-sunday-generate', enabled: true, outcome: 'never', deliver: 'polyflow_agents_push' })
  })
})
