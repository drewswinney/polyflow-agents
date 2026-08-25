import { createContext, type ReactNode, useContext, useMemo } from 'react'

import type { AgentAccent } from '@/domain'

import { useIsDarkMode } from '@/state/theme-prefs'
import { BASE_ACCENT, BASE_THEME, buildTheme, GRADIENT, type Theme } from './theme'

const ThemeContext = createContext<Theme>(BASE_THEME)

/**
 * Resolves the accent for the selected agent and theme mode (light/dark/system).
 * Screens read `useTheme()` and never import a colour directly, so re-theming
 * per agent or dark mode is just a prop/state change.
 */
export function ThemeProvider({ accent, children }: { accent?: AgentAccent; children: ReactNode }) {
  const isDark = useIsDarkMode()
  const theme = useMemo(() => buildTheme(accent ?? BASE_ACCENT, isDark), [accent, isDark])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** The 135° gradient's colour pair for the current agent. */
export function useGradient(): { colors: [string, string]; start: typeof GRADIENT.start; end: typeof GRADIENT.end } {
  const theme = useTheme()

  return { colors: [theme.color.primary, theme.color.secondary], start: GRADIENT.start, end: GRADIENT.end }
}
