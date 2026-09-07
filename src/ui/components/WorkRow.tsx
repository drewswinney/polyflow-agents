import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One step inside a work section: a thought, or a tool call.
 *
 * Both wear this rather than each drawing its own line, so a run of them reads
 * as a list — one glyph column, one text column, one meta column, and the same
 * height whichever kind a row happens to be. A tool used to be a 52px card with
 * a tile and a filled status chip, which gave a single `ls` the visual weight
 * of the reply it was in service of.
 *
 * Expanding is per-row and local. That is safe under FlashList's recycling
 * because these are keyed by entry id inside the section: a recycled cell gets
 * different keys, so React remounts the rows rather than handing one row's
 * open state to another.
 */
export function WorkRow({
  glyph,
  label,
  ink,
  meta,
  metaColor,
  body,
  accessibilityLabel
}: {
  glyph: ReactNode
  label: string
  /**
   * Colours the label, and the glyph through it — thought or tool, so a run of
   * rows is scannable by kind before any of it is read. Defaults to the quiet
   * grey the section header wears.
   */
  ink?: string
  /** Duration, or a status word. Absent when there is nothing to report. */
  meta?: string
  metaColor?: string
  /** Rendered when open. Absent means the row does not expand. */
  body?: ReactNode
  accessibilityLabel: string
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)

  const expandable = body !== undefined
  const tint = ink ?? theme.color.muted

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={expandable ? { expanded: open } : undefined}
        accessibilityLabel={accessibilityLabel}
        disabled={!expandable}
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => [styles.row, { opacity: pressed && expandable ? 0.6 : 1 }]}
      >
        {/* Fixed width, matching the section header above it, so every row's
            text starts on the same vertical line whatever glyph it carries. */}
        <View style={styles.glyph}>{glyph}</View>

        <Text variant="secondary" color={tint} style={styles.label} numberOfLines={1}>
          {label}
        </Text>

        {meta ? (
          <Text variant="monoSmall" color={metaColor ?? theme.color.muted}>
            {meta}
          </Text>
        ) : null}

        {/* Only when there is something behind it. A chevron on a row that does
            not open is a control that lies about what a tap will do. */}
        {expandable ? (
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={9} color={theme.color.muted} />
        ) : null}
      </Pressable>

      {open && expandable ? (
        <View style={[styles.body, { backgroundColor: theme.color.bgSubtle, borderRadius: theme.radius.control }]}>
          {body}
        </View>
      ) : null}
    </View>
  )
}

/** The one height every step row shares. */
const ROW_HEIGHT = 24

const styles = StyleSheet.create({
  row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyph: { width: 16, alignItems: 'center' },
  // `minWidth: 0` so a long label truncates instead of pushing the meta column
  // off the end of the row.
  label: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 10, paddingVertical: 8, marginTop: 2, marginBottom: 4 }
})
