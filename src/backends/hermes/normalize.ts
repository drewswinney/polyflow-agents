/**
 * Hermes REST shapes → domain models.
 *
 * Everything `snake_case` stops here (§4.2). Timestamps: Hermes reports seconds
 * (float) on session rows and message rows; the domain uses milliseconds.
 */

import type { SessionInfo, SessionMessage, SessionSearchResult } from '@hermes/types'

import type { SessionSearchHit } from '@/domain'
import type { SessionSummary, ToolCall, TranscriptEntry } from '@/domain'

import { coerceText } from './event-map'

/** Hermes epoch seconds → epoch milliseconds. Tolerates a value already in ms. */
export function toMillis(seconds: number | null | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 0

  // Anything past year 2286 in seconds is really milliseconds already.
  return seconds > 1e11 ? seconds : Math.round(seconds * 1000)
}

const UNTITLED = 'Untitled session'

/**
 * A stored title that carries no information.
 *
 * Hermes titles sessions with a model, and that occasionally returns a bare
 * number — real rows on a live host read `-1.0000000000000002e+308`, and one is
 * that followed by eighty more digits. They are not empty, so an empty-string
 * check lets them through to the sessions list, where they are worse than no
 * title at all: they push the row's only identifying text off the screen.
 *
 * Matching "numeric junk" rather than "has no letters" is deliberate — the
 * latter would reject a perfectly good title written in a script this pattern
 * knows nothing about.
 */
function isNumericJunk(title: string): boolean {
  return /^[\s\d.eE+-]+$/.test(title)
}

/**
 * Title, then preview, then a placeholder — the same fallback chain Hermes's own
 * ACP adapter uses (`_build_session_title`), so a session reads the same here as
 * it does anywhere else that lists it.
 */
export function usableTitle(rawTitle: string | null | undefined, preview: string): string {
  const title = (rawTitle ?? '').trim()

  if (title && !isNumericJunk(title)) return title

  const firstLine = preview.split('\n', 1)[0].trim()

  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine

  return UNTITLED
}

export function toSessionSummary(info: SessionInfo): SessionSummary {
  const preview = (info.preview ?? '').trim()

  return {
    id: info.id,
    title: usableTitle(info.title, preview),
    preview,
    updatedAt: toMillis(info.last_active),
    pinned: info.pinned === true,
    unread: info.unread === true,
    model: info.model,
    messageCount: info.message_count,
    // Hermes has no per-session "blocked" flag on the list endpoint; the live
    // stream is what tells us a session is waiting (§7.1). Callers overlay it.
    blockedOn: null
  }
}

export function toSearchHit(result: SessionSearchResult, query: string): SessionSearchHit {
  const snippet = result.snippet ?? ''
  const matchStart = snippet.toLowerCase().indexOf(query.toLowerCase())

  return {
    sessionId: result.session_id,
    title: UNTITLED,
    updatedAt: toMillis(result.session_started),
    snippet,
    matchStart: matchStart < 0 ? 0 : matchStart,
    matchEnd: matchStart < 0 ? 0 : matchStart + query.length
  }
}

interface ToolCallShape {
  id?: string
  function?: { name?: string; arguments?: string }
  name?: string
}

/**
 * Fold a stored transcript into render-ready entries.
 *
 * Hermes stores tool activity as `role: 'tool'` rows plus `tool_calls` on the
 * assistant row that requested them. A stored transcript is always settled, so
 * every tool call read back from REST is `ok` or `error` — never `unknown`;
 * `unknown` is reserved for calls cut off by a live disconnect (§7.16).
 */
export function toTranscriptEntries(messages: SessionMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const pendingToolNames = new Map<string, string>()

  messages.forEach((message, index) => {
    const at = toMillis(message.timestamp)
    const id = String(message.row_id ?? message.id ?? `m${index}`)

    if (message.role === 'tool') {
      const callId = message.tool_call_id ?? id
      const output = coerceText(message.content) || coerceText(message.text)

      const call: ToolCall = {
        id: callId,
        name: message.tool_name ?? message.name ?? pendingToolNames.get(callId) ?? 'tool',
        summary: typeof message.context === 'string' ? message.context : '',
        status: /^\s*(error|traceback)/i.test(output) ? 'error' : 'ok',
        output: output || undefined,
        startedAt: at
      }

      entries.push({ kind: 'tool', id: `tool:${callId}:${index}`, call })

      return
    }

    if (message.role === 'system' || message.display_kind === 'hidden') {
      return
    }

    // Remember requested tool names so the matching `role: 'tool'` row can be
    // labelled even when it only carries an id.
    if (Array.isArray(message.tool_calls)) {
      for (const raw of message.tool_calls as ToolCallShape[]) {
        const callId = raw?.id

        if (callId) pendingToolNames.set(callId, raw.function?.name ?? raw.name ?? 'tool')
      }
    }

    const reasoning = message.reasoning ?? message.reasoning_content

    if (message.role === 'assistant' && reasoning) {
      entries.push({ kind: 'thinking', id: `think:${id}`, text: String(reasoning), at })
    }

    const text = coerceText(message.content) || coerceText(message.text)

    if (!text) return

    entries.push({
      kind: 'message',
      id,
      role: message.role === 'user' ? 'user' : 'agent',
      text,
      at
    })
  })

  return entries
}
