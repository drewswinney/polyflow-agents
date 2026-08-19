/**
 * Telling the host where to push (§7.12, `docs/push-relay.md` §5).
 *
 * The host cannot discover a phone; the phone has to say so. Registration goes
 * to Hermes's **webhook gateway**, not to `hermes serve` — a `deliver_only`
 * route hands the raw body to the `handheld` platform plugin, which writes it to
 * the device registry. That is the only inbound channel a plugin can have
 * without owning a port.
 *
 * Two consequences the rest of the app has to live with:
 *
 * - **A second endpoint.** The webhook server is the messaging gateway's, on its
 *   own port, not the one every other request goes to.
 * - **A second secret**, the route's HMAC key. It lives in the keychain beside
 *   the pairing token and must never travel in a push payload.
 *
 * Preferences are sent along because a *closed* app cannot filter its own push.
 * Once the process is gone the host is the only thing that can decide whether
 * something is worth waking someone for, so it has to know what they asked for.
 */

import { sha256 } from 'js-sha256'

import type { NotificationPrefs } from '@/state/notification-prefs'

/** Where and how to reach one agent's registration route. */
export interface PushEndpoint {
  /** Origin of the webhook gateway, e.g. `http://100.64.0.1:8644`. */
  baseUrl: string
  /** Route name configured on the host; the plugin's README uses this default. */
  route?: string
  /** The route's HMAC secret. Keychain only. */
  secret: string
}

export interface RegistrationResult {
  ok: boolean
  /** Present on failure, for a settings row to show rather than a silent no-op. */
  error?: string
}

const DEFAULT_ROUTE = 'handheld-register'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * The prefs the host filters on. Deliberately not the whole `NotificationPrefs`:
 * quiet hours are evaluated on the device against its own clock and timezone,
 * which the host does not know and should not guess.
 */
function hostPrefs(prefs: NotificationPrefs): Record<string, boolean> {
  return {
    approvals: prefs.approvals,
    turnComplete: prefs.turnComplete,
    cronFailures: prefs.cronFailures,
    clarify: prefs.clarify,
    artifacts: prefs.artifacts
  }
}

async function post(endpoint: PushEndpoint, body: Record<string, unknown>): Promise<RegistrationResult> {
  const payload = JSON.stringify(body)
  // Seconds, not milliseconds: the host compares against a replay window in
  // unix seconds, and milliseconds read as a timestamp far in the future.
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sha256.hmac(endpoint.secret, `${timestamp}.${payload}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(
      `${endpoint.baseUrl.replace(/\/$/, '')}/webhooks/${endpoint.route ?? DEFAULT_ROUTE}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature-V2': signature
        },
        body: payload,
        signal: controller.signal
      }
    )

    if (!response.ok) {
      // The gateway answers 502 when the plugin is not loaded or the platform is
      // not enabled — a host misconfiguration, not a bad request, and worth
      // saying so rather than reporting a generic failure.
      return {
        ok: false,
        error:
          response.status === 502
            ? 'The host accepted the request but could not deliver it. Is the handheld plugin enabled?'
            : `The host rejected the registration (${response.status}).`
      }
    }

    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Register this device, or refresh what the host knows about it.
 *
 * Idempotent by token on the host, and called on every launch: Expo push tokens
 * rotate, and a registry keyed on a stale one pushes into the void.
 */
export function registerDevice(
  endpoint: PushEndpoint,
  token: string,
  options: { agentId: string; platform: string; label: string; prefs: NotificationPrefs }
): Promise<RegistrationResult> {
  return post(endpoint, {
    action: 'register',
    token,
    // Ours, not the host's. It comes back on every push so a tap can re-scope
    // the app before opening the session (§5.2) — the host has no idea what we
    // call its agents, so if we do not tell it, no notification can route.
    agentId: options.agentId,
    platform: options.platform,
    label: options.label,
    prefs: hostPrefs(options.prefs)
  })
}

/**
 * Stop this device receiving push.
 *
 * Half a revocation, like credential removal: it stops delivery, but nothing
 * about the host's own state is invalidated by the phone forgetting.
 */
export function unregisterDevice(endpoint: PushEndpoint, token: string): Promise<RegistrationResult> {
  return post(endpoint, { action: 'unregister', token })
}
