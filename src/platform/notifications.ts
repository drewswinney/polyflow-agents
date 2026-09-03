/**
 * Device-local notifications for a blocked or finished turn.
 *
 * §10.2 wants push, and push needs a relay on the host that watches the event
 * stream — the app cannot build that, and Hermes has no push support today. So
 * this is the half that works without one: while the app is running, an
 * approval request or a finished background turn raises a **local**
 * notification. That covers the case a phone user actually hits — the app is
 * open in another tab, or was open a moment ago — and stops short of pretending
 * to deliver anything when the process is gone.
 *
 * The relay remains the difference between "usually noticed" and "reliably
 * delivered". Nothing here should be read as making it unnecessary.
 */

import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'

import { shouldPresentNotification } from '@/state/notification-presentation'

let handlerInstalled = false

/**
 * The session whose chat is on screen, or null.
 *
 * Kept at module scope because `setNotificationHandler` takes a plain function
 * that outlives any render, so the handler cannot read this from a hook. The
 * root layout keeps it current — see `useVisibleSession`.
 */
let visibleSessionId: string | null = null

/** Told by the router which chat is in front of the user, so a banner about it can be skipped. */
export function setVisibleSession(sessionId: string | null): void {
  visibleSessionId = sessionId
}

/**
 * Registered on first use, never at import.
 *
 * "First use" has to include a *remote* push arriving, which is why this is
 * exported. Without a handler installed, expo-notifications does not present a
 * notification that lands while the app is foregrounded — and a push from the
 * host can arrive at any moment, including before this session has raised a
 * single local one. Calling it only from `notifyLocally` meant the host could
 * deliver perfectly and the phone would show nothing.
 *
 * This ran at module scope, which was harmless for as long as the module was
 * only reachable from the notifications screen. Wiring `useNotificationTap`
 * into the root layout pulled it onto the launch path, and a side effect on
 * the launch path is a different thing entirely: it runs while the root module
 * is still evaluating, before React has mounted and before any timeout in the
 * app can arm. If it throws there, nothing renders, nothing logs, and the
 * splash screen stays up with no way to tell why.
 *
 * Importing this module is now inert. The handler is installed by the first
 * call that actually needs it, once, and a failure costs the banner rather
 * than the app.
 */
export function ensureNotificationHandler(): void {
  if (handlerInstalled) return

  handlerInstalled = true

  try {
    Notifications.setNotificationHandler({
      // Present everything except the one banner that is genuinely redundant:
      // a notification about the chat you are looking at *right now*.
      //
      // This used to ask `AppState.currentState === 'background'`, which reads
      // as "only interrupt someone who looked away" but is a constant `false`
      // in practice. The OS only consults this handler for a *foregrounded*
      // app — a notification that lands on a backgrounded one is presented
      // without asking — so the state is `active` every time the question is
      // put, and the answer was always "show nothing". Since the local path
      // (`notification-tap`) fires only while backgrounded, that left no state
      // in which the app could raise a banner at all: the host delivered, and
      // the phone silently dropped it. `shouldShowList: false` meant it did
      // not even reach Notification Center, so there was nothing to find later.
      handleNotification: async notification => {
        const data = notification.request.content.data as { sessionId?: string } | undefined

        // Anything but the chat already on screen — another session, a list, a
        // push with no session to open — is news, and gets a banner.
        const show = shouldPresentNotification({
          sessionId: typeof data?.sessionId === 'string' ? data.sessionId : undefined,
          visibleSessionId,
          appState: AppState.currentState
        })

        return {
          shouldShowBanner: show,
          shouldShowList: show,
          shouldPlaySound: show,
          shouldSetBadge: false
        }
      }
    })
  } catch (cause) {
    console.warn('[notifications] could not install the notification handler:', cause)
  }
}

let permissionChecked = false
let permissionGranted = false

/**
 * Asked for lazily — at the moment the first notification would fire, not on
 * launch. A permission prompt before the user has seen why is the fastest way
 * to a permanent denial.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionChecked) return permissionGranted

  permissionChecked = true

  const existing = await Notifications.getPermissionsAsync()

  permissionGranted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted

  if (permissionGranted && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: 'Approvals',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250]
    })
  }

  return permissionGranted
}

/**
 * This device's Expo push token, or null when there cannot be one.
 *
 * Null is the normal answer in development: remote push needs a real build
 * (Expo Go dropped it in SDK 53) and an EAS project id, and neither is worth
 * an error — the app simply keeps working with local notifications only.
 *
 * The token is not stable. It rotates, which is why the caller re-registers it
 * on every launch rather than once at install.
 */
export async function getPushToken(): Promise<string | null> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined

  if (!projectId) return null
  if (!(await ensureNotificationPermission())) return null

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })

    return data || null
  } catch {
    // A simulator, a development client without push entitlements, or no
    // network. None of them are worth surfacing: push is additive.
    return null
  }
}

export interface LocalNotification {
  title: string
  body: string
  /**
   * Routed on tap; the agent is switched first if it is not the selected one.
   *
   * Deliberately the same shape the host's push payload uses, so
   * `useNotificationRouting` has one thing to handle rather than two.
   */
  data: { agentId: string; sessionId?: string; kind: 'approval' | 'complete' }
}

export async function notifyLocally(notification: LocalNotification): Promise<void> {
  ensureNotificationHandler()

  if (!(await ensureNotificationPermission())) return

  await Notifications.scheduleNotificationAsync({
    content: {
      title: notification.title,
      body: notification.body,
      data: notification.data,
      ...(Platform.OS === 'android' ? { channelId: 'approvals' } : {})
    },
    // null = deliver now. A trigger would queue it behind the scheduler for no
    // benefit; the event that caused it already happened.
    trigger: null
  })
}
