import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { SessionSummary } from '@/domain'

import { relativeTime } from '../format'
import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * A session row: 34px tinted tile, title, relative timestamp, one-line preview.
 * Rows are at least 60px so the whole row is a comfortable target.
 */
export const SessionRow = memo(function SessionRow({
  session,
  onPress
}: {
  session: SessionSummary
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.color.bgSubtle }]}
    >
      <View style={[styles.tile, { backgroundColor: theme.color.secondaryTint }]}>
        <Icon name="comments" size={14} color={theme.color.secondary} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="rowLabelStrong" numberOfLines={1} style={styles.title}>
            {session.title}
          </Text>
          <Text variant="monoSmall">{relativeTime(session.updatedAt)}</Text>
        </View>

        {session.preview ? (
          <Text variant="secondary" numberOfLines={1}>
            {session.preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  tile: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0 }
})
