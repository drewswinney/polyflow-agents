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
    default:
      return { text: theme.color.gray600, bg: theme.color.bgSubtle, border: theme.color.border }
  }
}
