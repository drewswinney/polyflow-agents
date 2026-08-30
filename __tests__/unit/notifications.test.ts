/**
 * What a banner says, and how often it is allowed to say it.
 *
 * Both halves were reported as one complaint: notifications arriving at odd
 * times, repeating, and — when they did arrive — telling you nothing beyond the
 * fact that something happened.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

import type { Agent, EventRecord } from '@/domain'
import {
  clearAnnouncements,
  markAnnounced,
  notificationKey,
  wasAnnounced
} from '@/state/notification-ledger'
import {
  describeNotification,
  followTurn,
  previewOf,
  type TurnDigest
} from '@/state/notification-copy'

const agent = { id: 'a1', displayName: 'Hermes' } as Agent

function event(name: string, payload: unknown, sessionId = 's1'): EventRecord {
  return { id: `${name}:1`, at: 1_000, name, detail: '', status: 'info', sessionId, payload }
}

beforeEach(() => {
  clearAnnouncements()
})

describe('what the banner says', () => {
  it('quotes the command an approval is about', () => {
    const described = describeNotification(
      event('approval.request', { request_id: 'r1', command: 'rm -rf ./build', description: 'delete a directory' }),
      agent
    )

    // The command is the thing worth reading on a lock screen — it is what
    // would run if you say yes. This used to read "A command is waiting on
    // your answer."
    expect(described?.body).toBe('rm -rf ./build')
    expect(described?.title).toBe('Hermes needs approval')
  })

  it('falls back to the description when there is no command', () => {
    const described = describeNotification(
      event('approval.request', { request_id: 'r1', description: 'write outside the workspace' }),
      agent
    )

    expect(described?.body).toBe('write outside the workspace')
  })

  it('asks the agent’s actual question', () => {
    const described = describeNotification(
      event('clarify.request', { request_id: 'r2', question: 'Deploy to staging or production?' }),
      agent
    )

    expect(described?.body).toBe('Deploy to staging or production?')
  })

  it('quotes what the agent said when a turn finishes', () => {
    const digests = new Map<string, TurnDigest>()

    for (const record of [
      event('message.start', {}),
      event('message.delta', { text: 'Migrated the ' }),
      event('message.delta', { text: 'schema and reran the tests.' })
    ]) {
      followTurn(digests, record)
    }

    const described = describeNotification(event('message.complete', {}), agent, digests)

    expect(described?.body).toBe('Migrated the schema and reran the tests.')
  })

  it('reports an ordinary turn end, not only a background one', () => {
    // `message.complete` is how a turn started before you looked away actually
    // ends. Nothing used to notice it.
    expect(describeNotification(event('message.complete', {}), agent)?.kind).toBe('complete')
    expect(describeNotification(event('background.complete', {}), agent)?.kind).toBe('complete')
  })
})

describe('following the turn for a preview', () => {
  it('restates on interim rather than appending it', () => {
    const digests = new Map<string, TurnDigest>()

    followTurn(digests, event('message.delta', { text: 'Hello' }))
    followTurn(digests, event('message.interim', { text: 'Hello there' }))

    expect(digests.get('s1')?.text).toBe('Hello there')
  })

  it('drops the previous turn’s text when a new one starts', () => {
    const digests = new Map<string, TurnDigest>()

    followTurn(digests, event('message.delta', { text: 'old news' }))
    followTurn(digests, event('message.start', {}))
    followTurn(digests, event('message.delta', { text: 'new' }))

    expect(digests.get('s1')?.text).toBe('new')
  })

  it('keeps sessions apart', () => {
    const digests = new Map<string, TurnDigest>()

    followTurn(digests, event('message.delta', { text: 'one' }, 's1'))
    followTurn(digests, event('message.delta', { text: 'two' }, 's2'))

    expect(digests.get('s1')?.text).toBe('one')
    expect(digests.get('s2')?.text).toBe('two')
  })

  it('says nothing again about a turn already announced', () => {
    const digests = new Map<string, TurnDigest>([['s1', { text: 'done', announced: true }]])

    expect(describeNotification(event('background.complete', {}), agent, digests)).toBeNull()
  })

  it('speaks again once new work starts on the session', () => {
    const digests = new Map<string, TurnDigest>([['s1', { text: 'done', announced: true }]])

    followTurn(digests, event('tool.start', { tool_id: 't1', name: 'shell' }))

    expect(describeNotification(event('message.complete', {}), agent, digests)?.kind).toBe('complete')
  })
})

describe('previewOf', () => {
  it('flattens a fenced block into a marker', () => {
    expect(previewOf('Try this:\n```sh\nnpm run build\n```\nthen deploy.')).toBe('Try this: [code] then deploy.')
  })

  it('strips heading marks and collapses whitespace', () => {
    expect(previewOf('## Done\n\n   Everything   passes.\n')).toBe('Done Everything passes.')
  })

  it('cuts long text at a word boundary', () => {
    const preview = previewOf('word '.repeat(100))

    expect(preview.length).toBeLessThanOrEqual(181)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).not.toMatch(/wor…$/)
  })

  it('leaves short text exactly as it reads', () => {
    expect(previewOf('All three services are healthy.')).toBe('All three services are healthy.')
  })
})

describe('the ledger', () => {
  it('keys a pending approval by its request id', () => {
    // The reason a still-unanswered approval no longer rings on every
    // reconnect: the host re-raises the same request, and the key is the same.
    const key = notificationKey('approval', 'req-7')

    expect(wasAnnounced(key)).toBe(false)
    markAnnounced(key)
    expect(wasAnnounced(key)).toBe(true)
  })

  it('keeps kinds apart on the same id', () => {
    markAnnounced(notificationKey('approval', 'x'))

    expect(wasAnnounced(notificationKey('complete', 'x'))).toBe(false)
  })

  it('forgets a key once its window has passed', () => {
    const key = notificationKey('complete', 's1')

    markAnnounced(key)

    expect(wasAnnounced(key, -1)).toBe(false)
  })

  it('treats an unkeyable event as never announced', () => {
    // A completion with no session cannot be identified, so it is never
    // suppressed — a missed approval costs more than a repeat.
    expect(notificationKey('complete', undefined)).toBeNull()
    expect(wasAnnounced(null)).toBe(false)
  })
})
