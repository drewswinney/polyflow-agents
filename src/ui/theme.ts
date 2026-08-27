/**
 * Polyflow design tokens, transcribed from `docs/design/README.md`.
 *
 * Two rules govern this file:
 *
 * 1. **Nothing hardcodes a colour anywhere else.** The design supports light
 *    and dark themes; routing every colour through tokens makes switching a
 *    simple state change rather than a refactor.
 * 2. **Accent is resolved per agent.** A glance at any screen should say which
 *    agent you are in, so the six accent tokens come from the selected agent
 *    when it declares them and from `BASE_ACCENT` when it does not. Per-agent
 *    palettes themselves are a design decision, not one made here.
 */

import type { AgentAccent } from '@/domain'

import { retone, withHsl } from './color'

/** The Polyflow indigo/violet accent, exactly as drawn. */
export const BASE_ACCENT: AgentAccent = {
  primary: '#1d4ed8',
  secondary: '#6d28d9',
  secondaryDeep: '#5b21b6',
  secondaryMuted: '#c4b5fd',
  secondaryTint: '#f5f3ff',
  secondaryTintStrong: '#ede9fe'
}

/** Light theme neutral colours. */
export const NEUTRAL_LIGHT = {
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
  info700: '#1d4ed8',
  info200: '#bfdbfe',
  info50: '#eff6ff',
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
  highlight: '#fef9c3',
  /** Text/icons that sit on the accent gradient or a filled accent button. */
  onAccent: '#ffffff',
  /** Scrim behind sheets and the sidebar. */
  scrim: 'rgba(11,17,32,0.32)',
  /** Translucent wash laid over the blurred screen header. */
  headerWash: 'rgba(255,255,255,0.9)'
} as const

/**
 * Dark theme neutral colours.
 *
 * The ramp is **inverted, not copied**: `gray900` is the highest-contrast text
 * colour in both themes, so in dark mode it is near-white and steps *down* to
 * `gray400` for the faintest metadata. Keeping the light values here is what
 * made body text render as near-black on a near-black background.
 *
 * Surfaces step the other way — `bg` is the deepest, `surface` sits above it,
 * `bgSubtle` above that — so an elevated card reads as elevated without relying
 * on a shadow that dark backgrounds swallow anyway.
 *
 * Status colours are re-picked rather than inverted: on dark surfaces the `700`
 * text tones need to be the *light* end of each hue, and the `50` backgrounds
 * the dark end, or the pairing inverts into unreadable.
 */
export const NEUTRAL_DARK = {
  // Foreground ramp — high contrast to low. Checked against `bg` and `surface`.
  gray900: '#f8fafc',
  gray800: '#e2e8f0',
  gray600: '#b6c2d2',
  gray500: '#94a3b8',
  gray400: '#8593a6',
  // Structure.
  border: '#2c3444',
  divider: '#212936',
  // Surfaces — deepest to highest.
  bg: '#0b1120',
  surface: '#151c2b',
  bgSubtle: '#1c2434',
  primaryTint: '#16264a',
  info700: '#93b4f8',
  info200: '#2f4f8f',
  info50: '#16264a',
  success700: '#4ade80',
  success200: '#1e5735',
  success50: '#0e2a1a',
  successDot: '#4ade80',
  warning700: '#fdba74',
  warning200: '#6b3d13',
  warning50: '#2b1a0b',
  warningText: '#fdba74',
  error700: '#fca5a5',
  error200: '#7a2626',
  error50: '#2d1113',
  highlight: '#443307',
  /**
   * Text/icons on the accent gradient or a filled accent button. In dark mode
   * the accent itself is the *light* colour, so what sits on it must be dark —
   * white on a lifted accent lands around 3.5:1, which is not readable at body
   * size.
   */
  onAccent: '#150e26',
  /** Scrim behind sheets and the sidebar. */
  scrim: 'rgba(3,6,14,0.62)',
  /** Translucent wash laid over the blurred screen header. */
  headerWash: 'rgba(11,17,32,0.86)'
} as const

/**
 * Either palette. There is deliberately no alias that resolves to one of them:
 * a `NEUTRAL` shorthand pointing at the light palette is how the navigator
 * background and the startup gate ended up painting white in dark mode.
 */
export type NeutralColors = typeof NEUTRAL_LIGHT | typeof NEUTRAL_DARK

export type Theme = {
  /** Whether the dark palette is active — for the few native props (blur tint,
   *  keyboard appearance, status bar) that take a mode rather than a colour. */
  dark: boolean
  color: NeutralColors & AgentAccent
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
  /** Breathing room above the header row, on top of the safe-area inset. */
  headerTop: 12,
  /** Gap between the header's contents and its bottom border. */
  headerBottom: 12,
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

/**
 * Derives a dark-theme counterpart for any accent.
 *
 * Agents declare accents tuned for the light theme: saturated mid-tones for
 * foreground roles and near-white tints for surface roles. Used unchanged on a
 * dark background that inverts — the foreground roles go too dark to read, and
 * the tint roles become glaring near-white blocks.
 *
 * So each role is re-toned to the lightness its *job* needs in dark mode, with
 * the hue left alone so the agent still reads as itself. Roles are named after
 * their use in `AgentAccent`, not after a fixed colour.
 */
export function deriveDarkAccent(accent: AgentAccent): AgentAccent {
  return {
    // Gradient start/end keep real saturation — they sit under white text.
    primary: retone(accent.primary, 0.62, 1.05),
    secondary: retone(accent.secondary, 0.68, 1.05),
    // Text on tinted surfaces: light enough to clear AA on `secondaryTint`.
    secondaryDeep: withHsl(accent.secondaryDeep, 0.78, 0.65),
    // Borders: present against `bg` without glowing.
    secondaryMuted: withHsl(accent.secondaryMuted, 0.44, 0.38),
    // The tints stop being near-white and become dark tinted *surfaces*. Their
    // source saturation is rounding noise at that lightness, so it is replaced.
    secondaryTint: withHsl(accent.secondaryTint, 0.17, 0.32),
    secondaryTintStrong: withHsl(accent.secondaryTintStrong, 0.23, 0.34)
  }
}

export function buildTheme(accent: AgentAccent = BASE_ACCENT, darkMode: boolean = false): Theme {
  const neutral = darkMode ? NEUTRAL_DARK : NEUTRAL_LIGHT
  const resolved = darkMode ? deriveDarkAccent(accent) : accent

  return {
    dark: darkMode,
    color: { ...neutral, ...resolved },
    radius: RADIUS,
    space: SPACE,
    font: FONT,
    shadow: SHADOW
  }
}

export const BASE_THEME = buildTheme()
