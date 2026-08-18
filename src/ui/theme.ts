/**
 * Polyflow design tokens, transcribed from `docs/design/README.md`.
 *
 * Two rules govern this file:
 *
 * 1. **Nothing hardcodes a colour anywhere else.** The design is light-only
 *    today (§12 open question 1); routing every colour through tokens makes a
 *    dark palette a swap rather than a refactor.
 * 2. **Accent is resolved per agent.** A glance at any screen should say which
 *    agent you are in, so the six accent tokens come from the selected agent
 *    when it declares them and from `BASE_ACCENT` when it does not. Per-agent
 *    palettes themselves are a design decision, not one made here.
 */

import type { AgentAccent } from '@/domain'

/** The Polyflow indigo/violet accent, exactly as drawn. */
export const BASE_ACCENT: AgentAccent = {
  primary: '#1d4ed8',
  secondary: '#6d28d9',
  secondaryDeep: '#5b21b6',
  secondaryMuted: '#c4b5fd',
  secondaryTint: '#f5f3ff',
  secondaryTintStrong: '#ede9fe'
}

/** Everything that does not change with the agent. */
export const NEUTRAL = {
  gray900: '#0b1120',
  gray800: '#1f2937',
  gray600: '#4b5563',
  gray500: '#6b7280',
  gray400: '#a3adbd',
  border: '#dfe3ea',
  divider: '#eef1f5',
  surface: '#ffffff',
  bg: '#fcfcfd',
  bgSubtle: '#f8fafc',
  primaryTint: '#eff6ff',
  success700: '#15803d',
  success200: '#bbf7d0',
  success50: '#f0fdf4',
  successDot: '#16a34a',
  warning700: '#c2410c',
  warning200: '#fed7aa',
  warning50: '#fff7ed',
  warningText: '#9a3412',
  error700: '#b91c1c',
  error200: '#fecaca',
  error50: '#fef2f2',
  highlight: '#fef9c3'
} as const

export type Theme = {
  color: typeof NEUTRAL & AgentAccent
  radius: typeof RADIUS
  space: typeof SPACE
  font: typeof FONT
  shadow: typeof SHADOW
}

/** 6px controls, 10px grouped rows, 12px content cards, 100px pills, 14px sheets. */
export const RADIUS = {
  control: 6,
  row: 10,
  card: 12,
  pill: 100,
  sheet: 14
} as const

/** 4px base. Screen padding 16 horizontal, headers 20. */
export const SPACE = {
  screen: 16,
  header: 20,
  card: 14,
  group: 12,
  row: 12,
  gap: 8
} as const

/**
 * The three-way split is load-bearing: Outfit for display, Inter for UI, Space
 * Mono for anything machine-generated (hosts, ports, model ids, token counts).
 * Family names match what `expo-font` registers in `app/_layout.tsx`.
 */
export const FONT = {
  display: 'Outfit_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold'
} as const

/**
 * Shadows are diffuse with no y-offset. iOS reads `shadowOffset`/`shadowRadius`;
 * Android's `elevation` implies a downward shadow, so elevated surfaces there
 * also carry a border (design §Platform notes).
 */
export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    elevation: 1
  },
  popover: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 15,
    elevation: 8
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 25,
    elevation: 16
  }
} as const

/** The 135° gradient — composer send button and the user's own bubbles only. */
export const GRADIENT = {
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 }
} as const

export function buildTheme(accent: AgentAccent = BASE_ACCENT): Theme {
  return {
    color: { ...NEUTRAL, ...accent },
    radius: RADIUS,
    space: SPACE,
    font: FONT,
    shadow: SHADOW
  }
}

export const BASE_THEME = buildTheme()
