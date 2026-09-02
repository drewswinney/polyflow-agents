/**
 * What survives a cold start, and what a restored cache is allowed to mean.
 *
 * Its own module, and pure, for the reason `turn-settled` and `held-events`
 * are: this is a policy — what to keep, how much, how long it stays worth
 * painting — and a policy is worth testing without a filesystem behind it.
 * `query-cache-persistence` reaches `expo-file-system` and cannot be imported
 * in a test at all.
 *
 * The invariant everything here depends on lives in `queries.ts`: the
 * transcript query is `staleTime: 0` with `refetchOnMount: 'always'`, so a
 * cached transcript paints *during* the fetch and never in place of it. That
 * is what makes persisting one safe. A restored transcript is a picture of
 * what you were last shown, not an answer — and if any of this ever starts
 * satisfying a read instead of merely painting under one, it stops being safe
 * and starts being a chat silently missing the turn that happened while the
 * app was closed.
 */

import type { DehydratedState, Query } from '@tanstack/react-query'

/**
 * Bumped by hand when the shape of anything persisted changes.
 *
 * Paired with the app version at the call site, so a release busts the store
 * on its own and this only has to move when the shape changes *within* a
 * version — during development, mostly.
 */
export const CACHE_SCHEMA = 'v1'

/**
 * How long a persisted cache is still worth painting.
 *
 * Not a correctness bound — the refetch is what makes it correct — but a
 * usefulness one. Past a week the first paint is more likely to be a
 * conversation you have to watch rearrange itself than one you recognise.
 */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How many transcripts are kept.
 *
 * Transcripts are the only unbounded thing here — a long conversation is a lot
 * of text, and the store is written whole on every change. Twenty is well past
 * the handful anyone returns to and still small enough that serialising it is
 * not something the app has to think about.
 */
export const MAX_PERSISTED_TRANSCRIPTS = 20

/**
 * Whether a query is worth keeping across launches.
 *
 * Only the two reads that decide whether the app opens onto something or onto
 * a spinner: the session list, and the transcripts actually visited. Search
 * results are deliberately excluded — they are keyed by query string, so they
 * would accumulate one entry per thing ever typed and none of them is what
 * anybody sees on launch.
 *
 * Errors and pending queries are excluded too. A persisted failure would paint
 * a stale error over a host that is fine now.
 */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  if (query.state.status !== 'success' || query.state.data === undefined) return false

  const [root, , kind] = query.queryKey as unknown[]

  return root === 'agent' && (kind === 'sessions' || kind === 'transcript')
}

/**
 * Drop the oldest transcripts past the cap, newest first.
 *
 * The session list is never trimmed: there is one per agent, it is small, and
 * it is the thing the app opens onto.
 */
export function trimForPersistence(
  state: DehydratedState,
  maxTranscripts: number = MAX_PERSISTED_TRANSCRIPTS
): DehydratedState {
  const transcripts = state.queries.filter(query => query.queryKey[2] === 'transcript')

  if (transcripts.length <= maxTranscripts) return state

  const keep = new Set(
    [...transcripts]
      .sort((a, b) => (b.state.dataUpdatedAt ?? 0) - (a.state.dataUpdatedAt ?? 0))
      .slice(0, maxTranscripts)
      .map(query => query.queryHash)
  )

  return {
    ...state,
    queries: state.queries.filter(query => query.queryKey[2] !== 'transcript' || keep.has(query.queryHash))
  }
}

/** What is written to disk, so a reader can tell whose cache it is holding. */
export interface PersistedCache {
  buster: string
  savedAt: number
  state: DehydratedState
}

/**
 * Whether a file that was found is worth hydrating from.
 *
 * A mismatched buster is an app that has been updated or a shape that has
 * moved, and a cache older than the window is one nobody wants painted. Both
 * are discarded rather than migrated: everything in here is reconstructible
 * from the host by definition, so throwing it away costs a spinner once.
 */
export function isUsableCache(cache: PersistedCache | null, buster: string, now: number): boolean {
  if (!cache || cache.buster !== buster) return false
  if (typeof cache.savedAt !== 'number') return false

  return now - cache.savedAt <= CACHE_MAX_AGE_MS
}
