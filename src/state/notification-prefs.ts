/**
 * Notification preferences (§7.12).
 *
 * These are **device-local**, not agent state: they describe what this phone
 * should interrupt you for, and they follow the phone rather than the agent.
 * That is why they are not in the agent registry and not written to any host.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

const STORAGE_KEY = 'notification-prefs/v1'

export interface NotificationPrefs {
  /** The agent is blocked and cannot continue until you answer. */
  approvals: boolean
  /** A turn finished while you were elsewhere. */
  turnComplete: boolean
  /** A cron job failed. */
  cronFailures: boolean
  /** Mute everything except approvals between the quiet hours below. */
  quietHours: boolean
  quietFrom: number
  quietTo: number
}

const DEFAULTS: NotificationPrefs = {
  // The one that earns an interruption by default: the agent is stopped,
  // waiting, and will stay stopped until you answer.
  approvals: true,
  turnComplete: false,
  cronFailures: true,
  quietHours: false,
  quietFrom: 23,
  quietTo: 7
}

interface PrefsState extends NotificationPrefs {
  hydrated: boolean
  hydrate: () => Promise<void>
  set: <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => void
}

export const useNotificationPrefs = create<PrefsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)

      if (raw) set({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) })
    } catch {
      // Corrupt prefs fall back to defaults rather than blocking the app.
    }

    set({ hydrated: true })
  },

  set(key, value) {
    set(state => ({ ...state, [key]: value }))

    const { hydrated, hydrate, set: _set, ...prefs } = get()
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }
}))

/**
 * Whether a notification of this kind should fire right now.
 *
 * Approvals deliberately ignore quiet hours: the agent is halted until you
 * answer, so silencing it does not spare you the interruption — it just delays
 * it and leaves the work stopped in the meantime. The design says the same
 * thing ("approvals still ring").
 */
export function shouldNotify(
  prefs: NotificationPrefs,
  kind: 'approval' | 'complete' | 'cron_failure',
  now = new Date()
): boolean {
  if (kind === 'approval') return prefs.approvals
  if (kind === 'complete' && !prefs.turnComplete) return false
  if (kind === 'cron_failure' && !prefs.cronFailures) return false

  return !inQuietHours(prefs, now)
}

export function inQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
  if (!prefs.quietHours) return false

  const hour = now.getHours()

  // A window that wraps midnight (23 → 7) is the normal case, so it is handled
  // first-class rather than as an edge.
  return prefs.quietFrom > prefs.quietTo
    ? hour >= prefs.quietFrom || hour < prefs.quietTo
    : hour >= prefs.quietFrom && hour < prefs.quietTo
}
