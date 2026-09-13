/**
 * Where an artifact's card lands in the transcript.
 *
 * The rule under test is placement by time: a file the agent wrote belongs
 * under the work that wrote it and above the reply that mentions it, and a
 * card that drifted to the end of the conversation would read as something
 * from a later turn.
 */

import { describe, expect, it } from '@jest/globals'

import type { Artifact, TranscriptEntry } from '@/domain'
import { groupTranscript, withArtifactRows } from '@/ui/transcript-rows'

const T0 = 1_000_000

const message = (id: string, at: number, role: 'user' | 'agent' = 'user'): TranscriptEntry => ({
  kind: 'message',
  id,
  role,
  text: id,
  at
})

const tool = (id: string, startedAt: number, durationMs: number, name = 'write_file'): TranscriptEntry => ({
  kind: 'tool',
  id,
  call: { id, name, summary: '', status: 'ok', startedAt, durationMs }
})

function artifact(id: string, createdAt: number, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id,
    name: `${id}.md`,
    title: id,
    titleCustom: false,
    kind: 'document',
    mimeType: 'text/markdown',
    size: 10,
    sessionId: 's1',
    origin: 'agent',
    tool: 'write_file',
    sourcePath: null,
    createdAt,
    updatedAt: createdAt,
    version: 1,
    share: null,
    ...overrides
  }
}

const conversation = groupTranscript([
  message('ask', T0),
  tool('write', T0 + 1_000, 500),
  message('reply', T0 + 5_000, 'agent'),
  message('ask-again', T0 + 60_000),
  tool('write-again', T0 + 61_000, 500),
  message('reply-again', T0 + 65_000, 'agent')
])

describe('withArtifactRows', () => {
  it('leaves the transcript alone when nothing was produced', () => {
    expect(withArtifactRows(conversation, [])).toEqual(conversation)
    expect(withArtifactRows(conversation, [artifact('sent', T0 + 2_000, { origin: 'upload', tool: null })])).toEqual(conversation)
  })

  it('puts a card under the work that made it and above the reply', () => {
    const rows = withArtifactRows(conversation, [artifact('report', T0 + 1_800)])

    expect(rows.map(row => row.kind)).toEqual(['entry', 'work', 'artifacts', 'entry', 'entry', 'work', 'entry'])
  })

  it('files each turn’s output with that turn', () => {
    const rows = withArtifactRows(conversation, [artifact('first', T0 + 1_800), artifact('second', T0 + 61_800)])

    expect(rows.map(row => (row.kind === 'artifacts' ? row.artifacts[0].id : row.kind))).toEqual([
      'entry', 'work', 'first', 'entry', 'entry', 'work', 'second', 'entry'
    ])
  })

  it('shares one card between files made in the same gap, keyed by the first', () => {
    const rows = withArtifactRows(conversation, [artifact('b', T0 + 1_900), artifact('a', T0 + 1_700)])
    const card = rows.find(row => row.kind === 'artifacts')

    expect(card).toMatchObject({ id: 'artifacts:a' })
    expect(card && card.kind === 'artifacts' ? card.artifacts.map(row => row.id) : []).toEqual(['a', 'b'])
  })

  it('keeps a card’s id when a later file joins the conversation', () => {
    const before = withArtifactRows(conversation, [artifact('a', T0 + 1_700)])
    const after = withArtifactRows(conversation, [artifact('a', T0 + 1_700), artifact('later', T0 + 61_800)])

    expect(after.find(row => row.kind === 'artifacts')?.id).toBe(before.find(row => row.kind === 'artifacts')?.id)
  })

  it('places by when the file was first made, not last rewritten', () => {
    const rewritten = artifact('report', T0 + 1_800, { updatedAt: T0 + 61_800, version: 2 })
    const rows = withArtifactRows(conversation, [rewritten])

    expect(rows.findIndex(row => row.kind === 'artifacts')).toBe(2)
  })

  it('appends what arrived after everything on screen', () => {
    const rows = withArtifactRows(conversation, [artifact('late', T0 + 999_999)])

    expect(rows[rows.length - 1].kind).toBe('artifacts')
  })
})
