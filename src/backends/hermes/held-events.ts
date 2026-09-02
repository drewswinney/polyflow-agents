/**
 * Events waiting on a session id this client cannot translate yet.
 *
 * Its own module, and pure, for the reason `turn-settled` is: this is a policy
 * — what to keep, how much, for how long — and a policy is worth testing
 * without a socket behind it. `backends/hermes/index.ts` cannot be imported in
 * a test at all; it reaches `expo-file-system`.
 *
 * The situation it exists for: a reconnect clears the stored↔runtime id maps
 * and re-mints them with a `session.resume` that `subscribe` deliberately does
 * not await. Every event arriving in that window names a runtime id the client
 * cannot resolve, so it matches no sink. Dropping those is why a turn that was
 * already running when the socket came back streamed to nobody until its next
 * chunk — the chat sitting idle while the agent worked.
 *
 * Generic over the event type on purpose: nothing here reads an event, it only
 * decides which ones are still worth offering to a router.
 */

/**
 * How many events may wait at once.
 *
 * Only ever filled during a resume round trip, so a handful is the realistic
 * depth. This is a ceiling against a host that streams hard into a resume that
 * never answers, not a depth anything is expected to reach.
 */
export const HELD_EVENT_LIMIT = 200

/**
 * How long an event may still be replayed.
 *
 * Past this it is not a chunk arriving a moment early, it is a chunk from a
 * turn the reconnect's transcript refetch has already covered (§5.4) — and
 * replaying it would append text the settled rows already carry.
 */
export const HELD_EVENT_TTL_MS = 30_000

interface Held<E> {
  event: E
  at: number
}

export interface HeldEvents<E> {
  /** How many are waiting. Zero is the overwhelmingly common case. */
  readonly size: number

  /** Queue one, evicting the oldest if that puts it over the limit. */
  hold(event: E, at: number): void

  /**
   * Offer everything waiting to `route`, oldest first.
   *
   * `route` is given the time the event *arrived*, not the time it is being
   * replayed: a tool duration or an approval deadline read off the clock at
   * replay would be short by however long the resume took.
   *
   * It returns whether it delivered. Anything it did not take is kept only
   * while `stillResolving` says an answer could still be coming *and* it is
   * inside the TTL; otherwise it is dropped. Returns how many were delivered.
   */
  flush(route: (event: E, at: number) => boolean, now: number, stillResolving: boolean): number

  /** Drop everything. The connection that fed the queue has gone. */
  clear(): void
}

export function createHeldEvents<E>(
  limit: number = HELD_EVENT_LIMIT,
  ttlMs: number = HELD_EVENT_TTL_MS
): HeldEvents<E> {
  let waiting: Held<E>[] = []

  return {
    get size() {
      return waiting.length
    },

    hold(event, at) {
      waiting.push({ event, at })

      // Oldest first: on a turn that is mid-reply the newest chunks are the
      // ones worth keeping.
      if (waiting.length > limit) waiting.splice(0, waiting.length - limit)
    },

    flush(route, now, stillResolving) {
      if (waiting.length === 0) return 0

      const cutoff = now - ttlMs
      // Swapped rather than spliced, so a sink that queues another event while
      // being fed cannot have it eaten by the replay it is inside of.
      const pending = waiting
      let delivered = 0

      waiting = []

      for (const entry of pending) {
        if (route(entry.event, entry.at)) {
          delivered += 1

          continue
        }

        if (stillResolving && entry.at >= cutoff) waiting.push(entry)
      }

      return delivered
    },

    clear() {
      waiting = []
    }
  }
}
