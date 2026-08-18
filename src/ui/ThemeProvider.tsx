import { createContext, type ReactNode, useContext, useMemo } from 'react'

import type { AgentAccent } from '@/domain'

import { BASE_ACCENT, BASE_THEME, buildTheme, GRADIENT, type Theme } from './theme'

const ThemeContext = createContext<Theme>(BASE_THEME)

/**
 * Resolves the accent for the selected agent. Screens read `useTheme()` and
 * never import a colour directly, so re-theming per agent is a prop change.
 */
export function ThemeProvider({ accent, children }: { accent?: AgentAccent; children: ReactNode }) {
  const theme = useMemo(() => buildTheme(accent ?? BASE_ACCENT), [accent])

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
