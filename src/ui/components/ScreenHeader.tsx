import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { IconButton } from './IconButton'
import { Text } from './Text'

const SCREEN_PAD = 20
const ROW_GAP = 6
/** The design's back-chevron slot: smaller than 44, topped up with hitSlop. */
const BACK_SLOT = 34
const BACK_GLYPH = 17

/**
 * Where the title's left edge actually lands once the chevron's slot and its
 * overhang are accounted for. Derived rather than eyeballed so the subtitle
 * cannot drift out of alignment with the title it belongs to.
 */
const TITLE_INDENT = SCREEN_PAD - (BACK_SLOT - BACK_GLYPH) / 2 + BACK_SLOT + ROW_GAP

/**
 * The Polyflow navbar treatment: translucent white over 12px blur, a 1px bottom
 * border, pinned above a scrolling body. Right-side actions are bare icons in a
 * 44px tap slot — no chip, no border (design §Design system).
 *
 * Laid out as three explicit rows — pill, title line, subtitle — rather than the
 * mock's construction of one bottom-aligned row with the pill absolutely
 * positioned above it. That construction cannot keep a right-hand action inline
 * with the title: bottom-aligning the row aligns the action with the *last* line
 * of the title block, so the moment a subtitle appears the action drops a line
 * below the title it belongs to. Explicit rows make "inline with the title" true
 * by construction, in both the one-line and title-plus-subtitle cases.
 */
export function ScreenHeader({
  title,
  subtitle,
  center,
  onBack,
  right,
  insetTop = true
}: {
  title: string
  subtitle?: ReactNode
  center?: ReactNode
  onBack?: () => void
  right?: ReactNode
  /**
   * Whether to reserve room for the status bar.
   *
   * False inside a modal. A modally presented screen is already inset by the
   * card that hosts it, but the safe-area context still reports the *window's*
   * top inset — so applying it there pads twice and the header floats.
   */
  insetTop?: boolean
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <BlurView
      intensity={12}
      tint="light"
      style={[
        styles.wrap,
        {
          // Both pads sit on the wrap, not inside a row, so the header actually
          // grows rather than shuffling its contents within a fixed height.
          paddingTop: (insetTop ? insets.top : 0) + theme.space.headerTop,
          paddingBottom: theme.space.headerBottom,
          borderBottomColor: theme.color.border
        }
      ]}
    >
      {center ? <View style={styles.pillRow}>{center}</View> : null}

      {/* Everything on this row shares one vertical centre — that is the whole
          point of it being its own row. */}
      <View style={styles.titleRow}>
        {onBack ? (
          // The design draws a 34px slot; the shortfall against the 44px
          // minimum is made up in hitSlop rather than by moving the chevron.
          <IconButton name="chevron-left" accessibilityLabel="Back" slot={BACK_SLOT} edge="left" onPress={onBack} />
        ) : null}

        <Text variant={onBack ? 'subTitle' : 'screenTitle'} numberOfLines={1} style={styles.title}>
          {title}
        </Text>

        {right}
      </View>

      {subtitle ? (
        // Indented to sit under the title rather than under the chevron.
        <View style={[styles.subtitleRow, onBack ? { paddingLeft: TITLE_INDENT } : null]}>{subtitle}</View>
      ) : null}
    </BlurView>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  pillRow: { alignItems: 'center', paddingBottom: 6 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SCREEN_PAD,
    gap: ROW_GAP,
    // Tall enough for the 44px action slot, so a header with an action is not
    // taller than one without.
    minHeight: 44
  },
  title: { flex: 1, minWidth: 0 },
  subtitleRow: { paddingHorizontal: SCREEN_PAD, paddingTop: 2 }
})
