/**
 * What is allowed to survive a cold start.
 *
 * The persisted cache exists to put a conversation on screen while the fetch
 * that will replace it runs — never to answer for it. Every case here is one
 * way that distinction could quietly be lost: a stale error painted over a
 * healthy host, a store that grows without bound, a shape from an older app.
 */

import { describe, it, expect } from '@jest/globals'
import type { DehydratedState, Query } from '@tanstack/react-query'

import {
  CACHE_MAX_AGE_MS,
  isUsableCache,
  type PersistedCache,
  shouldPersistQuery,
  trimForPersistence
} from '@/state/query-cache-policy'

function query(queryKey: unknown[], status = 'success', data: unknown = {}): Pick<Query, 'queryKey' | 'state'> {
  return { queryKey, state: { status, data } } as unknown as Pick<Query, 'queryKey' | 'state'>
}

function dehydrated(keys: { key: unknown[]; at: number }[]): DehydratedState {
  return {
    mutations: [],
    queries: keys.map(({ key, at }) => ({
      queryKey: key,
      queryHash: JSON.stringify(key),
      state: { dataUpdatedAt: at }
    }))
  } as unknown as DehydratedState
}

describe('shouldPersistQuery', () => {
  it('keeps the session list and visited transcripts', () => {
    // The two reads that decide whether a cold start opens onto something.
    expect(shouldPersistQuery(query(['agent', 'greg', 'sessions']))).toBe(true)
    expect(shouldPersistQuery(query(['agent', 'greg', 'transcript', 'abc']))).toBe(true)
  })

  it('drops search results', () => {
    // Keyed by query string, so persisting them accumulates one entry per
    // thing ever typed, and none of them is what anyone sees on launch.
    expect(shouldPersistQuery(query(['agent', 'greg', 'search', 'deploy']))).toBe(false)
  })

  it('drops a failed query', () => {
    // A persisted failure would paint a stale error over a host that is fine.
    expect(shouldPersistQuery(query(['agent', 'greg', 'sessions'], 'error'))).toBe(false)
  })

  it('drops a query that has not answered yet', () => {
    expect(shouldPersistQuery(query(['agent', 'greg', 'sessions'], 'pending', undefined))).toBe(false)
  })

  it('drops a success that somehow carries no data', () => {
    // Built inline rather than through the helper: a default parameter would
    // swallow the explicit `undefined` this case is entirely about.
    const empty = {
      queryKey: ['agent', 'greg', 'sessions'],
      state: { status: 'success', data: undefined }
    } as unknown as Pick<Query, 'queryKey' | 'state'>

    expect(shouldPersistQuery(empty)).toBe(false)
  })

  it('ignores keys that are not agent-scoped', () => {
    expect(shouldPersistQuery(query(['something', 'else']))).toBe(false)
  })
})

describe('trimForPersistence', () => {
  it('leaves a store that is already within the cap alone', () => {
    const state = dehydrated([
      { key: ['agent', 'g', 'transcript', 'a'], at: 1 },
      { key: ['agent', 'g', 'sessions'], at: 2 }
    ])

    expect(trimForPersistence(state, 5)).toBe(state)
  })

  it('keeps the most recently updated transcripts', () => {
    // A long conversation is a lot of text and the file is written whole, so
    // the transcripts are the one unbounded thing in here.
    const state = dehydrated([
      { key: ['agent', 'g', 'transcript', 'old'], at: 100 },
      { key: ['agent', 'g', 'transcript', 'newer'], at: 300 },
      { key: ['agent', 'g', 'transcript', 'newest'], at: 500 }
    ])

    const kept = trimForPersistence(state, 2).queries.map(q => q.queryKey[3])

    expect(kept).toEqual(['newer', 'newest'])
  })

  it('never trims the session list', () => {
    // One per agent, small, and the thing the app actually opens onto.
    const state = dehydrated([
      { key: ['agent', 'g', 'sessions'], at: 1 },
      { key: ['agent', 'h', 'sessions'], at: 2 },
      { key: ['agent', 'g', 'transcript', 'a'], at: 3 },
      { key: ['agent', 'g', 'transcript', 'b'], at: 4 }
    ])

    const kept = trimForPersistence(state, 1).queries.map(q => q.queryKey[2])

    expect(kept.filter(k => k === 'sessions')).toHaveLength(2)
    expect(kept.filter(k => k === 'transcript')).toHaveLength(1)
  })
})

describe('isUsableCache', () => {
  const fresh: PersistedCache = { buster: 'v1:1.2.3', savedAt: 1_000, state: dehydrated([]) }

  it('accepts a matching, recent store', () => {
    expect(isUsableCache(fresh, 'v1:1.2.3', 1_000 + CACHE_MAX_AGE_MS - 1)).toBe(true)
  })

  it('rejects a store written by another version of the app', () => {
    // The likeliest reason a stored transcript no longer matches the shape the
    // app expects is that the app was updated.
    expect(isUsableCache(fresh, 'v1:1.3.0', 1_000)).toBe(false)
  })

  it('rejects a store past the age window', () => {
    expect(isUsableCache(fresh, 'v1:1.2.3', 1_000 + CACHE_MAX_AGE_MS + 1)).toBe(false)
  })

  it('rejects nothing at all', () => {
    expect(isUsableCache(null, 'v1:1.2.3', 1_000)).toBe(false)
  })

  it('rejects a file that parsed but is not one of ours', () => {
    const junk = { buster: 'v1:1.2.3' } as PersistedCache

    expect(isUsableCache(junk, 'v1:1.2.3', 1_000)).toBe(false)
  })
})
