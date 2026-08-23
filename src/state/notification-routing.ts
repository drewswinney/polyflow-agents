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

import { ensureNotificationHandler } from '@/platform/notifications'

import { useAgents } from './agents'

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

    if (!coldStartHandled.current) {
      coldStartHandled.current = true

      void Notifications.getLastNotificationResponseAsync().then(response => {
        if (response) handle(response.notification.request.content.data as NotificationPayload)
      })
    }

    return () => subscription.remove()
  }, [agents, select, selectedId])
}
