import type { Theme } from './theme'

/**
 * A card's tone comes from the **status ramp**, not the agent accent.
 *
 * The accent (`secondary*`) marks what belongs to the selected agent — the
 * pill, the composer, the sidebar. A board column is not the agent's identity,
 * it is a state a ticket is in, so it reads off the same info/warning/success
 * tokens `ToolCard` uses.
 *
 * It lives here rather than in the Boards screen because a card now appears in
 * two places: its lane, and the transcript where the agent named it. Two copies
 * of this switch is how "In Progress" ends up blue on one screen and grey on
 * the other.
 */
export interface StatusTone {
  text: string
  bg: string
  border: string
}

export function statusTone(theme: Theme, status: string): StatusTone {
  switch (status) {
    case 'in_progress':
      return { text: theme.color.info700, bg: theme.color.info50, border: theme.color.info200 }
    case 'testing':
      return { text: theme.color.warning700, bg: theme.color.warning50, border: theme.color.warning200 }
    case 'done':
      return { text: theme.color.success700, bg: theme.color.success50, border: theme.color.success200 }
    case 'blocked':
      return { text: theme.color.error700, bg: theme.color.error50, border: theme.color.error200 }
    default:
      return { text: theme.color.gray600, bg: theme.color.bgSubtle, border: theme.color.border }
  }
}

/**
 * The host writes 409/400 details as user-readable sentences (e.g. "cannot
 * move a card to In Progress from the phone — the host's dispatcher assigns
 * workers to cards"). The REST layer wraps the FastAPI ``{"detail": "…"}``
 * body in its own ``Hermes API <status> on <url>: <body>`` message, so parse
 * it off and show the host's text verbatim instead of the wrapper — every
 * kanban write surface (detail sheet moves/edits, create sheet) must read
 * host errors the same way.
 */
export function kanbanErrorText(e: unknown): string {
  if (e && typeof e === 'object' && 'body' in e) {
    try {
      const detail = (JSON.parse(String((e as { body: string }).body)) as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail) return detail
    } catch {
      // Not a JSON body — fall through to the raw message.
    }
  }
  return e instanceof Error ? e.message : String(e)
}
