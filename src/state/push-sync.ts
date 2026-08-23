/**
 * Keeping the host's idea of this device current (§7.12).
 *
 * Registration is not a one-time setup step. Two things drift:
 *
 * - **The token rotates.** Expo reissues it, and a registry keyed on the old one
 *   pushes into the void with no error anyone sees. So it re-registers on every
 *   launch rather than once at install.
 * - **Preferences change.** They are filtered on the *host*, because a closed
 *   app cannot filter its own push, so turning something off in Settings means
 *   nothing until the host is told.
 *
 * This used to need a stored endpoint and secret of its own, because
 * registration went to a webhook route on the messaging gateway's port. It now
 * rides the live backend — same host, same credential, same connection — so
 * there is nothing to configure and nothing to keep in the keychain.
 *
 * Everything here is best-effort and quiet about it. Push is additive: a host
 * without the plugin must not make the app feel broken when the parts that
 * matter — the socket, the transcript — are fine.
 */

import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

import type { Agent, AgentBackend } from '@/domain'
import { getPushToken } from '@/platform/notifications'
import { registerDevice } from '@/platform/push-registration'

import { useNotificationPrefs } from './notification-prefs'

export type PushStatus =
  | { state: 'idle' }
  | { state: 'unsupported' }
  | { state: 'not_installed' }
  | { state: 'unavailable' }
  | { state: 'registering' }
  | { state: 'registered' }
  | { state: 'error'; message: string }

/**
 * Register this device with the connected host, and re-register when what the
 * host knows would otherwise go stale.
 *
 * Returns a status for Settings to show. A silent failure here is the exact
 * failure mode this whole subsystem exists to avoid, so it is reported even
 * though it is never thrown.
 */
export function usePushRegistration(backend: AgentBackend | null, agent: Agent | null): PushStatus {
  const [status, setStatus] = useState<PushStatus>({ state: 'idle' })

  const prefs = useNotificationPrefs()
  // Only the fields the host filters on. Quiet hours stay on the device — the
  // host does not know this phone's timezone and should not guess it.
  const signature = [prefs.approvals, prefs.clarify, prefs.turnComplete, prefs.cronFailures, prefs.artifacts].join(
    ','
  )

  // Re-registering is cheap but not free, and prefs change one toggle at a
  // time; this keeps a flurry of taps from becoming a flurry of requests.
  const lastSent = useRef<string>('')

  useEffect(() => {
    if (!prefs.hydrated) return

    if (!backend || !agent) {
      setStatus({ state: 'idle' })

      return
    }

    // Structural, not a probe: an OpenAI-compatible host has no process to hold
    // a device registry, so there is nothing to attempt and nothing to report
    // as broken (§4.1).
    if (!backend.capabilities.push.register) {
      setStatus({ state: 'unsupported' })

      return
    }

    let cancelled = false

    const run = async () => {
      const token = await getPushToken()

      if (cancelled) return

      if (!token) {
        // No EAS project id, or a build that cannot receive remote push. Local
        // notifications still work; this is a statement of fact, not an error.
        setStatus({ state: 'unavailable' })

        return
      }

      const attempt = `${agent.id}|${token}|${signature}`

      if (attempt === lastSent.current) return

      setStatus({ state: 'registering' })

      const result = await registerDevice(backend, token, {
        // The *agent*, not the server: this comes back on every push so a tap
        // can re-scope the app before opening the session, and the app is
        // scoped to an agent (§5.2).
        agentId: agent.id,
        platform: Platform.OS,
        label: agent.displayName,
        prefs
      })

      if (cancelled) return

      if (result.ok) {
        lastSent.current = attempt
        setStatus({ state: 'registered' })

        return
      }

      // Not cached: a failed attempt must be retried on the next change, not
      // treated as the host's current state.
      if (result.notInstalled) {
        setStatus({ state: 'not_installed' })

        return
      }

      setStatus({ state: 'error', message: result.error ?? 'Registration failed.' })
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [backend, agent, prefs, signature])

  return status
}
