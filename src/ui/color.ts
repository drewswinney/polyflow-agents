/**
 * Colour maths for theme derivation.
 *
 * This exists for one reason: agent accents are **arbitrary**. An agent may
 * declare any six hex values it likes, so the dark theme cannot ship a
 * hand-picked dark counterpart for each one — it has to derive them. Working in
 * HSL lets us keep an accent's hue (the thing that identifies the agent) while
 * re-targeting lightness and saturation (the things that decide readability).
 */

export interface Hsl {
  /** Degrees, 0–360. */
  h: number
  /** 0–1. */
  s: number
  /** 0–1. */
  l: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Parses `#rgb` and `#rrggbb`. Returns null for anything else. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '')

  if (raw.length === 3) {
    const [r, g, b] = raw.split('')
    if (!/^[0-9a-fA-F]{3}$/.test(raw)) return null
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) }
  }

  if (raw.length === 6 && /^[0-9a-fA-F]{6}$/.test(raw)) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    }
  }

  return null
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex)
  if (!rgb) return null

  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number

  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60

  return { h, s, l }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = clamp01(s)
  const lig = clamp01(l)
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = lig - c / 2

  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]

  const channel = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${channel(r1)}${channel(g1)}${channel(b1)}`
}

/**
 * Re-targets a colour's lightness and saturation while preserving its hue.
 * Saturation is *scaled* rather than replaced so a deliberately muted accent
 * stays muted relative to a vivid one.
 */
export function retone(hex: string, targetL: number, satScale = 1, fallback = hex): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return fallback

  return hslToHex({ h: hsl.h, s: clamp01(hsl.s * satScale), l: targetL })
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0

  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Rebuilds a colour at an absolute lightness and saturation, keeping its hue.
 *
 * Use this instead of {@link retone} when the source colour's saturation is not
 * meaningful — a near-white tint like `#f5f3ff` carries only a few points of
 * channel spread, so scaling its nominal saturation amplifies rounding noise
 * rather than intent. The hue survives, which is what identifies the agent.
 */
export function withHsl(hex: string, targetL: number, targetS: number, fallback = hex): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return fallback

  return hslToHex({ h: hsl.h, s: targetS, l: targetL })
}

/**
 * Deepens a colour until `over` reads against it at `minRatio`, starting from
 * `startL` and stepping down.
 *
 * A fixed lightness cannot serve every hue: at the same HSL lightness an amber
 * is far more luminous than a violet, so `l = 0.54` carries white for one and
 * fails for the other. Agent accents are arbitrary, so the fill has to be
 * derived from the contrast requirement itself rather than from a constant.
 */
export function deepenUntil(hex: string, over: string, minRatio: number, startL: number): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return hex

  for (let l = Math.min(startL, 0.95); l >= 0.1; l -= 0.01) {
    const candidate = hslToHex({ h: hsl.h, s: hsl.s, l })
    if (contrastRatio(over, candidate) >= minRatio) return candidate
  }

  return hslToHex({ h: hsl.h, s: hsl.s, l: 0.1 })
}
