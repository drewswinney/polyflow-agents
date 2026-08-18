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

export function toSessionSummary(info: SessionInfo): SessionSummary {
  return {
    id: info.id,
    title: (info.title ?? '').trim() || UNTITLED,
    preview: (info.preview ?? '').trim(),
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
