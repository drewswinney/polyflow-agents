/**
 * What has already been announced, so it is not announced again.
 *
 * Two independent paths raise a banner for the same happening, and neither can
 * see the other. The host's push plugin fires while the app is asleep — that is
 * the whole point of it — and `notification-tap` fires from the live socket
 * once the app is awake again. A turn that finished in your pocket is therefore
 * pushed by the host, and then, whenever the app next wakes and reconnects,
 * announced a second time locally. That is the repeat: not a bug in either
 * path, but the absence of anything holding both.
 *
 * A pending approval does the same thing on its own. The host re-raises
 * `approval.request` for one that is still waiting, so every reconnect rang
 * again for the same question — and reconnects are frequent by design.
 *
 * Deliberately in memory and deliberately per-key TTL'd. Persisting it would
 * mean a notification suppressed because a *previous install* of the app saw
 * it, and there is no version of that which fails safely: the cost of a missed
 * approval is an agent halted for hours.
 */

/** Key → when it was announced. */
const announced = new Map<string, number>()

/**
 * How long a key is remembered.
 *
 * Long enough to cover the gap between the host pushing something and the app
 * next waking to see it on the socket, which is the window the duplicate lives
 * in. Short enough that a genuinely new happening on the same session is not
 * swallowed by the old one.
 */
export const DEFAULT_TTL_MS = 30 * 60 * 1000

/** Bounded so a long-lived session cannot grow this without limit. */
const MAX_KEYS = 500

export type NotificationKind = 'approval' | 'clarify' | 'complete' | 'cron_failure'

/**
 * The identity of a happening, as both paths can compute it.
 *
 * An approval and a question are identified by the request they are about —
 * the one field the host, the push payload and the socket event all carry, and
 * the reason re-raising a pending approval is now silent rather than a second
 * banner.
 *
 * A completion has no such id. It is identified by its session, which is
 * coarser: two turns finishing on one session inside the TTL announce once.
 * That is the right way round — the alternative is announcing the same finished
 * turn twice, hours apart, which is what people actually noticed.
 */
export function notificationKey(kind: NotificationKind, id: string | undefined): string | null {
  if (!id) return null

  return `${kind}:${id}`
}

/** Whether this was already announced, by either path, recently enough to count. */
export function wasAnnounced(key: string | null, ttlMs = DEFAULT_TTL_MS): boolean {
  if (!key) return false

  const at = announced.get(key)

  if (at === undefined) return false
  if (Date.now() - at <= ttlMs) return true

  announced.delete(key)

  return false
}

/** Record that this went out — from the socket, or from the host's push. */
export function markAnnounced(key: string | null): void {
  if (!key) return

  announced.set(key, Date.now())

  if (announced.size > MAX_KEYS) prune()
}

/**
 * Forget a key, so the next occurrence is announced again.
 *
 * For an approval that was answered: the question is settled, and if the agent
 * asks about the same request id again it is genuinely asking again.
 */
export function forgetAnnouncement(key: string | null): void {
  if (key) announced.delete(key)
}

/** Exposed for tests; called on its own once the ledger grows. */
export function clearAnnouncements(): void {
  announced.clear()
}

function prune(): void {
  const cutoff = Date.now() - DEFAULT_TTL_MS

  for (const [key, at] of announced) {
    if (at < cutoff) announced.delete(key)
  }

  // Still oversized means everything in it is recent. Drop the oldest half
  // rather than let it grow: the worst case is a repeat, not a leak.
  if (announced.size > MAX_KEYS) {
    const oldestFirst = [...announced.entries()].sort((a, b) => a[1] - b[1])

    for (const [key] of oldestFirst.slice(0, Math.floor(oldestFirst.length / 2))) {
      announced.delete(key)
    }
  }
}
