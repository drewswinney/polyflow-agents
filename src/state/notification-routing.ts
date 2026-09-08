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
 * its agents. A push from an older host — one that has not learned to stamp the
 * firing profile — can only be opened in the agent `agentId` names, and a push
 * with neither opens nothing rather than guessing.
 *
 * Two entry points, and both are needed. A tap while the app runs arrives on the
 * response listener; a tap that *launches* the app has already happened by the
 * time React mounts, and is only visible through the last-response call.
 *
 * On a current host the `agentId` is not the routing signal, though — the
 * registry is shared across every profile on a host (each profile's
 * `polyflow_agents_push` dir is a symlink onto the machine-level store), so one
 * phone's token holds only the `agentId` of whichever profile was selected
 * when it last registered, and Expo rotates tokens, so that drifts. A push from
 * profile A used to carry B's `agentId`, and the app opened A's session
 * against B's scope: a blank chat. The host knows the one thing the app cannot
 * — which profile is actually talking — so a current host stamps the *firing*
 * profile on every payload, and that is what a tap routes on. `agentId` is the
 * tiebreaker (same profile name on several servers) and the fallback for
 * payloads from an older host.
 */

import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { ensureNotificationHandler } from '@/platform/notifications'

import type { Agent, AgentId } from '@/domain'

import { useAgents } from './agents'
import { forgetAnnouncement, markAnnounced, notificationKey } from './notification-ledger'

interface NotificationPayload {
  agentId?: string
  sessionId?: string
  requestId?: string
  kind?: string
  /**
   * The name of the profile that *fired* this push, as the host derived it
   * (`polyflow_agents_push/devices.py::current_profile_name`). `default` for
   * the deployment's root profile, the profile name otherwise.
   *
   * This is the source of truth for re-scoping, not `agentId`: the device
   * registry is shared across profiles and `agentId` is whichever profile was
   * selected when the device last registered, so it can lag behind the profile
   * actually talking. Present on payloads from a current host; absent on older
   * ones, in which case `agentId` is the only signal and we keep the old path.
   */
  profile?: string
  /** Set on an artifact push, so a tap opens the file rather than the chat. */
  artifactId?: string
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

      // Re-scope before the session opens: session ids are only unique within
      // a profile, and the whole app follows the selected agent.
      const target = resolveTapTarget(agents, selectedId, payload)

      if (target === null) return

      if (target !== selectedId) select(target)

      // An artifact is the thing worth opening — the chat it came from is one
      // tap away from there, and the reverse is a scroll through a transcript
      // looking for a tool card.
      if (payload.kind === 'artifacts' && payload.artifactId) {
        router.push(`/artifacts/${payload.artifactId}` as never)

        return
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
 * The agent a tapped notification should re-scope the app to, or `null` to
 * open nothing.
 *
 * Pure and exported so the decision — the part that used to silently route a
 * tap to the wrong profile — is unit-testable without mounting the hook.
 *
 * The primary signal is `payload.profile`, the *firing* profile the host
 * stamps on each push: the only one that cannot be stale. `payload.agentId`
 * is registration-time state (whichever profile was selected when the device
 * last registered), so on a multi-profile host it names the wrong profile —
 * the old blank-chat bug. It serves two secondary roles:
 *   - the sole signal on payloads from an older host that predates `profile`;
 *   - a tiebreaker when the same profile name exists on more than one server
 *     (the host that pushed is the one the device registered against).
 */
export function resolveTapTarget(
  agents: readonly Agent[],
  selectedId: AgentId,
  payload: NotificationPayload
): AgentId | null {
  if (payload.profile) {
    // The default profile is addressed by a null scope, not its name — mirror
    // the discovery mapping (backends/discovery.ts).
    const scope = payload.profile === 'default' ? null : payload.profile
    const candidates = agents.filter(agent => agent.scope === scope)

    if (candidates.length === 0) {
      // The firing profile no longer exists on any known host. Its session
      // resolves under no agent, so opening it is a guaranteed blank chat —
      // the same answer an unknown `agentId` has always got.
      return null
    }

    // Same profile name on several servers: the host that pushed is the one
    // the device registered against, which `agentId` still points at. Prefer
    // a known `agentId`, else the currently selected agent, as the server hint.
    const knownAgentId = payload.agentId && agents.some(agent => agent.id === payload.agentId)
      ? payload.agentId
      : selectedId
    const hintedServer = agents.find(agent => agent.id === knownAgentId)?.serverId

    return candidates.find(agent => agent.serverId === hintedServer)?.id ?? candidates[0].id
  }

  // Older host: no `profile` stamp. Fall back to `agentId`, and only switch to
  // an agent we still have — a notification can outlive its agent, and
  // selecting an unknown id would leave the app scoped to nothing.
  if (payload.agentId) {
    if (!agents.some(agent => agent.id === payload.agentId)) return null

    return payload.agentId
  }

  // Neither signal. A push with no addressable agent opens in the current
  // scope, which is a guess, so it opens nothing.
  return null
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

