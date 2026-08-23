/**
 * Telling the host where to push (§7.12, `docs/push-relay.md` §5).
 *
 * The host cannot discover a phone; the phone has to say so. That used to be
 * the hardest part of this feature and is now the easiest: registration is an
 * ordinary authenticated request through the backend, to a route the
 * `polyflow_agents_push` plugin mounts under `/api/plugins/polyflow_agents_push/`
 * in the same
 * process that serves the socket.
 *
 * What that replaced is worth remembering, because the old shape is what the
 * rest of this subsystem was bent around. A plugin could not own an HTTP route,
 * so registration went to Hermes's *webhook* gateway: a second endpoint on a
 * second port, authenticated by a second secret generated on the host and
 * retyped on the phone, carrying JSON behind a `#handheld:` sentinel because
 * `deliver_only` renders a template and the rendered text is the message.
 * Three costs, all paid for one missing route. `dashboard/plugin_api.py`
 * deleted all three.
 *
 * Preferences travel with the registration because a *closed* app cannot filter
 * its own push. Once the process is gone the host is the only thing that can
 * decide whether something is worth waking someone for, so it has to know what
 * was asked for. Quiet hours deliberately stay behind: they are evaluated on
 * the device against its own clock and timezone, which the host does not know
 * and should not guess.
 */

import type { AgentBackend, PushPrefs } from '@/domain'
import type { NotificationPrefs } from '@/state/notification-prefs'

export interface RegistrationResult {
  ok: boolean
  /**
   * The host answered, but has no such route.
   *
   * Distinct from a failure on purpose: a Hermes without the plugin is a host
   * that has not been set up, and telling someone "registration failed" sends
   * them looking for a fault in the app instead of an install step on the host.
   */
  notInstalled?: boolean
  /** Present on failure, for a settings row to show rather than a silent no-op. */
  error?: string
}

/** The prefs the host filters on — deliberately not the whole `NotificationPrefs`. */
export function hostPrefs(prefs: NotificationPrefs): PushPrefs {
  return {
    approvals: prefs.approvals,
    turnComplete: prefs.turnComplete,
    cronFailures: prefs.cronFailures,
    clarify: prefs.clarify,
    artifacts: prefs.artifacts
  }
}

/**
 * A REST status carried on a thrown error, without importing the backend's own
 * error class.
 *
 * `HermesRestError` lives under `src/backends/`, and nothing in `platform/` may
 * reach across that seam (§4.3). The status is the only field wanted here, so
 * it is read structurally.
 */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null

  const status = (error as { status?: unknown }).status

  return typeof status === 'number' ? status : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register this device, or refresh what the host knows about it.
 *
 * Idempotent by token on the host, and called on every launch: Expo push tokens
 * rotate, and a registry keyed on a stale one pushes into the void.
 */
export async function registerDevice(
  backend: AgentBackend,
  token: string,
  options: { agentId: string; platform: string; label: string; prefs: NotificationPrefs }
): Promise<RegistrationResult> {
  try {
    await backend.registerPushDevice({
      token,
      // Ours, not the host's. It comes back on every push so a tap can re-scope
      // the app before opening the session (§5.2) — the host has no idea what
      // we call its agents, so if we do not tell it, no notification can route.
      agentId: options.agentId,
      platform: options.platform,
      label: options.label,
      prefs: hostPrefs(options.prefs)
    })

    return { ok: true }
  } catch (cause) {
    const status = statusOf(cause)

    if (status === 404) {
      return {
        ok: false,
        notInstalled: true,
        error: 'This host has no polyflow_agents_push plugin, or it is installed but not enabled.'
      }
    }

    if (status === 401 || status === 403) {
      return { ok: false, error: 'The host rejected the credential this app is connected with.' }
    }

    return { ok: false, error: messageOf(cause) }
  }
}

/**
 * Stop this device receiving push.
 *
 * Half a revocation, like credential removal: it stops delivery, but nothing
 * about the host's own state is invalidated by the phone forgetting.
 */
export async function unregisterDevice(backend: AgentBackend, token: string): Promise<RegistrationResult> {
  try {
    await backend.unregisterPushDevice(token)

    return { ok: true }
  } catch (cause) {
    return { ok: false, error: messageOf(cause) }
  }
}
