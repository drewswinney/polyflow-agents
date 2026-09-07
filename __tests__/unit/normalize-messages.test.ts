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
