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

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

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

export interface LocalNotification {
  title: string
  body: string
  /** Routed on tap; the agent is switched first if it is not the selected one. */
  data: { agentId: string; sessionId?: string; kind: 'approval' | 'complete' }
}

export async function notifyLocally(notification: LocalNotification): Promise<void> {
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
