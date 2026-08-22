import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { Linking, ScrollView, StyleSheet, Text as RNText, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import type { Theme } from '../theme'

import { looksLikeMarkdown, type MarkdownToken, parseMarkdown } from './parse'

/**
 * Renders agent markdown in the Polyflow type scale.
 *
 * Parsing is `markdown-it`; the rendering is ours, so headings land in Outfit,
 * prose in Inter, and anything machine-generated — inline code, fenced blocks,
 * tables — in Space Mono, per the design's three-way split. A general-purpose
 * markdown component would have to be fought back into that scale rule by rule.
 *
 * Streaming text deliberately does not come through here (§7.3): the tail
 * renders as plain text and is re-rendered as markdown once the turn settles,
 * so a half-written fence or table never has to parse.
 */
export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const theme = useTheme()
  const blocks = useMemo(() => {
    if (!looksLikeMarkdown(source)) return null

    return renderBlocks(parseMarkdown(source), theme)
  }, [source, theme])

  // Plain prose skips the parser entirely — most replies are exactly that.
  if (!blocks) {
    return (
      <RNText 
        style={[styles.paragraph, { fontFamily: theme.font.body, color: theme.color.gray800 }]}
        selectable
      >
        {source}
      </RNText>
    )
  }

  return (
    <RNText selectable>
      <View style={styles.root}>{blocks}</View>
    </RNText>
  )
})

/** Walks the flat token stream, consuming nested ranges as it goes. */
function renderBlocks(tokens: MarkdownToken[], theme: Theme): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < tokens.length) {
    const token = tokens[i]

    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.slice(1)) || 1
        const inline = tokens[i + 1]
        out.push(
          <RNText
            key={key++}
            style={[
              styles.heading,
              {
                fontFamily: theme.font.display,
                color: theme.color.gray900,
                fontSize: headingSize(level),
                lineHeight: headingSize(level) * 1.3
              }
            ]}
          >
            {renderInline(inline?.children ?? [], theme)}
          </RNText>
        )
        i = skipTo(tokens, i, 'heading_close')
        break
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1]
        out.push(
          <RNText
            key={key++}
            style={[styles.paragraph, { fontFamily: theme.font.body, color: theme.color.gray800 }]}
          >
            {renderInline(inline?.children ?? [], theme)}
          </RNText>
        )
        i = skipTo(tokens, i, 'paragraph_close')
        break
      }

      case 'fence':
      case 'code_block': {
        out.push(<CodeBlock key={key++} code={token.content.replace(/\n$/, '')} language={token.info?.trim()} />)
        i += 1
        break
      }

      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = token.type === 'ordered_list_open'
        const end = matchingClose(tokens, i, ordered ? 'ordered_list_close' : 'bullet_list_close')
        out.push(
          <View key={key++} style={styles.list}>
            {renderListItems(tokens.slice(i + 1, end), theme, ordered, Number(token.attrGet('start') ?? 1) || 1)}
          </View>
        )
        i = end + 1
        break
      }

      case 'blockquote_open': {
        const end = matchingClose(tokens, i, 'blockquote_close')
        out.push(
          <View key={key++} style={[styles.quote, { borderLeftColor: theme.color.secondaryMuted }]}>
            {renderBlocks(tokens.slice(i + 1, end), theme)}
          </View>
        )
        i = end + 1
        break
      }

      case 'hr': {
        out.push(<View key={key++} style={[styles.rule, { backgroundColor: theme.color.border }]} />)
        i += 1
        break
      }

      case 'table_open': {
        const end = matchingClose(tokens, i, 'table_close')
        out.push(<MarkdownTable key={key++} tokens={tokens.slice(i + 1, end)} />)
        i = end + 1
        break
      }

      default:
        i += 1
    }
  }

  return out
}

function renderListItems(tokens: MarkdownToken[], theme: Theme, ordered: boolean, start: number): ReactNode[] {
  const items: ReactNode[] = []
  let i = 0
  let index = start

  while (i < tokens.length) {
    if (tokens[i].type !== 'list_item_open') {
      i += 1
      continue
    }

    const end = matchingClose(tokens, i, 'list_item_close')

    items.push(
      <View key={items.length} style={styles.listItem}>
        <RNText
          style={[
            styles.marker,
            { fontFamily: ordered ? theme.font.mono : theme.font.body, color: theme.color.gray500 }
          ]}
        >
          {ordered ? `${index++}.` : '•'}
        </RNText>
        <View style={styles.listBody}>{renderBlocks(tokens.slice(i + 1, end), theme)}</View>
      </View>
    )

    i = end + 1
  }

  return items
}

function renderInline(tokens: MarkdownToken[], theme: Theme, depth = 0): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0

  // Nested `<Text>` inherits style, so emphasis composes by nesting rather than
  // by tracking a style stack.
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]

    switch (token.type) {
      case 'text':
        out.push(<Fragment key={key++}>{token.content}</Fragment>)
        break

      case 'softbreak':
      case 'hardbreak':
        out.push(<Fragment key={key++}>{'\n'}</Fragment>)
        break

      case 'code_inline':
        out.push(
          <RNText
            key={key++}
            style={[styles.codeInline, { fontFamily: theme.font.mono, color: theme.color.secondaryDeep }]}
          >
            {` ${token.content} `}
          </RNText>
        )
        break

      case 'strong_open': {
        const end = closeIndex(tokens, i, 'strong_close')
        out.push(
          <RNText key={key++} style={{ fontFamily: theme.font.bodySemibold }}>
            {renderInline(tokens.slice(i + 1, end), theme, depth + 1)}
          </RNText>
        )
        i = end
        break
      }

      case 'em_open': {
        const end = closeIndex(tokens, i, 'em_close')
        out.push(
          <RNText key={key++} style={styles.emphasis}>
            {renderInline(tokens.slice(i + 1, end), theme, depth + 1)}
          </RNText>
        )
        i = end
        break
      }

      case 's_open': {
        const end = closeIndex(tokens, i, 's_close')
        out.push(
          <RNText key={key++} style={styles.strike}>
            {renderInline(tokens.slice(i + 1, end), theme, depth + 1)}
          </RNText>
        )
        i = end
        break
      }

      case 'link_open': {
        const href = String(token.attrGet('href') ?? '')
        const end = closeIndex(tokens, i, 'link_close')
        out.push(
          <RNText
            key={key++}
            style={{ color: theme.color.primary }}
            onPress={() => {
              // Never assume a model-supplied URL is openable.
              void Linking.openURL(href).catch(() => undefined)
            }}
          >
            {renderInline(tokens.slice(i + 1, end), theme, depth + 1)}
          </RNText>
        )
        i = end
        break
      }

      default:
        if (token.content) out.push(<Fragment key={key++}>{token.content}</Fragment>)
    }
  }

  return out
}

/** Code keeps its own line breaks, so it scrolls sideways rather than wrapping. */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const theme = useTheme()

  return (
    <View style={[styles.codeBlock, { backgroundColor: theme.color.bgSubtle, borderRadius: theme.radius.control }]}>
      {language ? (
        <RNText style={[styles.codeLang, { fontFamily: theme.font.mono, color: theme.color.gray400 }]}>
          {language}
        </RNText>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <RNText style={[styles.codeText, { fontFamily: theme.font.mono, color: theme.color.gray800 }]}>{code}</RNText>
      </ScrollView>
    </View>
  )
}

function MarkdownTable({ tokens }: { tokens: MarkdownToken[] }) {
  const theme = useTheme()
  const rows: Array<{ header: boolean; cells: MarkdownToken[][] }> = []
  let current: { header: boolean; cells: MarkdownToken[][] } | null = null
  let header = false

  for (const token of tokens) {
    if (token.type === 'thead_open') header = true
    else if (token.type === 'thead_close') header = false
    else if (token.type === 'tr_open') current = { header, cells: [] }
    else if (token.type === 'tr_close' && current) {
      rows.push(current)
      current = null
    } else if ((token.type === 'th_open' || token.type === 'td_open') && current) current.cells.push([])
    else if (token.type === 'inline' && current?.cells.length) {
      current.cells[current.cells.length - 1] = token.children ?? []
    }
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.table}>
      <View style={{ borderColor: theme.color.border, borderRadius: theme.radius.control, borderWidth: 1 }}>
        {rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[
              styles.tableRow,
              {
                backgroundColor: row.header ? theme.color.bgSubtle : theme.color.surface,
                borderBottomColor: theme.color.divider,
                borderBottomWidth: rowIndex === rows.length - 1 ? 0 : StyleSheet.hairlineWidth
              }
            ]}
          >
            {row.cells.map((cell, cellIndex) => (
              <RNText
                key={cellIndex}
                style={[
                  styles.tableCell,
                  {
                    fontFamily: row.header ? theme.font.bodySemibold : theme.font.mono,
                    color: row.header ? theme.color.gray900 : theme.color.gray800
                  }
                ]}
              >
                {renderInline(cell, theme)}
              </RNText>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function headingSize(level: number): number {
  return [21, 19, 17, 16, 15, 15][Math.min(level, 6) - 1]
}

/** Index just past a closing token of the same nesting level. */
function skipTo(tokens: MarkdownToken[], from: number, type: string): number {
  for (let i = from + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === type) return i + 1
  }

  return tokens.length
}

/** Index of the close that matches the opener at `from`, honouring nesting. */
function matchingClose(tokens: MarkdownToken[], from: number, closeType: string): number {
  const openType = tokens[from].type
  let depth = 0

  for (let i = from + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === openType) depth += 1
    else if (tokens[i].type === closeType) {
      if (depth === 0) return i
      depth -= 1
    }
  }

  return tokens.length
}

function closeIndex(tokens: MarkdownToken[], from: number, closeType: string): number {
  const openType = tokens[from].type
  let depth = 0

  for (let i = from + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === openType) depth += 1
    else if (tokens[i].type === closeType) {
      if (depth === 0) return i
      depth -= 1
    }
  }

  return tokens.length - 1
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  paragraph: { fontSize: 15, lineHeight: 24.75 },
  heading: { marginTop: 2 },
  codeInline: { fontSize: 13 },
  codeBlock: { padding: 12, gap: 6 },
  codeLang: { fontSize: 10 },
  codeText: { fontSize: 11.5, lineHeight: 19.5 },
  list: { gap: 6 },
  listItem: { flexDirection: 'row', gap: 8 },
  marker: { fontSize: 15, lineHeight: 24.75, minWidth: 16 },
  listBody: { flex: 1, minWidth: 0, gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 8 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  table: { maxWidth: '100%' },
  tableRow: { flexDirection: 'row' },
  tableCell: { fontSize: 12, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 8, minWidth: 90 }
})
