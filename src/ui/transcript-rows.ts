import type { Artifact, TranscriptEntry } from '@/domain'

import { type ScheduledJobRef, scheduledJobRefs } from './scheduled'

/**
 * What the transcript list actually renders.
 *
 * Thinking and tool calls are the agent's working-out, not the conversation
 * (§7.2), and on a phone a turn's worth of them pushes the reply that matters
 * off the screen. Each unbroken run between messages collapses into one row
 * that names what the agent is doing right now, and opens to the cards
 * themselves. Everything else stays exactly what it was.
 */
export type TranscriptRow =
  | { kind: 'entry'; id: string; entry: TranscriptEntry }
  | { kind: 'work'; id: string; entries: TranscriptEntry[] }
  /**
   * What a stretch of working-out produced, as cards you can open.
   *
   * Not an entry: the host's transcript has no row for a file, only the tool
   * call that wrote it. These come from the artifact store (`docs/artifacts.md`)
   * and are slotted in by time, so a card sits right under the work that made
   * it and above the reply that mentions it.
   */
  | { kind: 'artifacts'; id: string; artifacts: Artifact[] }
  /**
   * The scheduled jobs a stretch of working-out created or changed, as cards.
   *
   * Read off the `cronjob` tool calls in the section above it rather than
   * fetched: the call's result names the job, so the card can stand even
   * when the job has since been deleted. `at` is when the section settled.
   */
  | { kind: 'scheduled'; id: string; refs: ScheduledJobRef[]; at: number }

/** Thinking and tool calls group; messages and stream cuts break the run. */
function isWork(entry: TranscriptEntry): boolean {
  return entry.kind === 'thinking' || entry.kind === 'tool'
}

/**
 * Groups each run of working-out into a single row.
 *
 * Keyed off the *first* entry in the run, which is what keeps a section open
 * while the agent is still adding to it: the run grows at the end, so an id
 * taken from the last entry would change under the open/closed state on every
 * new tool call and shut the section in your face.
 */
export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []

  for (const entry of entries) {
    if (!isWork(entry)) {
      rows.push({ kind: 'entry', id: entry.id, entry })
      continue
    }

    const last = rows[rows.length - 1]

    if (last?.kind === 'work') {
      last.entries.push(entry)
      continue
    }

    // Prefixed so a group can never collide with the entry row of the same id.
    rows.push({ kind: 'work', id: `work:${entry.id}`, entries: [entry] })
  }

  return rows
}

/** When an entry happened — for a tool, when it finished. */
function entryTime(entry: TranscriptEntry): number {
  if (entry.kind === 'tool') return entry.call.startedAt + (entry.call.durationMs ?? 0)

  return entry.at
}

/** When a row happened: the last thing in it. */
function rowTime(row: TranscriptRow): number {
  switch (row.kind) {
    case 'entry':
      return entryTime(row.entry)
    case 'work':
      return row.entries.reduce((latest, entry) => Math.max(latest, entryTime(entry)), 0)
    case 'artifacts':
      return row.artifacts.reduce((latest, artifact) => Math.max(latest, artifact.createdAt), 0)
    case 'scheduled':
      return row.at
  }
}

/**
 * Slot the session's artifacts into the transcript, by time.
 *
 * Each artifact goes after the last row that had already happened when it was
 * made — for a file the agent wrote, that is the work section holding the
 * `write_file` call, so the card lands under the work and above the reply.
 * Artifacts that land in the same gap share one row. Pictures the user sent
 * are left out: they already show in the user's own bubble, and a card for
 * one would say "the agent produced this", which it did not.
 *
 * Rows are chronological, so the slot for a later artifact is never earlier
 * than for an earlier one, and the ids — the first artifact in each group —
 * hold still as new ones arrive after them.
 */
export function withArtifactRows(rows: readonly TranscriptRow[], artifacts: readonly Artifact[]): TranscriptRow[] {
  const produced = artifacts.filter(artifact => artifact.origin === 'agent').sort((a, b) => a.createdAt - b.createdAt)

  if (produced.length === 0) return [...rows]

  const times = rows.map(rowTime)
  const bySlot = new Map<number, Artifact[]>()

  for (const artifact of produced) {
    let slot = 0

    while (slot < rows.length && times[slot] <= artifact.createdAt) slot += 1

    const group = bySlot.get(slot)

    if (group) group.push(artifact)
    else bySlot.set(slot, [artifact])
  }

  const merged: TranscriptRow[] = []

  for (let index = 0; index <= rows.length; index += 1) {
    const group = bySlot.get(index)

    if (group) merged.push({ kind: 'artifacts', id: `artifacts:${group[0].id}`, artifacts: group })
    if (index < rows.length) merged.push(rows[index])
  }

  return merged
}

/**
 * Slot a card under each stretch of working-out that touched a scheduled job.
 *
 * The `cronjob` call sits inside a collapsed work row, where a result nobody
 * opens is a job nobody sees. The card goes straight after that row, so it
 * lands under the work that made it and above the reply that describes it —
 * the same place an artifact the section wrote would go. Keyed off the first
 * entry in the section, for the same reason the section is.
 */
export function withScheduledJobRows(rows: readonly TranscriptRow[]): TranscriptRow[] {
  const merged: TranscriptRow[] = []

  for (const row of rows) {
    merged.push(row)

    if (row.kind !== 'work') continue

    const refs = scheduledJobRefs(row.entries)

    if (refs.length === 0) continue

    merged.push({ kind: 'scheduled', id: `scheduled:${row.entries[0].id}`, refs, at: rowTime(row) })
  }

  return merged
}

/** How long a headline runs before it is cut. Roughly one line on a phone. */
const HEADLINE_MAX = 72

/**
 * What a thought was about, in one line.
 *
 * The opening sentence, because that is where a model states the thing it is
 * about to work through — "Checking whether the socket is still open" ahead of
 * three paragraphs of checking. Not a summary: nothing here can summarise, and
 * a first sentence that is honestly the first sentence beats a synthetic one
 * that might not be.
 */
/**
 * Verbs that hedge rather than act. "I'll try to fetch the page" is fetching;
 * "trying" says only that an attempt is under way.
 */
const HEDGES = new Set(['try', 'attempt', 'start', 'begin', 'proceed', 'continue', 'go'])

/** Skipped on the way to the verb: "I'll also check" is checking. */
const ADVERBS = new Set([
  'just', 'also', 'now', 'first', 'then', 'next', 'quickly', 'simply', 'actually',
  'probably', 'instead', 'still', 'again', 'maybe', 'perhaps', 'only', 'directly',
  'carefully', 'briefly', 'finally'
])

/**
 * Words that are never the verb. Reached when the agent hedges into a noun —
 * "I'll try a different approach" — where the hedge itself was the action.
 */
const NOT_VERBS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', 'my', 'our',
  'their', 'his', 'her', 'them', 'some', 'any', 'more', 'another', 'both', 'all',
  'one', 'two', 'if', 'whether', 'what', 'how', 'to', 'and', 'with', 'for'
])

/** Openers where the agent states what it is about to do. */
const INTENT =
  /\b(?:I'?ll|I will|I should|I need to|I have to|I'?m going to|I am going to|I want to|I plan to|Let me|Let'?s|Let us)\s+([^.!?\n]*)/i

/**
 * English `-ing`, well enough for the verbs an agent narrates itself with.
 *
 * Doubling covers a single vowel between an optional opening cluster and one
 * final consonant — grab, stop, run, get. It cannot fire on two vowels (read,
 * look) or two syllables (visit, offer), where the rule depends on which
 * syllable is stressed and nothing here can know that.
 */
function gerund(verb: string): string {
  const v = verb.toLowerCase()

  // Already a gerund: "I'll try using curl" hands this `using`, not `use`.
  if (v.endsWith('ing')) return v
  if (/[^aeiou]ie$/.test(v)) return `${v.slice(0, -2)}ying`
  if (/[^e]e$/.test(v)) return `${v.slice(0, -1)}ing`
  if (v.length <= 5 && /^[^aeiou]*[aeiou][bdglmnprstz]$/.test(v)) return `${v}${v.slice(-1)}ing`

  return `${v}ing`
}

/**
 * The verb the agent named, and what it named it on.
 *
 * Walks the clause rather than pattern-matching it, because the interesting
 * cases are all about what to *skip*: an adverb before the verb, a hedge in
 * front of the real one. Returns null when the walk lands somewhere that
 * cannot be a verb, so the caller falls back rather than conjugating a noun.
 */
function statedAction(clause: string): string | null {
  const words = clause.trim().split(/\s+/)
  let i = 0
  let hedged: number | null = null

  const phraseFrom = (at: number, word: string): string => {
    const phrase = `${gerund(word)} ${words.slice(at + 1).join(' ')}`.trimEnd()

    return phrase.charAt(0).toUpperCase() + phrase.slice(1)
  }

  while (i < words.length) {
    const word = words[i].toLowerCase().replace(/[^a-z']/g, '')

    if (!word || ADVERBS.has(word)) {
      i += 1
      continue
    }

    if (HEDGES.has(word) && hedged === null) {
      // Remember where the hedge was: if the walk past it dead-ends on a noun,
      // the hedge was the action after all ("try a different approach").
      hedged = i
      i += 1

      if (words[i]?.toLowerCase() === 'to' || words[i]?.toLowerCase() === 'and') i += 1

      continue
    }

    if (NOT_VERBS.has(word)) break

    return phraseFrom(i, word)
  }

  if (hedged !== null) return phraseFrom(hedged, words[hedged].toLowerCase().replace(/[^a-z']/g, ''))

  return null
}

/**
 * What the agent said it was doing, in one line.
 *
 * Reasoning is written to itself, not to you: a thought opens on restating the
 * question, works through what it knows, and only then says what it is about
 * to do. Showing its first sentence therefore showed the *question* back —
 * "The user is asking about the best party…" — under every step of the turn.
 *
 * So this looks for the sentence where the agent states an intent ("I should
 * search the web", "Let's extract the text") and renders it as the action in
 * progress: "Searching the web", "Extracting the text". That is the agent
 * telling you what it is doing, in its own words rather than a summary of
 * them — nothing on a phone can summarise, and an invented gloss that drifted
 * from the reasoning underneath it would be worse than a plain first sentence.
 *
 * A thought that never states an intent falls back to its opening sentence,
 * which is the best available answer to "what is this about".
 */
export function thinkingSynopsis(text: string): string {
  // The prefix is cut, not kept: a label like "**Analyzing the request**" is
  // the model clearing its throat, and the sentence after it carries the work.
  const body = text
    .replace(/^\s*(?:\*\*|__)[^\n*_]{0,80}(?:\*\*|__)\s*/, '')
    .replace(/^#{1,6}\s+.*\n/, '')

  const line = body
    .split('\n')
    .map(part => part.trim())
    .find(Boolean)

  if (!line) return 'Thinking'

  const intent = INTENT.exec(body)
  const action = intent ? statedAction(intent[1]) : null

  if (action) return clip(action.replace(/[\s:;,]+$/, ''))

  // Non-greedy to the first terminator, so a long thought gives up its first
  // sentence rather than its first 72 characters.
  return clip(/^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line)
}

/** Cuts on a word, not through one. */
function clip(text: string): string {
  if (text.length <= HEADLINE_MAX) return text

  const clipped = text.slice(0, HEADLINE_MAX - 1)
  const lastSpace = clipped.lastIndexOf(' ')

  return `${(lastSpace > HEADLINE_MAX / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

/** A tool the agent is inside right now, rather than one it has finished. */
function isRunning(entry: TranscriptEntry | undefined): boolean {
  return entry?.kind === 'tool' && (entry.call.status === 'running' || entry.call.status === 'pending')
}

/**
 * What the section is doing, as of its most recent entry.
 *
 * The last entry rather than a summary of all of them: collapsed, this row is
 * the only report of a turn in progress, so it has to say what is happening
 * now — and once the turn settles, the last thing done is the most useful
 * thing to have left on screen.
 *
 * `liveThinking` is the turn's in-flight thought, which is not an entry yet.
 * Thinking accumulates in the streaming tail and is only sealed into an entry
 * when the turn completes, while tool calls land as entries the moment they
 * start — so a header reading entries alone can only ever report tools while a
 * turn runs, and every thought the agent had went unmentioned until it was
 * over. A running tool still outranks it: the thought led to the call, and the
 * call is the thing currently happening.
 */
export function workHeadline(entries: readonly TranscriptEntry[], liveThinking?: string): string {
  const last = entries[entries.length - 1]

  if (!isRunning(last) && liveThinking?.trim()) return thinkingSynopsis(liveThinking)

  if (!last) return 'Working'

  if (last.kind === 'tool') {
    return last.call.summary ? `${last.call.name} · ${last.call.summary}` : last.call.name
  }

  if (last.kind === 'thinking') return thinkingSynopsis(last.text)

  return 'Working'
}

/**
 * Whether the agent is still inside this section.
 *
 * Drives the spinner in the header, so it tracks the last entry only: an
 * earlier tool left `running` by a dropped socket is `unknown`, not live
 * (§7.16), and the section it sits in has long since been overtaken.
 */
export function isWorkLive(entries: readonly TranscriptEntry[], liveThinking?: string): boolean {
  // A thought still arriving is the agent working, even with every tool in the
  // section long since settled.
  if (liveThinking?.trim()) return true

  const last = entries[entries.length - 1]

  if (!last) return false
  if (last.kind === 'tool') return last.call.status === 'pending' || last.call.status === 'running'
  if (last.kind === 'thinking') return last.streaming === true

  return false
}
