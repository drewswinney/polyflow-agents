/**
 * Whether a notification that has arrived should actually be shown.
 *
 * Split out from `platform/notifications` so the rule can be tested without a
 * React Native runtime — the same reason `notification-copy` and
 * `session-list-sync` keep their decisions as plain functions. Nothing here
 * imports anything; it is the decision, not the delivery.
 *
 * The rule is narrow on purpose. It was briefly "only show a notification while
 * the app is backgrounded", which sounds right and is a constant `false`: the
 * OS only asks a *foregrounded* app whether to present, so the app state is
 * always `active` at the moment the question is put. That silenced every
 * notification the host delivered while the app was open, and — because the
 * same answer governs `shouldShowList` — kept them out of Notification Center
 * too, so there was nothing left to find afterwards.
 *
 * What is genuinely redundant is much smaller than "the app is open": it is a
 * banner about the one chat already on screen. That, and only that, is skipped.
 */

/** iOS passes through `inactive` on the way in and out; only `active` is "looking at it". */
export type AppStateLike = string

export function shouldPresentNotification(options: {
  /** The session the notification is about, from its payload. */
  sessionId: string | undefined
  /** The session whose chat is on screen, or null. */
  visibleSessionId: string | null
  appState: AppStateLike
}): boolean {
  const { sessionId, visibleSessionId, appState } = options

  // No session to be looking at — a cron result, an artifact, anything the
  // host sends without one. There is nothing on screen it could duplicate.
  if (!sessionId) return true

  return !(appState === 'active' && sessionId === visibleSessionId)
}

/**
 * The session a route is showing, or null for every other screen.
 *
 * Read from the path rather than set by the chat screen itself: the handler
 * that consumes it outlives every screen, and a session id left behind by a
 * screen that unmounted without clearing it would silence that chat for the
 * rest of the launch.
 */
export function visibleSessionFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(pathname)

  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    // A path that is not valid percent-encoding is not a session id we could
    // match against anyway; treat it as "no chat on screen" rather than throw
    // inside a router effect.
    return null
  }
}
