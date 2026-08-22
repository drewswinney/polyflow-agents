import { memo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { EventRecord } from '@/domain'

import { clockTime } from '../format'
import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One row in the event stream (§7.5) or the log (§7.15).
 *
 * `expandable` is what separates the two: Activity shows the stream read-only,
 * while Logs opens a row onto its pretty-printed payload.
 */
export const EventRow = memo(function EventRow({
  record,
  expandable = false
}: {
  record: EventRecord
  expandable?: boolean
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)

  const statusColor =
    record.status === 'error'
      ? theme.color.error700
      : record.status === 'ok'
        ? theme.color.success700
        : theme.color.gray400

  return (
    <View>
      <Pressable
        accessibilityRole={expandable ? 'button' : 'text'}
        disabled={!expandable || record.payload === undefined}
        onPress={() => setOpen(value => !value)}
        style={styles.row}
      >
        <Text variant="monoSmall" style={styles.time}>
          {record.at ? clockTime(record.at) : '--:--'}
        </Text>

        <View style={styles.body}>
          <Text variant="rowLabelStrong" numberOfLines={1} style={styles.name}>
            {record.name}
          </Text>
          {record.detail ? (
            <Text variant="secondary" numberOfLines={1}>
              {record.detail}
            </Text>
          ) : null}
        </View>

        {record.status === 'error' ? (
          <Icon name="circle-exclamation" size={11} color={statusColor} />
        ) : record.status === 'ok' ? (
          <Icon name="check" size={11} color={statusColor} />
        ) : null}

        {expandable && record.payload !== undefined ? (
          <Icon name={open ? 'chevron-up' : 'chevron-right'} size={10} color={theme.color.gray400} />
        ) : null}
      </Pressable>

      {open && record.payload !== undefined ? (
        <View style={[styles.well, { backgroundColor: theme.color.bgSubtle }]}>
          <View style={[styles.payload, { backgroundColor: theme.color.surface, borderRadius: theme.radius.control }]}>
            <Text variant="mono">{prettyPayload(record.payload)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  )
})

function prettyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload

  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    // Circular or otherwise unserialisable: say so rather than render nothing.
    return String(payload)
  }
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 8 },
  time: { width: 42 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 13.5 },
  well: { padding: 10 },
  payload: { padding: 12 }
})
