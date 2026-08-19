import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { IconButton } from './IconButton'
import { Text } from './Text'

/**
 * Height of the title line the centred pill has to clear. The design pins the
 * pill above the title's optical centre rather than beside it, so this is a
 * measurement of the type, not a spacing choice.
 */
const TITLE_BLOCK_HEIGHT = 26

/**
 * The Polyflow navbar treatment: translucent white over 12px blur, a 1px bottom
 * border, pinned above a scrolling body. Right-side actions are bare icons in a
 * 44px tap slot — no chip, no border (design §Design system).
 */
export function ScreenHeader({
  title,
  subtitle,
  center,
  onBack,
  right
}: {
  title: string
  subtitle?: ReactNode
  center?: ReactNode
  onBack?: () => void
  right?: ReactNode
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
          // Both pads sit on the wrap, not inside the row. The row is a fixed
          // 52px by the design, so padding placed there would only shuffle the
          // title within it — the header has to grow from outside to actually
          // gain white space.
          paddingTop: insets.top + theme.space.headerTop,
          paddingBottom: theme.space.headerBottom,
          borderBottomColor: theme.color.border
        }
      ]}
    >
      <View style={styles.row}>
        {/* The design draws a 34px slot; the shortfall against the 44px
            minimum is made up in hitSlop rather than by moving the chevron. */}
        {onBack ? <IconButton name="chevron-left" accessibilityLabel="Back" slot={34} edge="left" onPress={onBack} /> : null}

        <View style={styles.titleBlock}>
          <Text variant={onBack ? 'subTitle' : 'screenTitle'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle}
        </View>

        <View style={styles.rightSlot}>{right}</View>
      </View>

      {center ? (
        <View
          pointerEvents="box-none"
          // The pill rides just above the bottom-aligned title, so its offset is
          // measured from the same edge the title is: raising the bottom padding
          // without this would drop the pill onto the title.
          style={[styles.center, { bottom: theme.space.headerBottom + TITLE_BLOCK_HEIGHT }]}
        >
          {center}
        </View>
      ) : null}
    </BlurView>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    gap: 6
  },
  titleBlock: { flex: 1, minWidth: 0 },
  rightSlot: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  center: { position: 'absolute', left: 0, right: 0, alignItems: 'center' }
})
