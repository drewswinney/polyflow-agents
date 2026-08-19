import { memo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { ToolCall } from '@/domain'

import { duration } from '../format'
import { useTheme } from '../ThemeProvider'
import { Icon, ToolGlyph } from './Icon'
import { Text } from './Text'

/**
 * Tool traffic is never rendered as chat text — on a phone it drowns the
 * conversation (§7.2). Each call is a card: name, argument summary, status
 * chip, and output collapsed behind a tap.
 *
 * `unknown` is a real status with its own neutral `?` treatment: a call cut off
 * by a disconnect has an outcome the app does not know, and must not guess (§7.16).
 */
export const ToolCard = memo(function ToolCard({ call }: { call: ToolCall }) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)

  const chip = statusChip(call, theme)

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border, borderRadius: theme.radius.row }
      ]}
    >
      <Pressable
        accessibilityRole="button"
        disabled={!call.output}
        onPress={() => setExpanded(value => !value)}
        style={styles.header}
      >
        <View style={[styles.tile, { backgroundColor: call.held ? theme.color.warning50 : theme.color.secondaryTint }]}>
          <ToolGlyph
            name={call.name}
            color={call.held ? theme.color.warning700 : theme.color.secondary}
          />
        </View>

        <View style={styles.headerBody}>
          <Text variant="rowLabelStrong" style={styles.name} numberOfLines={1}>
            {call.name}
          </Text>
          {call.summary ? (
            <Text variant="monoSmall" numberOfLines={1}>
              {call.summary}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.chip,
            { backgroundColor: chip.background, borderColor: chip.border, borderRadius: theme.radius.pill }
          ]}
        >
          <Text variant="monoSmall" color={chip.text}>
            {chip.label}
          </Text>
        </View>

        {call.output ? (
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={10} color={theme.color.gray400} />
        ) : null}
      </Pressable>

      {expanded && call.output ? (
        <View style={[styles.output, { backgroundColor: theme.color.bgSubtle }]}>
          <Text variant="mono">{call.output}</Text>
        </View>
      ) : null}
    </View>
  )
})

function statusChip(call: ToolCall, theme: ReturnType<typeof useTheme>) {
  switch (call.status) {
    case 'ok':
      return {
        label: call.durationMs ? duration(call.durationMs) : 'ok',
        background: theme.color.success50,
        border: theme.color.success200,
        text: theme.color.success700
      }
    case 'error':
      return { label: 'error', background: theme.color.error50, border: theme.color.error200, text: theme.color.error700 }
    case 'running':
      return {
        label: 'running',
        background: theme.color.primaryTint,
        border: '#bfdbfe',
        text: theme.color.primary
      }
    case 'pending':
      return {
        label: call.held ? 'held' : 'pending',
        background: theme.color.warning50,
        border: theme.color.warning200,
        text: theme.color.warning700
      }
    case 'unknown':
    default:
      return {
        label: 'state unknown',
        background: theme.color.bgSubtle,
        border: theme.color.border,
        text: theme.color.gray500
      }
  }
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11 },
  tile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerBody: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 13.5 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth },
  output: { paddingHorizontal: 12, paddingVertical: 10 }
})
