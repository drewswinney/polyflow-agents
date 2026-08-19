/**
 * Markdown parsing for agent output.
 *
 * `markdown-it` does the parsing; rendering is ours (see `Markdown.tsx`), so the
 * output lands in the Polyflow type scale rather than a library's defaults.
 *
 * Two settings are deliberate:
 *
 * - **`html: false`.** Model output is untrusted text. Raw HTML would be a
 *   passthrough for markup the app never intends to render.
 * - **`breaks: true`.** Strict Markdown collapses a single newline into a
 *   space. Agents write chat prose where a line break means a line break, and
 *   collapsing them turns deliberate short lines into a wall of text.
 */

// markdown-it v15 ships its own types; @types/markdown-it describes an older
// shape and conflicts with them, so it is deliberately not installed.
import MarkdownIt, { type Token } from 'markdown-it'

const parser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
})

export type MarkdownToken = Token

export function parseMarkdown(source: string): MarkdownToken[] {
  return parser.parse(source, {})
}

/**
 * Whether a string is worth handing to the renderer at all.
 *
 * Most agent replies are plain prose. Parsing those into a token tree and back
 * into nested `<Text>` nodes costs more than it returns, so the caller can skip
 * straight to a plain paragraph.
 */
export function looksLikeMarkdown(source: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)|\*\*|__|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~/.test(source)
}
