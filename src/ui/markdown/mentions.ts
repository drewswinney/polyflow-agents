/**
 * Wiki-link mentions in agent text.
 *
 * `[[expose-kanban-board-screen]]` is not a markdown construct — `markdown-it`
 * leaves it as literal text, and until now so did we. It is, however, exactly
 * how the board on the host refers to a ticket: the board file links its cards
 * that way and the plugin's parser resolves the slug against `Backlog/<slug>.md`
 * (`host/polyflow_agents_push/dashboard/plugin_api.py`). An agent working that
 * board writes the same thing in chat because it is reading and writing the
 * same files.
 *
 * So this is the trigger for showing a card in the transcript, and it is
 * deliberately the *only* one. Matching bare titles would turn an ordinary
 * sentence into a mention as soon as someone names a ticket "Testing", and
 * would unfurl a card from the agent quoting the user's own words back.
 */

/** `[[slug]]` or `[[slug|label]]`. Deliberately single-line: an unclosed `[[` must not swallow a paragraph. */
const WIKI_LINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

export interface Mention {
  /** The vault's id for the ticket, and the board card's `id`. */
  slug: string
  /** What the author wrote after the pipe, when they wrote one. */
  label: string | null
}

export type MentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; mention: Mention }

/** Cheap pre-check, so the common mention-free message never allocates. */
export function hasMention(source: string): boolean {
  return source.includes('[[')
}

/**
 * Splits text into runs of prose and mentions, in order.
 *
 * Returns a single text segment when there is nothing to find, which is the
 * case the renderer takes on almost every message.
 */
export function splitMentions(source: string): MentionSegment[] {
  if (!hasMention(source)) return [{ kind: 'text', text: source }]

  const out: MentionSegment[] = []
  let last = 0

  // `matchAll` needs the regex's own `lastIndex` untouched between calls, so
  // this iterates a fresh copy rather than the shared literal.
  for (const match of source.matchAll(new RegExp(WIKI_LINK))) {
    const at = match.index ?? 0

    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) })

    out.push({ kind: 'mention', mention: { slug: match[1].trim(), label: match[2]?.trim() ?? null } })
    last = at + match[0].length
  }

  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) })

  return out
}

/**
 * Every distinct ticket a message names, in the order it names them.
 *
 * Deduplicated by slug: a message that mentions one ticket four times is still
 * about one ticket, and four identical cards under it would be noise.
 */
export function collectMentions(source: string): Mention[] {
  if (!hasMention(source)) return []

  const seen = new Set<string>()
  const out: Mention[] = []

  for (const match of source.matchAll(new RegExp(WIKI_LINK))) {
    const slug = match[1].trim()

    if (seen.has(slug)) continue

    seen.add(slug)
    out.push({ slug, label: match[2]?.trim() ?? null })
  }

  return out
}
