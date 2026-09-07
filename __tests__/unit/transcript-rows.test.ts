/**
 * Grouping the agent's working-out into one collapsible row per turn.
 *
 * The rules that matter are about *identity* as much as shape: a section that
 * is still being added to has to keep the same row id, or the open/closed
 * state the screen holds against that id lands on a different row and the
 * section shuts while you are reading it.
 */

import { describe, it, expect } from '@jest/globals'

import type { ToolCall, TranscriptEntry } from '@/domain'
import { modelLabel } from '@/ui/format'
import { groupTranscript, isWorkLive, thinkingSynopsis, workHeadline } from '@/ui/transcript-rows'

const message = (id: string, role: 'user' | 'assistant' = 'user'): TranscriptEntry =>
  ({ kind: 'message', id, role, text: id, at: 0 }) as TranscriptEntry

const thinking = (id: string, text = 'thought', streaming = false): TranscriptEntry =>
  ({ kind: 'thinking', id, text, at: 0, streaming }) as TranscriptEntry

const tool = (id: string, call: Partial<ToolCall> = {}): TranscriptEntry =>
  ({
    kind: 'tool',
    id,
    call: { id, name: 'shell', summary: '', status: 'ok', startedAt: 0, ...call }
  }) as TranscriptEntry

const cut = (id: string): TranscriptEntry => ({ kind: 'stream_cut', id, at: 0 }) as TranscriptEntry

describe('groupTranscript', () => {
  it('leaves a transcript with no working-out untouched', () => {
    const rows = groupTranscript([message('a'), message('b')])

    expect(rows.map(row => row.kind)).toEqual(['entry', 'entry'])
    expect(rows.map(row => row.id)).toEqual(['a', 'b'])
  })

  it('folds a run of thinking and tools into one row', () => {
    const rows = groupTranscript([message('m1'), thinking('t1'), tool('c1'), tool('c2'), message('m2')])

    expect(rows.map(row => row.kind)).toEqual(['entry', 'work', 'entry'])
    expect(rows[1].kind === 'work' && rows[1].entries.map(e => e.id)).toEqual(['t1', 'c1', 'c2'])
  })

  it('starts a second section after a message interrupts', () => {
    const rows = groupTranscript([tool('c1'), message('m1', 'assistant'), tool('c2')])

    expect(rows.map(row => row.kind)).toEqual(['work', 'entry', 'work'])
  })

  it('breaks a run at a stream cut, which is a marker and not working-out', () => {
    const rows = groupTranscript([tool('c1'), cut('x'), tool('c2')])

    expect(rows.map(row => row.kind)).toEqual(['work', 'entry', 'work'])
  })

  it('groups a lone entry too, so the transcript has one shape not two', () => {
    const rows = groupTranscript([tool('c1')])

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('work')
  })

  it('keys a section off its first entry, so appending does not change its id', () => {
    const before = groupTranscript([thinking('t1'), tool('c1')])
    const after = groupTranscript([thinking('t1'), tool('c1'), tool('c2')])

    // The whole point: the screen holds "open" against this id while the agent
    // is still working. Keyed off the last entry it would change per tool call.
    expect(after[0].id).toBe(before[0].id)
    expect(after[0].kind === 'work' && after[0].entries).toHaveLength(3)
  })

  it('never collides a section id with the entry row of the same id', () => {
    const rows = groupTranscript([tool('shared'), message('shared')])

    expect(new Set(rows.map(row => row.id)).size).toBe(2)
  })

  it('does not mutate the entries it was given', () => {
    const entries = [thinking('t1'), tool('c1')]

    groupTranscript(entries)

    expect(entries.map(e => e.id)).toEqual(['t1', 'c1'])
  })
})

describe('workHeadline', () => {
  it('names the most recent tool, not the first', () => {
    expect(workHeadline([tool('c1', { name: 'read' }), tool('c2', { name: 'write' })])).toBe('write')
  })

  it('appends the argument summary when there is one', () => {
    expect(workHeadline([tool('c1', { name: 'read', summary: 'src/app.tsx' })])).toBe('read · src/app.tsx')
  })

  it('uses the opening line of a thought', () => {
    expect(workHeadline([thinking('t1', 'Checking the config\nthen the tests')])).toBe('Checking the config')
  })

  it('skips leading blank lines rather than reporting an empty headline', () => {
    expect(workHeadline([thinking('t1', '\n\n  Reading the diff')])).toBe('Reading the diff')
  })

  it('truncates a long opening line to one phone line', () => {
    const headline = workHeadline([thinking('t1', 'x'.repeat(200))])

    expect(headline.length).toBeLessThanOrEqual(72)
    expect(headline.endsWith('…')).toBe(true)
  })

  it('still says something for a thought that has produced no text yet', () => {
    expect(workHeadline([thinking('t1', '')])).toBe('Thinking')
  })
})

describe('isWorkLive', () => {
  it('is live while the last tool is running', () => {
    expect(isWorkLive([tool('c1', { status: 'running' })])).toBe(true)
    expect(isWorkLive([tool('c1', { status: 'pending' })])).toBe(true)
  })

  it('is live while the last thought is still streaming', () => {
    expect(isWorkLive([thinking('t1', 'partial', true)])).toBe(true)
  })

  it('is settled once the last entry finished', () => {
    expect(isWorkLive([tool('c1', { status: 'ok' })])).toBe(false)
    expect(isWorkLive([thinking('t1')])).toBe(false)
  })

  it('is settled when the last tool ended unknown, whatever came before it', () => {
    // A socket dropped mid-turn leaves `unknown`, which is an outcome the app
    // must not dress up as still running (§7.16).
    expect(isWorkLive([tool('c1', { status: 'running' }), tool('c2', { status: 'unknown' })])).toBe(false)
  })
})

describe('thinkingSynopsis', () => {
  it('gives up the first sentence, not the first line', () => {
    expect(thinkingSynopsis('Checking the socket. Then the retry budget. Then the logs.')).toBe(
      'Checking the socket.'
    )
  })

  it('takes the whole opening line when it never terminates', () => {
    expect(thinkingSynopsis('Checking the socket\nthen the retry budget')).toBe('Checking the socket')
  })

  it('handles the other terminators', () => {
    expect(thinkingSynopsis('Is the socket still open? Probably not.')).toBe('Is the socket still open?')
    expect(thinkingSynopsis('Found it! The retry budget was zero.')).toBe('Found it!')
  })

  it('skips leading blank lines', () => {
    expect(thinkingSynopsis('\n\n   Reading the diff. Then the tests.')).toBe('Reading the diff.')
  })

  it('truncates a sentence too long to be a synopsis', () => {
    const synopsis = thinkingSynopsis(`${'x'.repeat(200)}.`)

    expect(synopsis.length).toBeLessThanOrEqual(72)
    expect(synopsis.endsWith('…')).toBe(true)
  })

  it('says something for a thought with no text yet', () => {
    expect(thinkingSynopsis('')).toBe('Thinking')
    expect(thinkingSynopsis('   \n  ')).toBe('Thinking')
  })

  it('does not cut on a decimal or a mid-word dot', () => {
    // `.` only terminates when whitespace or the end follows it, so a version
    // number does not become the whole synopsis.
    expect(thinkingSynopsis('Pinned to 0.81.5 for the SDK. Bump deliberately.')).toBe(
      'Pinned to 0.81.5 for the SDK.'
    )
  })
})

describe('a thought that opens with a label', () => {
  // The label is the model clearing its throat. The work is in what follows.
  it('cuts a bolded prefix and reads the thought behind it', () => {
    expect(thinkingSynopsis("**Analyzing the request** I'll search the web for parties")).toBe(
      'Searching the web for parties'
    )
  })

  it('cuts an underscore prefix too', () => {
    expect(thinkingSynopsis('__Planning__ The pool is healthy. No errors.')).toBe('The pool is healthy.')
  })

  it('cuts a markdown heading line', () => {
    expect(thinkingSynopsis('## Plan\nFirst the config, then the tests')).toBe('First the config, then the tests')
  })

  it('does not treat mid-sentence emphasis as a prefix', () => {
    expect(thinkingSynopsis('Checking whether **tank** is healthy first.')).toBe(
      'Checking whether **tank** is healthy first.'
    )
  })
})

describe('thinkingSynopsis reads the agent\'s stated intent', () => {
  // Reasoning opens by restating the question and only later says what it is
  // about to do, so the first sentence showed the question back under every
  // step. These are the shapes that actually appear in a transcript.
  it('renders an intent as the action in progress', () => {
    expect(thinkingSynopsis('I should search the web for information about Dragon Con parties')).toBe(
      'Searching the web for information about Dragon Con parties'
    )
    expect(thinkingSynopsis("Both pages are fetched. Let's extract the text.")).toBe('Extracting the text')
  })

  it('does not double an -ing that is already there', () => {
    // "Usinging browser tools" — the hedge handed it a gerund, not a stem.
    expect(thinkingSynopsis("I'll try using browser tools")).toBe('Using browser tools')
  })

  it('keeps the hedge when what follows it is not a verb', () => {
    // "Aing different approach" — the walk past `try` landed on an article.
    expect(thinkingSynopsis("I'll try a different approach")).toBe('Trying a different approach')
  })

  it('skips an adverb on the way to the verb', () => {
    // "Justing parse it" / "Alsoing check the edition".
    expect(thinkingSynopsis("Let's just parse it as-is")).toBe('Parsing it as-is')
    expect(thinkingSynopsis("I'll also check the Saturday edition")).toBe('Checking the Saturday edition')
  })

  it('doubles a final consonant only where the rule is unambiguous', () => {
    expect(thinkingSynopsis("I'll grab that PDF")).toBe('Grabbing that PDF')
    expect(thinkingSynopsis("I'll run the tests")).toBe('Running the tests')
    // Two vowels and two syllables both block it: "reading", not "readding".
    expect(thinkingSynopsis("I'll read the diff")).toBe('Reading the diff')
    expect(thinkingSynopsis("I'll visit the page")).toBe('Visiting the page')
  })

  it('drops a silent e rather than keeping it', () => {
    expect(thinkingSynopsis("I'll use curl instead")).toBe('Using curl instead')
    expect(thinkingSynopsis("I'll navigate to the event page")).toBe('Navigating to the event page')
  })

  it('falls back to the opening sentence when no intent is stated', () => {
    expect(thinkingSynopsis('The web extraction failed due to anti-bot measures. Hmm.')).toBe(
      'The web extraction failed due to anti-bot measures.'
    )
  })

  it('trims trailing punctuation off an action', () => {
    expect(thinkingSynopsis("Let's organize it:")).toBe('Organizing it')
  })
})

describe('the in-flight thought', () => {
  // Thinking accumulates in the streaming tail and is only sealed into an entry
  // when the turn completes, while tool calls land as entries the moment they
  // start. A header reading entries alone reported tools and nothing else for
  // the whole of a live turn.
  it('is the headline when no tool is running', () => {
    expect(workHeadline([tool('c1', { status: 'ok' })], 'Checking the retry budget. Then the logs.')).toBe(
      'Checking the retry budget.'
    )
  })

  it('is the headline for a section that has no entries yet', () => {
    expect(workHeadline([], 'Reading the diff')).toBe('Reading the diff')
  })

  it('yields to a tool that is actually running', () => {
    // The thought led to the call; the call is what is happening now.
    expect(workHeadline([tool('c1', { name: 'shell', status: 'running' })], 'Some earlier thought')).toBe('shell')
    expect(workHeadline([tool('c1', { name: 'shell', status: 'pending' })], 'Some earlier thought')).toBe('shell')
  })

  it('is ignored when it is only whitespace', () => {
    expect(workHeadline([tool('c1', { name: 'read', status: 'ok' })], '   \n ')).toBe('read')
  })

  it('makes the section live even with every tool settled', () => {
    expect(isWorkLive([tool('c1', { status: 'ok' })])).toBe(false)
    expect(isWorkLive([tool('c1', { status: 'ok' })], 'still thinking')).toBe(true)
  })

  it('leaves a settled section alone when absent', () => {
    expect(workHeadline([tool('c1', { name: 'read', status: 'ok' })])).toBe('read')
    expect(workHeadline([tool('c1', { name: 'read', status: 'ok' })], '')).toBe('read')
  })
})

describe('modelLabel', () => {
  it('keeps only the last segment of a routed id', () => {
    expect(modelLabel('openrouter/qwen/qwen3.8-27b')).toBe('qwen3.8-27b')
    expect(modelLabel('anthropic/claude-opus-5')).toBe('claude-opus-5')
  })

  it('leaves a bare model name alone', () => {
    expect(modelLabel('sonnet-4.5')).toBe('sonnet-4.5')
  })

  it('survives the shapes that would otherwise return nothing', () => {
    expect(modelLabel('trailing/')).toBe('trailing')
    expect(modelLabel('/leading')).toBe('leading')
    expect(modelLabel('/')).toBe('/')
    expect(modelLabel('')).toBe('')
  })
})
