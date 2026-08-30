/**
 * What happens when a notification is tapped (§7.12, §10.2).
 *
 * The design's open item, resolved here: **a notification can arrive for an
 * agent that is not selected**, and the whole app re-scopes on switch (§5.2), so
 * the agent has to change *before* the session opens. Opening first would show
 * one agent's session id resolved against another agent's backend — session ids
 * are only unique within a host.
 *
 * That is also why the host echoes an `agentId` back: it is ours, sent at
 * registration and stored per device, because the host has no idea what we call
 * its agents. A push without one can only be opened in the current scope, which
 * is a guess, so it opens nothing.
 *
 * Two entry points, and both are needed. A tap while the app runs arrives on the
 * response listener; a tap that *launches* the app has already happened by the
 * time React mounts, and is only visible through the last-response call.
 */

import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { ensureNotificationHandler } from '@/platform/notifications'

import { useAgents } from './agents'
import { forgetAnnouncement, markAnnounced, notificationKey } from './notification-ledger'

interface NotificationPayload {
  agentId?: string
  sessionId?: string
  requestId?: string
  kind?: string
  /** Set on the data-only push that says an approval was answered elsewhere. */
  resolved?: boolean
}

export function useNotificationRouting(): void {
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const selectedId = useAgents(state => state.selectedAgentId)

  // The handler is rebuilt whenever the agent list changes, but a cold-start tap
  // must be consumed exactly once no matter how often that happens.
  const coldStartHandled = useRef(false)

  useEffect(() => {
    const handle = (payload: NotificationPayload | null | undefined) => {
      if (!payload) return

      // Nothing to open: this one exists to clear a banner, not to be tapped
      // into. It can still be delivered as a tap if the OS showed it.
      if (payload.resolved) return

      const target = payload.agentId

      if (target && target !== selectedId) {
        // Only switch to an agent we still have. A notification can outlive the
        // agent it belonged to, and selecting an unknown id would leave the app
        // scoped to nothing.
        if (!agents.some(agent => agent.id === target)) return

        select(target)
      }

      if (payload.sessionId) router.push(`/chat/${payload.sessionId}`)
    }

    // Armed here rather than by the first local notification: this hook is
    // mounted at the root, so a push that lands while the app is open finds a
    // handler already installed. Otherwise the host delivers, iOS hands the
    // notification to a foregrounded app with nothing to present it, and the
    // whole chain looks broken from the one place a person can see it.
    ensureNotificationHandler()

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      handle(response.notification.request.content.data as NotificationPayload)
    })

    // Everything the host delivers is written into the ledger, so the socket
    // does not announce it a second time when the app next wakes and sees the
    // same happening on the live stream. That second banner — the same finished
    // turn, hours later, at whatever moment the app happened to reconnect — is
    // what made notifications look random.
    const received = Notifications.addNotificationReceivedListener(notification => {
      remember(notification.request.content.data as NotificationPayload)
    })

    if (!coldStartHandled.current) {
      coldStartHandled.current = true

      void Notifications.getLastNotificationResponseAsync().then(response => {
        if (response) handle(response.notification.request.content.data as NotificationPayload)
      })
    }

    return () => {
      subscription.remove()
      received.remove()
    }
  }, [agents, select, selectedId])

  /**
   * Read the tray on every wake, and treat what is in it as already said.
   *
   * The received-listener above only fires for a push that lands while this
   * process is alive. The case that actually produces the duplicate is the
   * other one: the phone was in a pocket, the host pushed, and the app was
   * asleep or gone. Nothing told it. But the banner is still sitting in
   * Notification Center, which is a record of what the person has already been
   * shown — so it is read back on launch and on every return to the app.
   */
  useEffect(() => {
    const seed = () => {
      void Notifications.getPresentedNotificationsAsync()
        .then(presented => {
          for (const notification of presented) {
            remember(notification.request.content.data as NotificationPayload)
          }
        })
        .catch(() => {
          // Unsupported on old Android, and refusable anywhere. A ledger that
          // could not be seeded costs a repeat, which is what we had before.
        })
    }

    seed()

    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') seed()
    })

    return () => subscription.remove()
  }, [])
}

/**
 * Record a delivered notification against the same key the socket would use.
 *
 * A blocking notification is keyed by its request id, which every path carries
 * and which is the reason a still-pending approval no longer rings on each
 * reconnect. `approval` and `clarify` are both written because the payload's
 * `kind` does not distinguish them — it collapses to `approval` for routing —
 * and a request id is unique either way, so writing both cannot suppress
 * anything it did not describe.
 */
function remember(payload: NotificationPayload | null | undefined): void {
  if (!payload) return

  if (payload.requestId) {
    // Answered elsewhere. The banner exists to be cleared, not to stand in for
    // a question that is still open.
    if (payload.resolved) {
      forgetAnnouncement(notificationKey('approval', payload.requestId))
      forgetAnnouncement(notificationKey('clarify', payload.requestId))

      return
    }

    markAnnounced(notificationKey('approval', payload.requestId))
    markAnnounced(notificationKey('clarify', payload.requestId))
  }

  if (payload.kind === 'complete' && payload.sessionId && !payload.resolved) {
    markAnnounced(notificationKey('complete', payload.sessionId))
  }
}

