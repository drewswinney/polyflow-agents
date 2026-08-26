/**
 * Theme preferences (§7.x).
 *
 * These are **device-local**, not agent state: they describe what appearance
 * this phone should use, and they follow the phone rather than the agent.
 * That is why they are not in the agent registry and not written to any host.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useColorScheme } from 'react-native'
import { create } from 'zustand'

const STORAGE_KEY = 'theme-prefs/v1'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemePrefs {
  mode: ThemeMode
}

const DEFAULTS: ThemePrefs = {
  mode: 'system'
}

interface PrefsState extends ThemePrefs {
  hydrated: boolean
  hydrate: () => Promise<void>
  set: <K extends keyof ThemePrefs>(key: K, value: ThemePrefs[K]) => void
}

export const useThemePrefs = create<PrefsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)

      if (raw) set({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<ThemePrefs>) })
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
 * Hook that returns whether dark mode should currently be active.
 * Safe to use before hydration completes — defaults to system preference.
 */
export function useIsDarkMode(): boolean {
  const mode = useThemePrefs(state => state.mode)
  const systemScheme = useColorScheme() ?? 'light'

  if (mode === 'light') return false
  if (mode === 'dark') return true
  return systemScheme === 'dark'
}
