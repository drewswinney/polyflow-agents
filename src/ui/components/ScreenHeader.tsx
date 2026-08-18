import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

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
      style={[styles.wrap, { paddingTop: insets.top, borderBottomColor: theme.color.border }]}
    >
      <View style={styles.row}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backSlot}>
            <Icon name="chevron-left" size={17} />
          </Pressable>
        ) : null}

        <View style={styles.titleBlock}>
          <Text variant={onBack ? 'subTitle' : 'screenTitle'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle}
        </View>

        <View style={styles.rightSlot}>{right}</View>
      </View>

      {center ? <View pointerEvents="box-none" style={styles.center}>{center}</View> : null}
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
    paddingBottom: 8,
    gap: 6
  },
  backSlot: { width: 34, height: 34, marginLeft: -9, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, minWidth: 0 },
  rightSlot: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  // top: -6 against a bottom-aligned 52px row, so the pill rides above the
  // title's optical centre exactly as drawn.
  center: { position: 'absolute', left: 0, right: 0, bottom: 34, alignItems: 'center' }
})
