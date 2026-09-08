/**
 * What counts as a mention of a kanban card.
 *
 * The transcript turns `[[wiki-link]]`s into cards, so this pattern decides
 * when a sentence sprouts a chip and a card unfurls under the message. It is
 * pinned here because both failure directions are bad and neither is loud: too
 * narrow and the feature silently does nothing on the syntax the vault
 * actually writes, too wide and ordinary prose grows chips.
 */

import { describe, it, expect } from '@jest/globals'

import { collectMentions, hasMention, splitMentions } from '@/ui/markdown/mentions'

describe('splitMentions', () => {
  it('leaves mention-free prose as a single run', () => {
    expect(splitMentions('Moved the branch and opened a draft PR.')).toEqual([
      { kind: 'text', text: 'Moved the branch and opened a draft PR.' }
    ])
  })

  it('splits a mention out of the sentence around it', () => {
    expect(splitMentions('I moved [[fix-lint-gate]] to Testing.')).toEqual([
      { kind: 'text', text: 'I moved ' },
      { kind: 'mention', mention: { slug: 'fix-lint-gate', label: null } },
      { kind: 'text', text: ' to Testing.' }
    ])
  })

  it('keeps the label the author wrote after the pipe', () => {
    expect(splitMentions('[[fix-lint-gate|the lint gate]] is green')).toEqual([
      { kind: 'mention', mention: { slug: 'fix-lint-gate', label: 'the lint gate' } },
      { kind: 'text', text: ' is green' }
    ])
  })

  it('takes a bare ticket id as a mention of itself', () => {
    expect(splitMentions('Filed as t_4584630a, see the board.')).toEqual([
      { kind: 'text', text: 'Filed as ' },
      { kind: 'mention', mention: { slug: 't_4584630a', label: 't_4584630a' } },
      { kind: 'text', text: ', see the board.' }
    ])
  })

  it('does not read an id out of a longer identifier', () => {
    expect(splitMentions('set_t_deadbeef and t_deadbeef_v2 and t_xyz are not tickets')).toEqual([
      { kind: 'text', text: 'set_t_deadbeef and t_deadbeef_v2 and t_xyz are not tickets' }
    ])
  })

  it('does not span a line break', () => {
    // An unclosed `[[` must not swallow the rest of the message.
    const segments = splitMentions('opened [[fix-lint\ngate]] today')

    expect(segments).toEqual([{ kind: 'text', text: 'opened [[fix-lint\ngate]] today' }])
  })
})

describe('collectMentions', () => {
  it('returns nothing for prose', () => {
    expect(collectMentions('No tickets named here.')).toEqual([])
  })

  it('deduplicates by slug, in first-mention order', () => {
    const text = 'Started [[b-ticket]], then [[a-ticket]], then back to [[b-ticket]].'

    expect(collectMentions(text).map(mention => mention.slug)).toEqual(['b-ticket', 'a-ticket'])
  })

  it('treats a wiki-link and a bare id for the same ticket as one mention', () => {
    expect(collectMentions('[[t_4584630a]] is t_4584630a').map(mention => mention.slug)).toEqual(['t_4584630a'])
  })
})

describe('hasMention', () => {
  it('is false for text with no wiki-link at all', () => {
    expect(hasMention('nothing to see')).toBe(false)
  })

  it('is true as soon as one could be there', () => {
    expect(hasMention('see [[a-ticket]]')).toBe(true)
    expect(hasMention('see t_4584630a')).toBe(true)
  })
})
