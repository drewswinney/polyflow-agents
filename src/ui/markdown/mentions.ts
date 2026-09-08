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
 * So this is one trigger for showing a card in the transcript. The other is
 * the ticket's id itself — `t_4584630a` — which is how the agent most often
 * refers to a card when it is not writing board files: it is what the board
 * shows, what `hermes kanban` takes, and what the card's own sheet copies. An
 * id is as unambiguous as a wiki-link, so it earns the same card. Those two
 * are deliberately *all*. Matching bare titles would turn an ordinary
 * sentence into a mention as soon as someone names a ticket "Testing", and
 * would unfurl a card from the agent quoting the user's own words back.
 */

/**
 * `[[slug]]` or `[[slug|label]]`, or a bare ticket id. The wiki-link is
 * deliberately single-line: an unclosed `[[` must not swallow a paragraph.
 * The id is `t_` and hex, bounded on both sides, so `t_deadbeef` in the middle
 * of a longer identifier is not one.
 */
const MENTION = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]|(?<![\w-])(t_[0-9a-f]{6,12})(?![\w-])/g

/** Reads one match of `MENTION` as a mention: a link with its label, or an id standing for itself. */
function toMention(match: RegExpMatchArray): Mention {
  if (match[3]) return { slug: match[3], label: match[3] }

  return { slug: match[1].trim(), label: match[2]?.trim() ?? null }
}

export interface Mention {
  /** The vault's id for the ticket, and the board card's `id`. */
  slug: string
  /** What the author wrote after the pipe, when they wrote one. */
  label: string | null
}

export type MentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; mention: Mention }

/** Cheap pre-check, so the common mention-free message never allocates. */
export function hasMention(source: string): boolean {
  return source.includes('[[') || source.includes('t_')
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
  for (const match of source.matchAll(new RegExp(MENTION))) {
    const at = match.index ?? 0

    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) })

    out.push({ kind: 'mention', mention: toMention(match) })
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

  for (const match of source.matchAll(new RegExp(MENTION))) {
    const mention = toMention(match)

    if (seen.has(mention.slug)) continue

    seen.add(mention.slug)
    out.push(mention)
  }

  return out
}
