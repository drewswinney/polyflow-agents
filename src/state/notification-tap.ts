/**
 * Turns agent events into local notifications (§7.12).
 *
 * Only fires while the app is **not** foregrounded. If you are looking at the
 * chat, the approval sheet is already in front of you and a banner saying so is
 * noise. The case worth interrupting is the one where you have looked away.
 */

import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import type { Agent, AgentBackend, EventRecord } from '@/domain'
import { notifyLocally } from '@/platform/notifications'

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

  useEffect(() => {
    if (!backend || !agent) return

    return backend.subscribeEvents((record: EventRecord) => {
      if (appState.current === 'active') return

      const notification = describe(record, agent)

      if (!notification) return

      if (!shouldNotify(prefs, notification.kind)) return

      void notifyLocally({
        title: notification.title,
        body: notification.body,
        data: { agentId: agent.id, sessionId: record.sessionId, kind: notification.data }
      })
    })
  }, [backend, agent, prefs])
}

type Described = {
  kind: 'approval' | 'complete' | 'cron_failure'
  data: 'approval' | 'complete'
  title: string
  body: string
}

function describe(record: EventRecord, agent: Agent): Described | null {
  if (record.name === 'approval.request') {
    return {
      kind: 'approval',
      data: 'approval',
      title: `${agent.displayName} needs approval`,
      body: record.detail || 'A command is waiting on your answer.'
    }
  }

  // The agent finished a turn while you were away — the reason
  // `background.complete` exists at all (§2.4).
  if (record.name === 'background.complete') {
    return {
      kind: 'complete',
      data: 'complete',
      title: `${agent.displayName} finished`,
      body: record.detail || 'A turn completed while you were away.'
    }
  }

  if (record.name.startsWith('cron.') && record.status === 'error') {
    return {
      kind: 'cron_failure',
      data: 'complete',
      title: `${agent.displayName}: a cron job failed`,
      body: record.detail || 'A scheduled job did not finish.'
    }
  }

  return null
}
