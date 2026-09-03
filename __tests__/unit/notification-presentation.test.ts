/**
 * When an arriving notification is shown, and when it is swallowed.
 *
 * Pinned because the rule was briefly inverted into one that could never be
 * true — "show it only while the app is backgrounded", asked at the one moment
 * the app is guaranteed to be foregrounded — and the symptom was no
 * notifications at all, with nothing left in Notification Center to explain it.
 */

import { describe, it, expect } from '@jest/globals'

import {
  shouldPresentNotification,
  visibleSessionFromPath
} from '@/state/notification-presentation'

describe('shouldPresentNotification', () => {
  it('shows a notification for a session other than the one on screen', () => {
    expect(
      shouldPresentNotification({
        sessionId: 's2',
        visibleSessionId: 's1',
        appState: 'active'
      })
    ).toBe(true)
  })

  it('skips only the chat already in front of you', () => {
    expect(
      shouldPresentNotification({
        sessionId: 's1',
        visibleSessionId: 's1',
        appState: 'active'
      })
    ).toBe(false)
  })

  it('shows it when no chat is open, which is most of the app', () => {
    expect(
      shouldPresentNotification({
        sessionId: 's1',
        visibleSessionId: null,
        appState: 'active'
      })
    ).toBe(true)
  })

  it('shows it for a notification with no session — cron output, an artifact', () => {
    expect(
      shouldPresentNotification({
        sessionId: undefined,
        visibleSessionId: null,
        appState: 'active'
      })
    ).toBe(true)
  })

  it('shows it once the app is no longer active, even on the same session', () => {
    // The regression: this handler is only ever consulted for a foregrounded
    // app, so a rule keyed on `background` answered "hide" every single time.
    // Whatever state is reported, anything short of `active` is not someone
    // reading that chat.
    for (const appState of ['background', 'inactive', 'unknown']) {
      expect(
        shouldPresentNotification({ sessionId: 's1', visibleSessionId: 's1', appState })
      ).toBe(true)
    }
  })
})

describe('visibleSessionFromPath', () => {
  it('reads the session id out of a chat route', () => {
    expect(visibleSessionFromPath('/chat/20260903_194344_b5b4de')).toBe('20260903_194344_b5b4de')
  })

  it('decodes an escaped id', () => {
    expect(visibleSessionFromPath('/chat/a%2Fb')).toBe('a/b')
  })

  it('reports no open chat for every other screen', () => {
    for (const path of ['/', '/sessions', '/settings', '/boards', '/voice/s1', '/chat']) {
      expect(visibleSessionFromPath(path)).toBeNull()
    }
  })
})
