import type { SessionMessage } from '@hermes/types'

import type { SystemNoteKind } from '@/domain'

/**
 * What the host injected, as read off a stored message.
 *
 * Hermes writes its own material into the conversation under `role: 'user'`
 * — compaction summaries, a cron job's prompt with its delivery preamble, a
 * skill's full text, "background process finished" notes — because strict
 * OpenAI-compatible providers reject a system message that is not first in
 * the list. A few carry a `display_kind`; most are marked only by how they
 * open. This is the one place that knows those openings, so the transcript
 * can draw them as plumbing rather than as something the person typed.
 *
 * Returns null for a real message. The prefixes come from the host's own
 * sources (`context_compressor.py`, `cron/scheduler.py`, `skill_commands.py`,
 * the background-process poller) and are matched at the very start of the
 * text, where the host puts them.
 */
export interface SystemNote {
  note: SystemNoteKind
  label: string
  /** One readable line from inside the injection, when there is one worth lifting out. */
  detail?: string
}

const CRON_PREAMBLE = '[IMPORTANT: You are running as a scheduled cron job.'
const SKILL_INVOCATION = /^\[IMPORTANT: The user has invoked the "([^"]+)" skill/
const SKILL_BUNDLE = /^\[IMPORTANT: The user has invoked the "([^"]+)" skill bundle/

export function classifySystemNote(message: Pick<SessionMessage, 'role' | 'display_kind' | 'content'>): SystemNote | null {
  switch (message.display_kind) {
    case 'async_delegation_complete':
      return { note: 'delegation', label: 'A delegated task finished' }
    case 'auto_continue':
      return { note: 'continue', label: 'Continued automatically' }
    case 'personality_switch':
      return { note: 'system', label: 'Personality changed' }
    default:
      break
  }

  const text = typeof message.content === 'string' ? message.content.trimStart() : ''

  if (!text.startsWith('[')) return null

  if (text.startsWith('[CONTEXT COMPACTION') || text.startsWith('[CONTEXT SUMMARY]')) {
    return { note: 'compaction', label: 'Earlier turns were compacted' }
  }

  // Only a user-role row can be the person's own message; the host's other
  // brackets are checked on user rows alone so an assistant that happens to
  // open a reply with "[SYSTEM]" is still the assistant.
  if (message.role !== 'user') return null

  if (text.startsWith(CRON_PREAMBLE)) {
    return { note: 'cron', label: 'Scheduled job prompt', ...withDetail(promptAfterPreamble(text)) }
  }

  const skill = SKILL_BUNDLE.exec(text) ?? SKILL_INVOCATION.exec(text)

  if (skill) {
    // A cron job with skills attached arrives as the skill text with the job's
    // preamble and prompt appended — one injection, and the job is what it is.
    if (text.includes(CRON_PREAMBLE)) {
      return {
        note: 'cron',
        label: `Scheduled job prompt · ${skill[1]}`,
        ...withDetail(promptAfterPreamble(text.slice(text.indexOf(CRON_PREAMBLE))))
      }
    }

    return { note: 'skill', label: `Skill loaded · ${skill[1]}` }
  }

  if (text.startsWith('[IMPORTANT: Background process')) {
    return { note: 'background', label: 'A background process reported', ...withDetail(firstLine(text.slice('[IMPORTANT: '.length))) }
  }

  if (
    text.startsWith('[SYSTEM]') ||
    text.startsWith('[SKILL_PRUNED:') ||
    text.startsWith('[Context from the interrupted assistant response]')
  ) {
    return { note: 'system', label: 'Note from the host' }
  }

  return null
}

/**
 * The job's own prompt: what follows the preamble's closing bracket.
 *
 * The preamble quotes `"[SILENT]"` inside itself, so the first `]` is not
 * its end; its end is the `]` that closes a line.
 */
function promptAfterPreamble(text: string): string {
  const close = /\]\s*(?:\n|$)/.exec(text)

  return close ? firstLine(text.slice(close.index + 1)) : ''
}

/** How much of a lifted line fits beside the label. */
const DETAIL_MAX = 100

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map(part => part.trim())
    .find(Boolean)

  if (!line) return ''
  if (line.length <= DETAIL_MAX) return line

  const cut = line.slice(0, DETAIL_MAX - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > DETAIL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function withDetail(detail: string): { detail?: string } {
  return detail ? { detail } : {}
}
