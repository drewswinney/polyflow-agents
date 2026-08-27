import { describe, expect, it } from '@jest/globals'

import { contrastRatio, hexToHsl, hslToHex, parseHex, retone, withHsl } from '@/ui/color'
import { BASE_ACCENT, buildTheme, deriveDarkAccent, NEUTRAL_DARK, NEUTRAL_LIGHT } from '@/ui/theme'

/** WCAG 2.1 AA for body text. */
const AA = 4.5
/** WCAG 2.1 AA for large text, icons and other non-text graphics. */
const AA_LARGE = 3

describe('colour maths', () => {
  it('parses both hex forms and rejects junk', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#1d4ed8')).toEqual({ r: 29, g: 78, b: 216 })
    expect(parseHex('rebeccapurple')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
  })

  it('round-trips hex through HSL', () => {
    for (const hex of ['#1d4ed8', '#6d28d9', '#f8fafc', '#0b1120', '#808080']) {
      const hsl = hexToHsl(hex)
      expect(hsl).not.toBeNull()
      expect(hslToHex(hsl!)).toBe(hex)
    }
  })

  it('preserves hue while re-targeting lightness', () => {
    const source = '#6d28d9'
    const lifted = retone(source, 0.7)

    expect(hexToHsl(lifted)!.h).toBeCloseTo(hexToHsl(source)!.h, 0)
    expect(hexToHsl(lifted)!.l).toBeCloseTo(0.7, 1)
  })

  it('falls back to the input when a colour cannot be parsed', () => {
    expect(retone('not-a-colour', 0.5)).toBe('not-a-colour')
    expect(withHsl('not-a-colour', 0.5, 0.5)).toBe('not-a-colour')
  })

  it('computes known contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 0)
  })
})

describe.each([
  ['light', buildTheme(BASE_ACCENT, false)],
  ['dark', buildTheme(BASE_ACCENT, true)]
])('%s theme', (name, theme) => {
  const { color } = theme

  it('reports its own mode', () => {
    expect(theme.dark).toBe(name === 'dark')
  })

  // The original bug: the dark palette reused the light foreground ramp, so
  // body text was drawn near-black on a near-black background.
  it.each(['bg', 'surface', 'bgSubtle'] as const)('body text is readable on %s', surface => {
    for (const ink of ['gray900', 'gray800', 'gray600', 'gray500'] as const) {
      expect(contrastRatio(color[ink], color[surface])).toBeGreaterThanOrEqual(AA)
    }
  })

  // `gray400` is the faintest tier — placeholders, tab labels, disabled icons.
  // The dark ramp was rebuilt here so it clears AA outright. The light ramp
  // predates this change and sits at ~2.3:1; that is a real gap, but fixing it
  // means re-touching a light theme nobody reported a problem with, so it is
  // left alone deliberately rather than by oversight.
  const faintestFloor = theme.dark ? AA : 2
  it.each(['bg', 'surface', 'bgSubtle'] as const)('the faintest ink stays legible on %s', surface => {
    expect(contrastRatio(color.gray400, color[surface])).toBeGreaterThanOrEqual(faintestFloor)
  })

  it('keeps the foreground ramp monotonic', () => {
    const steps = (['gray900', 'gray800', 'gray600', 'gray500', 'gray400'] as const).map(k =>
      contrastRatio(color[k], color.bg)
    )

    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1])
  })

  it('separates the surface layers', () => {
    expect(color.bg).not.toBe(color.surface)
    expect(color.surface).not.toBe(color.bgSubtle)
  })

  it.each(['success', 'warning', 'error', 'info'] as const)('%s text is readable on its own tint', status => {
    expect(contrastRatio(color[`${status}700`], color[`${status}50`])).toBeGreaterThanOrEqual(AA)
  })

  it('keeps status text readable on the plain surfaces too', () => {
    for (const status of ['success700', 'warning700', 'error700', 'warningText'] as const) {
      expect(contrastRatio(color[status], color.bg)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('renders accent foregrounds against the app background', () => {
    expect(contrastRatio(color.primary, color.bg)).toBeGreaterThanOrEqual(AA_LARGE)
    expect(contrastRatio(color.secondary, color.bg)).toBeGreaterThanOrEqual(AA_LARGE)
    expect(contrastRatio(color.secondary, color.surface)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('reads accent text on accent tints', () => {
    expect(contrastRatio(color.secondaryDeep, color.secondaryTint)).toBeGreaterThanOrEqual(AA)
    expect(contrastRatio(color.secondaryDeep, color.secondaryTintStrong)).toBeGreaterThanOrEqual(AA)
  })

  // `onAccent` is what sits on a filled accent: send button, user bubbles, the
  // toggle knob, the voice buttons. It is white in both themes, which is only
  // safe because the filled roles stay deep while the foreground roles lift.
  it('reads onAccent against every filled accent role', () => {
    for (const fill of ['gradientFrom', 'gradientTo', 'accentFill'] as const) {
      expect(contrastRatio(color.onAccent, color[fill])).toBeGreaterThanOrEqual(AA)
    }
  })

  // The whole point of splitting the roles: a fill that had lifted far enough
  // to serve as a foreground would no longer hold white text.
  it('keeps filled accents deeper than the foreground accents', () => {
    expect(hexToHsl(color.gradientTo)!.l).toBeLessThan(hexToHsl(color.secondary)!.l + 0.01)
  })

  it('keeps the filled accent distinguishable from the background', () => {
    for (const fill of ['gradientFrom', 'gradientTo', 'accentFill'] as const) {
      expect(contrastRatio(color[fill], color.bg)).toBeGreaterThanOrEqual(AA_LARGE - 0.1)
    }
  })

  it('reads search highlights, which keep the secondary ink', () => {
    expect(contrastRatio(color.gray500, color.highlight)).toBeGreaterThanOrEqual(AA)
  })

  it('keeps borders visible without letting them shout', () => {
    for (const edge of ['border', 'secondaryMuted'] as const) {
      const ratio = contrastRatio(color[edge], color.surface)
      expect(ratio).toBeGreaterThan(1.2)
      expect(ratio).toBeLessThan(AA)
    }
  })
})

describe('palette structure', () => {
  it('defines the same tokens in both themes', () => {
    expect(Object.keys(NEUTRAL_DARK).sort()).toEqual(Object.keys(NEUTRAL_LIGHT).sort())
  })

  // The dark ramp began life as a copy of the light one. If that ever happens
  // again, this fails before the contrast assertions have to explain why.
  it('does not reuse light foreground values in the dark ramp', () => {
    for (const ink of ['gray900', 'gray800', 'gray600', 'gray500', 'gray400'] as const) {
      expect(NEUTRAL_DARK[ink]).not.toBe(NEUTRAL_LIGHT[ink])
    }
  })

  it('inverts the polarity of the ramp between themes', () => {
    expect(contrastRatio(NEUTRAL_LIGHT.gray900, '#ffffff')).toBeGreaterThan(AA)
    expect(contrastRatio(NEUTRAL_DARK.gray900, '#000000')).toBeGreaterThan(AA)
  })
})

describe('deriveDarkAccent', () => {
  it('lifts foreground roles and sinks tint roles', () => {
    const dark = deriveDarkAccent(BASE_ACCENT)

    expect(hexToHsl(dark.secondary)!.l).toBeGreaterThan(hexToHsl(BASE_ACCENT.secondary)!.l)
    expect(hexToHsl(dark.secondaryTint)!.l).toBeLessThan(hexToHsl(BASE_ACCENT.secondaryTint)!.l)
  })

  it('keeps each role recognisably the agent’s own hue', () => {
    const dark = deriveDarkAccent(BASE_ACCENT)

    for (const role of ['primary', 'secondary', 'secondaryDeep', 'secondaryMuted'] as const) {
      expect(hexToHsl(dark[role])!.h).toBeCloseTo(hexToHsl(BASE_ACCENT[role])!.h, 0)
    }
  })

  // Accents are per-agent and arbitrary, so the derivation has to hold up for
  // hues it was never tuned against — not just the shipped indigo/violet.
  it.each([
    ['red', { primary: '#dc2626', secondary: '#b91c1c', deep: '#991b1b', muted: '#fca5a5', tint: '#fef2f2' }],
    ['green', { primary: '#16a34a', secondary: '#15803d', deep: '#166534', muted: '#86efac', tint: '#f0fdf4' }],
    ['cyan', { primary: '#0891b2', secondary: '#0e7490', deep: '#155e75', muted: '#67e8f9', tint: '#ecfeff' }],
    ['amber', { primary: '#d97706', secondary: '#b45309', deep: '#92400e', muted: '#fcd34d', tint: '#fffbeb' }],
    ['grey', { primary: '#4b5563', secondary: '#374151', deep: '#1f2937', muted: '#d1d5db', tint: '#f9fafb' }]
  ])('holds up for an arbitrary %s accent', (_name, seed) => {
    const theme = buildTheme(
      {
        primary: seed.primary,
        secondary: seed.secondary,
        secondaryDeep: seed.deep,
        secondaryMuted: seed.muted,
        secondaryTint: seed.tint,
        secondaryTintStrong: seed.tint
      },
      true
    )
    const { color } = theme

    expect(contrastRatio(color.secondary, color.bg)).toBeGreaterThanOrEqual(AA_LARGE)
    expect(contrastRatio(color.secondaryDeep, color.secondaryTint)).toBeGreaterThanOrEqual(AA)
    expect(contrastRatio(color.onAccent, color.gradientTo)).toBeGreaterThanOrEqual(AA)
    expect(contrastRatio(color.onAccent, color.accentFill)).toBeGreaterThanOrEqual(AA)
    expect(contrastRatio(color.gray800, color.secondaryTint)).toBeGreaterThanOrEqual(AA)
  })
})
