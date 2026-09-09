/**
 * What counts as conversation, and what is plumbing wearing a user's role.
 *
 * Hermes persists a live model switch as a marker with `role: 'user'` — on
 * purpose, because strict OpenAI-compatible providers reject a system message
 * that is not first in the list — and tags it `display_kind: 'model_switch'`
 * so a reader can tell it apart. Taken at face value it renders in your own
 * bubble as "[System: the active model for this chat has changed to …]".
 */

import { describe, it, expect } from '@jest/globals'

import type { SessionMessage } from '@hermes/types'
import { toTranscriptEntries } from '@/backends/hermes/normalize'

const message = (over: Partial<SessionMessage>): SessionMessage =>
  ({ role: 'user', content: 'hello', created_at: 1, ...over }) as unknown as SessionMessage

const kinds = (messages: SessionMessage[]) => toTranscriptEntries(messages).map(entry => entry.kind)

describe('transcript normalization drops what is not conversation', () => {
  it('keeps an ordinary user message', () => {
    expect(kinds([message({})])).toEqual(['message'])
  })

  it('drops a model-switch marker despite its user role', () => {
    expect(
      kinds([
        message({
          content: '[System: The active model for this chat has changed to x via provider y.]',
          display_kind: 'model_switch'
        })
      ])
    ).toEqual([])
  })

  it('still drops the kinds it always dropped', () => {
    expect(kinds([message({ role: 'system', content: 'internal' })])).toEqual([])
    expect(kinds([message({ display_kind: 'hidden' })])).toEqual([])
  })

  it('leaves the real messages around a marker intact', () => {
    const entries = kinds([
      message({ content: 'before' }),
      message({ content: '[System: …]', display_kind: 'model_switch' }),
      message({ role: 'assistant', content: 'after' })
    ])

    expect(entries).toEqual(['message', 'message'])
  })
})

/**
 * What the host injects under the user's role is kept, as a system entry:
 * it explains what the agent knew, and a bubble would say the person said it.
 */
describe('transcript normalization marks the host\'s own injections', () => {
  const systemOf = (over: Partial<SessionMessage>) => {
    const [entry] = toTranscriptEntries([message(over)])

    return entry?.kind === 'system' ? entry : null
  }

  it('turns a compaction summary into a system entry, whichever role carries it', () => {
    const summary = '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below.\n\n- fixed the socket'

    expect(systemOf({ content: summary })).toMatchObject({ note: 'compaction', label: 'Earlier turns were compacted', text: summary })
    expect(systemOf({ role: 'assistant', content: summary })?.note).toBe('compaction')
    expect(systemOf({ content: '[CONTEXT SUMMARY]: tool calls happened' })?.note).toBe('compaction')
  })

  it('reads a scheduled job prompt, with the job\'s own words as the detail', () => {
    const entry = systemOf({
      content:
        '[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be delivered. SILENT: say "[SILENT]".]\n\nCheck the backups finished and tell me what changed.\n\nThen stop.'
    })

    expect(entry).toMatchObject({ note: 'cron', label: 'Scheduled job prompt', detail: 'Check the backups finished and tell me what changed.' })
  })

  it('reads a cron job that arrived wrapped in its skill as one scheduled-job note', () => {
    const entry = systemOf({
      content:
        '[IMPORTANT: The user has invoked the "weekly-meal-plan" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]\n\n---\nname: weekly-meal-plan\n---\n\n# Weekly meal plan\n\nThe user has provided the following instruction alongside the skill invocation: [IMPORTANT: You are running as a scheduled cron job. DELIVERY: automatic.]\n\nAsk Drew what he wants in next week\'s meal plan.\n\nWhen Drew answers, capture it.'
    })

    expect(entry).toMatchObject({ note: 'cron', label: 'Scheduled job prompt · weekly-meal-plan', detail: "Ask Drew what he wants in next week's meal plan." })
  })

  it('names a skill invocation and a background-process note', () => {
    expect(systemOf({ content: '[IMPORTANT: The user has invoked the "maps" skill, indicating…]\n\n# Maps' })).toMatchObject({ note: 'skill', label: 'Skill loaded · maps' })
    expect(systemOf({ content: '[IMPORTANT: Background process proc_12 completed normally\nCommand: make test]' })).toMatchObject({
      note: 'background',
      label: 'A background process reported',
      detail: 'Background process proc_12 completed normally'
    })
  })

  it('uses the display kinds the host does stamp', () => {
    expect(systemOf({ content: 'Delegated work is done.', display_kind: 'async_delegation_complete' })?.note).toBe('delegation')
    expect(systemOf({ content: 'continue', display_kind: 'auto_continue' })?.note).toBe('continue')
    expect(systemOf({ content: '[System: personality is now x]', display_kind: 'personality_switch' })?.note).toBe('system')
  })

  it('leaves a person\'s own bracketed message alone, and an assistant reply that opens with a bracket', () => {
    expect(systemOf({ content: '[urgent] the deploy is broken' })).toBeNull()
    expect(systemOf({ role: 'assistant', content: '[SYSTEM] is not something I would say' })).toBeNull()
    expect(kinds([message({ content: '[urgent] the deploy is broken' })])).toEqual(['message'])
  })
})
