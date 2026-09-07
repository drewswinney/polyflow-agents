import { memo } from 'react'

import type { ToolCall } from '@/domain'

import { duration } from '../format'
import { useTheme } from '../ThemeProvider'
import { ToolGlyph } from './Icon'
import { Text } from './Text'
import { WorkRow } from './WorkRow'

/**
 * One tool call, as a line in the work section's list.
 *
 * Tool traffic is never rendered as chat text — on a phone it drowns the
 * conversation (§7.2) — but the card this used to be overcorrected: a tile, a
 * two-line body and a filled status chip gave one `ls` more presence than the
 * answer it was gathering. The facts are the same, on one line: what ran, on
 * what, how it ended, and the output behind a tap.
 *
 * `unknown` keeps its own neutral wording rather than being folded into
 * `error`: a call cut off by a disconnect has an outcome the app does not know,
 * and must not guess (§7.16).
 */
export const ToolRow = memo(function ToolRow({ call }: { call: ToolCall }) {
  const theme = useTheme()

  const status = statusMeta(call, theme)
  const label = call.summary ? `${call.name} · ${call.summary}` : call.name

  return (
    <WorkRow
      glyph={
        <ToolGlyph name={call.name} size={12} color={call.held ? theme.color.warning700 : theme.color.toolInk} />
      }
      label={label}
      ink={theme.color.toolInk}
      meta={status.label}
      metaColor={status.color}
      accessibilityLabel={`${label}. ${status.label}.`}
      body={call.output ? <Text variant="mono">{call.output}</Text> : undefined}
    />
  )
})

/**
 * The right-hand column: how the call ended, or how long it took.
 *
 * A settled call reports its duration and nothing else — "ok" next to a time
 * is a word doing no work. Everything that is *not* settled says so in a
 * colour, because that is the row you are looking for when you open a section.
 */
function statusMeta(call: ToolCall, theme: ReturnType<typeof useTheme>): { label: string; color: string } {
  switch (call.status) {
    case 'ok':
      return { label: call.durationMs ? duration(call.durationMs) : 'ok', color: theme.color.muted }
    case 'error':
      return { label: 'error', color: theme.color.error700 }
    case 'running':
      return { label: 'running', color: theme.color.info700 }
    case 'pending':
      return { label: call.held ? 'held' : 'pending', color: theme.color.warning700 }
    case 'unknown':
    default:
      return { label: 'unknown', color: theme.color.gray500 }
  }
}
