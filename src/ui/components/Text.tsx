import { Text as RNText, useWindowDimensions, type StyleProp, type TextProps, type TextStyle } from 'react-native'

import { useTheme } from '../ThemeProvider'

type Variant =
  | 'screenTitle'
  | 'sheetTitle'
  | 'subTitle'
  | 'stat'
  | 'body'
  | 'chat'
  | 'rowLabel'
  | 'rowLabelStrong'
  | 'secondary'
  | 'sectionHeader'
  | 'tabLabel'
  | 'pill'
  | 'mono'
  | 'monoSmall'

interface Props extends TextProps {
  variant?: Variant
  color?: string
  style?: StyleProp<TextStyle>
}

/**
 * The three-way type split from the design, in one place: Outfit for display,
 * Inter for UI, Space Mono for machine data (hosts, model ids, token counts).
 * Screens pick a variant; they never name a font family or size.
 *
 * Every variant below states a `lineHeight` alongside its `fontSize`, and React
 * Native scales only the second of those by the OS font setting. Left alone,
 * that is a bug the design never sees at 1×: turn the phone's text size up and
 * the glyphs grow inside line boxes that do not, so lines close on each other,
 * descenders are sliced, and a wrapped label crosses whatever sits beside it —
 * the agent switcher's rows ran into their own glyph column that way. Scaling
 * the pair together keeps the ratio the design chose at every text size.
 */
export function Text({ variant = 'body', color, style, ...rest }: Props) {
  const theme = useTheme()
  // The reactive read: `PixelRatio.getFontScale()` is a snapshot, so a phone
  // whose text size changes while the app is open keeps the stale ratio.
  const { fontScale } = useWindowDimensions()

  const variants: Record<Variant, TextStyle> = {
    screenTitle: { fontFamily: theme.font.display, fontSize: 22, lineHeight: 24, letterSpacing: -0.44 },
    sheetTitle: { fontFamily: theme.font.display, fontSize: 18, lineHeight: 22 },
    subTitle: { fontFamily: theme.font.display, fontSize: 17, lineHeight: 21 },
    stat: { fontFamily: theme.font.display, fontSize: 22, lineHeight: 26 },
    body: { fontFamily: theme.font.body, fontSize: 15, lineHeight: 24.75 },
    chat: { fontFamily: theme.font.body, fontSize: 14.5, lineHeight: 21.75 },
    rowLabel: { fontFamily: theme.font.body, fontSize: 15, lineHeight: 20 },
    rowLabelStrong: { fontFamily: theme.font.bodyMedium, fontSize: 15, lineHeight: 20 },
    secondary: { fontFamily: theme.font.body, fontSize: 13, lineHeight: 18 },
    sectionHeader: {
      fontFamily: theme.font.bodySemibold,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.66,
      textTransform: 'uppercase'
    },
    tabLabel: { fontFamily: theme.font.bodyMedium, fontSize: 10.5, lineHeight: 13 },
    pill: { fontFamily: theme.font.bodyMedium, fontSize: 12, lineHeight: 15 },
    mono: { fontFamily: theme.font.mono, fontSize: 11.5, lineHeight: 19.5 },
    monoSmall: { fontFamily: theme.font.mono, fontSize: 10.5, lineHeight: 14 }
  }

  const defaultColor: Record<Variant, string> = {
    screenTitle: theme.color.gray900,
    sheetTitle: theme.color.gray900,
    subTitle: theme.color.gray900,
    stat: theme.color.gray900,
    body: theme.color.gray800,
    chat: theme.color.gray800,
    rowLabel: theme.color.gray800,
    rowLabelStrong: theme.color.gray900,
    secondary: theme.color.gray500,
    sectionHeader: theme.color.gray500,
    tabLabel: theme.color.gray400,
    pill: theme.color.gray800,
    mono: theme.color.gray600,
    monoSmall: theme.color.gray400
  }

  const { lineHeight, ...typography } = variants[variant]

  return (
    <RNText
      {...rest}
      style={[
        typography,
        lineHeight === undefined ? null : { lineHeight: lineHeight * fontScale },
        { color: color ?? defaultColor[variant] },
        style
      ]}
    />
  )
}
