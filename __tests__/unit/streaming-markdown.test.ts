/**
 * The streaming tail now renders live markdown, so the parser has to survive
 * every *prefix* of a message, not just the finished one. These tests pin the
 * partial-input behaviors the feature relies on:
 *
 * - a half-arrived fence is a fence that grows, never an error
 * - an unbalanced `**`, backtick, or bracket stays literal and never throws
 * - `looksLikeMarkdown` flips the moment markdown syntax starts arriving, so
 *   the parser is engaged mid-stream rather than all at once at the end
 *
 * If a future markdown-it upgrade changes any of these, the streaming tail
 * will misrender before it crashes — that is the point of pinning them.
 */

import { describe, it, expect } from '@jest/globals'

import { looksLikeMarkdown, parseMarkdown } from '@/ui/markdown/parse'

describe('parseMarkdown with partial input', () => {
  it('reads an unclosed fence as a fence whose content grows', () => {
    const open = parseMarkdown('```py\nprint(1')
    expect(open).toHaveLength(1)
    expect(open[0].type).toBe('fence')
    expect(open[0].info).toBe('py')

    // The same fence with more of it arrived.
    const grown = parseMarkdown('```py\nprint(1)\nprint(2')
    expect(grown).toHaveLength(1)
    expect(grown[0].type).toBe('fence')
    expect(grown[0].content).toContain('print(2')
  })

  it('keeps an unclosed bold marker as literal text rather than dropping it', () => {
    const tokens = parseMarkdown('**bold text')

    // No strong_* tokens — the emphasis never closed, so nothing is bolded.
    const types = tokens.flatMap(t => t.children?.map(c => c.type) ?? [])
    expect(types).not.toContain('strong_open')

    // And the literal `**` survives, so the user sees the marker, not a
    // silently eaten message.
    const inline = tokens.find(t => t.type === 'inline')
    expect(inline?.children?.some(c => c.type === 'text' && c.content.includes('**'))).toBe(true)
  })

  it('keeps an unclosed inline code backtick as literal text', () => {
    const tokens = parseMarkdown('run `npm i')
    const types = tokens.flatMap(t => t.children?.map(c => c.type) ?? [])
    expect(types).not.toContain('code_inline')
  })

  it('reads a half-written link as a link whose href grows', () => {
    // markdown-it is lenient here: the link token appears while its
    // destination is still arriving, with the href extending flush by
    // flush. No crash, no dropped text — the URL settles once `)` lands.
    const open = parseMarkdown('[the docs](https://example.com')
    const openLink = open.flatMap(t => t.children ?? []).find(c => c.type === 'link_open')
    expect(openLink).toBeDefined()
    if (!openLink) return
    expect(String(openLink.attrGet('href'))).toBe('https://example.com')

    const closed = parseMarkdown('[the docs](https://example.com)')
    const closedLink = closed.flatMap(t => t.children ?? []).find(c => c.type === 'link_open')
    expect(closedLink).toBeDefined()
    if (!closedLink) return
    expect(String(closedLink.attrGet('href'))).toBe('https://example.com')

    // And the closing paren settles the label: before it, the `[` is part of
    // the text; after it, the label is its own token.
    const closedText = closed
      .flatMap(t => t.children ?? [])
      .filter(c => c.type === 'text')
      .map(c => c.content)
      .join('')
    expect(closedText).toBe('the docs')
  })

  it('parses a heading the moment its newline arrives', () => {
    const tokens = parseMarkdown('# Setup')
    expect(tokens[0].type).toBe('heading_open')
    expect(tokens[0].tag).toBe('h1')
  })

  it('parses an open bullet as a list, and its items as they arrive', () => {
    const one = parseMarkdown('- first')
    expect(one.some(t => t.type === 'bullet_list_open')).toBe(true)
    expect(one.some(t => t.type === 'list_item_open')).toBe(true)

    const two = parseMarkdown('- first\n- seco')
    expect(two.filter(t => t.type === 'list_item_open')).toHaveLength(2)
  })

  it('parses every prefix of a markdown-heavy message without throwing', () => {
    const message = [
      '## Release notes',
      '',
      'Shipped **live markdown** in the tail, with `inline code` and a [link](https://example.com).',
      '',
      '```ts',
      'export const x = 1;',
      'export const y = x + 2;',
      '```',
      '',
      '1. first step',
      '2. second step',
      '',
      '> quoted line',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Done — and a final **bold** word with trailing spaces'
    ].join('\n')

    for (let i = 1; i <= message.length; i += 1) {
      expect(() => parseMarkdown(message.slice(0, i))).not.toThrow()
    }
  })
})

describe('looksLikeMarkdown mid-stream', () => {
  it('is false for plain prose, true the moment syntax arrives', () => {
    expect(looksLikeMarkdown('Hello there')).toBe(false)
    expect(looksLikeMarkdown('Hello there, ')).toBe(false)
    expect(looksLikeMarkdown('Hello **there')).toBe(true)
    // A fence counts only at the start of a line — matching markdown-it,
    // which reads a mid-line ``` as literal text.
    expect(looksLikeMarkdown('Here is ```py')).toBe(false)
    expect(looksLikeMarkdown('Here is code:\n```py')).toBe(true)
    // Bullets, like fences, count only at the start of a line — matching
    // markdown-it, where a mid-line "- " is a dash, not a list item.
    expect(looksLikeMarkdown('First, - note')).toBe(false)
    expect(looksLikeMarkdown('First,\n- note')).toBe(true)
    expect(looksLikeMarkdown('see `npm i`')).toBe(true)
  })
})
