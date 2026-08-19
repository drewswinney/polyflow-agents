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
 * Everything here is best-effort and silent on failure. Push is additive: an
 * unreachable webhook endpoint must not make the app feel broken when the parts
 * that matter — the socket, the transcript — are fine.
 */

import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { create } from 'zustand'

import type { Agent } from '@/domain'
import { getPushToken } from '@/platform/notifications'
import { registerDevice } from '@/platform/push-registration'
import { readPushConfig } from '@/platform/secure-store'

import { useNotificationPrefs } from './notification-prefs'

/**
 * Bumped when the stored endpoint changes.
 *
 * The config lives in the keychain, which nothing can subscribe to, so saving it
 * would otherwise leave the registration hook waiting for an unrelated render to
 * notice. Settings bumps this; the hook re-reads.
 */
export const usePushConfigRevision = create<{ revision: number; bump: () => void }>(set => ({
  revision: 0,
  bump: () => set(state => ({ revision: state.revision + 1 }))
}))

export type PushStatus =
  | { state: 'unconfigured' }
  | { state: 'unavailable' }
  | { state: 'registering' }
  | { state: 'registered' }
  | { state: 'error'; message: string }

/**
 * Register this device for the selected agent, and re-register when what the
 * host knows would otherwise go stale.
 *
 * Returns a status for Settings to show. A silent failure here is the exact
 * failure mode this whole subsystem exists to avoid, so it is reported even
 * though it is never thrown.
 */
export function usePushRegistration(agent: Agent): PushStatus {
  const [status, setStatus] = useState<PushStatus>({ state: 'unconfigured' })

  const prefs = useNotificationPrefs()
  const revision = usePushConfigRevision(state => state.revision)
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

    let cancelled = false

    const run = async () => {
      const config = await readPushConfig(agent.id)

      if (cancelled) return

      if (!config?.baseUrl || !config.secret) {
        setStatus({ state: 'unconfigured' })

        return
      }

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

      const result = await registerDevice(config, token, {
        platform: Platform.OS,
        label: agent.displayName,
        prefs: {
          approvals: prefs.approvals,
          clarify: prefs.clarify,
          turnComplete: prefs.turnComplete,
          cronFailures: prefs.cronFailures,
          artifacts: prefs.artifacts,
          quietHours: prefs.quietHours,
          quietFrom: prefs.quietFrom,
          quietTo: prefs.quietTo
        }
      })

      if (cancelled) return

      if (result.ok) {
        lastSent.current = attempt
        setStatus({ state: 'registered' })
      } else {
        // Not cached: a failed attempt must be retried on the next change, not
        // treated as the host's current state.
        setStatus({ state: 'error', message: result.error ?? 'Registration failed.' })
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [agent.id, agent.displayName, prefs, signature, revision])

  return status
}
