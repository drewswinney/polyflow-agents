/**
 * Turns agent events into local notifications (§7.12).
 *
 * Only fires while the app is **backgrounded**. If you are looking at the chat,
 * the approval sheet is already in front of you and a banner saying so is
 * noise. The case worth interrupting is the one where you have looked away.
 *
 * Three things this has to get right, all of which it used to get wrong:
 *
 * - **What it says.** A banner reading "A turn completed while you were away"
 *   tells you nothing you could act on. It now carries what the agent actually
 *   said, asked, or wants to run — see `notification-copy`, and the turn digest
 *   this keeps for exactly that.
 * - **When it says it.** Only `background.complete` was treated as a finished
 *   turn, so an ordinary turn ending while you were away — which ends on
 *   `message.complete` — was never reported at all.
 * - **How often.** Nothing remembered what had already gone out, so a pending
 *   approval rang again on every reconnect and a turn the host had already
 *   pushed rang a second time when the app woke. See `notification-ledger`.
 */

import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import type { Agent, AgentBackend, EventRecord, SessionId } from '@/domain'
import { notifyLocally } from '@/platform/notifications'

import { describeNotification, followTurn, type TurnDigest } from './notification-copy'
import { markAnnounced, wasAnnounced } from './notification-ledger'
import { shouldNotify, useNotificationPrefs } from './notification-prefs'

export function useNotificationTap(backend: AgentBackend | null, agent: Agent | null): void {
  const prefs = useNotificationPrefs()
  const appState = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      appState.current = next
    })

    return () => subscription.remove()
  }, [])

  /**
   * What each session has said this turn, held across resubscriptions.
   *
   * A ref rather than a local: the effect below re-runs when the backend is
   * replaced (every reconnect) or when a preference is toggled, and a map
   * rebuilt there would throw away the reply that is halfway through arriving —
   * leaving the banner for the turn that is about to end with nothing to quote.
   */
  const digests = useRef(new Map<SessionId, TurnDigest>())

  useEffect(() => {
    if (!backend || !agent) return

    return backend.subscribeEvents((record: EventRecord) => {
      // Followed whatever the app is doing. The text has to be accumulating
      // *before* the turn ends, and a turn routinely starts while you are
      // watching and finishes after you have put the phone down.
      followTurn(digests.current, record)

      // `background` rather than "not active". iOS passes through `inactive`
      // on the way in *and* on the way out, and the way in is the worst moment
      // to fire: the app reconnects as it foregrounds, a burst of events
      // lands, and every one of them rang for something the person was about
      // to be looking at. That is the "notifications at random times".
      if (appState.current !== 'background') return

      const notification = describeNotification(record, agent, digests.current)

      if (!notification) return
      if (!shouldNotify(prefs, notification.kind)) return

      // Already out, by this path or by the host's push.
      if (wasAnnounced(notification.key)) return

      markAnnounced(notification.key)

      if (notification.sessionId) {
        const digest = digests.current.get(notification.sessionId)

        if (digest && notification.kind === 'complete') digest.announced = true
      }

      void notifyLocally({
        title: notification.title,
        body: notification.body,
        data: { agentId: agent.id, sessionId: record.sessionId, kind: notification.data }
      })
    })
  }, [backend, agent, prefs])
}
