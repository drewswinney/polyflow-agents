/**
 * The only file in the app that knows Hermes's event names (§4).
 *
 * Everything above the Domain layer sees `SessionUpdate`, never `message.delta`
 * or `tool.complete`. Payload field names were read from the Hermes desktop
 * client and its gateway-event handler, not guessed:
 *
 * - `message.delta` / `message.interim` → `payload.text`
 * - `thinking.delta` / `reasoning.delta` → `payload.text`
 * - `tool.*`   → `payload.{tool_id, name, context, args, result, error}`
 * - `approval.request` → `payload.{command, description, request_id,
 *                        allow_permanent, choices, smart_denied}`
 * - `session.usage` → `payload.usage.{input, output, total, calls}`
 */

import type { GatewayEvent } from '@hermes/shared'

import type { AgentError, EventRecord, PermissionRequest, SessionUpdate, ToolCall, ToolStatus } from '@/domain'

type Payload = Record<string, unknown> | undefined

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Hermes ships assistant text as a string, but a provider can hand back the
 * content-block array shape; the desktop client coerces both.
 */
export function coerceText(value: unknown): string {
  if (typeof value === 'string') return value

  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) return str((part as { text: unknown }).text)

        return ''
      })
      .join('')
  }

  return ''
}

function toolIdOf(payload: Payload): string {
  return (
    str(payload?.tool_id) ||
    str(payload?.tool_call_id) ||
    str(payload?.id) ||
    str(payload?.name) ||
    'tool'
  )
}

function toolSummary(payload: Payload): string {
  // `context` is the backend's own 80-char display preview (see
  // tui_gateway/server.py::_on_tool_start); fall back to serialised args.
  const context = str(payload?.context)

  if (context) return context

  const args = payload?.args

  if (typeof args === 'string') return args.slice(0, 80)
  if (args && typeof args === 'object') return JSON.stringify(args).slice(0, 80)

  return ''
}

function toolOutput(payload: Payload): string | undefined {
  const error = payload?.error
  const result = payload?.result

  const pick = error ?? result

  if (pick === undefined || pick === null) return undefined
  if (typeof pick === 'string') return pick

  return JSON.stringify(pick, null, 2)
}

function completedStatus(payload: Payload): ToolStatus {
  return payload?.error ? 'error' : 'ok'
}

/** Events that carry no chat meaning but belong in Logs & events (§7.15). */
const LOG_ONLY: ReadonlySet<string> = new Set([
  'gateway.ready',
  'session.info',
  'status.update',
  'skin.changed',
  'message.start',
  'reasoning.available',
  'tool.generating',
  'background.complete'
])

export interface MapContext {
  /** Wall-clock for the update, milliseconds. Injected so tests are stable. */
  now: number
  /** Tracks tool start times so `tool.complete` can report a duration. */
  toolStartedAt: Map<string, number>
  /**
   * The host's `approvals.timeout`, in milliseconds, or null when it could not
   * be read. Approvals fail **closed** when it elapses, so this is a real
   * deadline rather than a hint — but it is host config, not a field on the
   * event, which is why it is injected here and why null means "show no
   * countdown" rather than "assume the default".
   */
  approvalTimeoutMs: number | null
}

/**
 * Map one gateway event onto zero or more normalised updates.
 *
 * Returns an array because a single Hermes event can mean two things to the UI
 * — `tool.complete` both settles the card and belongs in the event log.
 */
export function mapGatewayEvent(event: GatewayEvent, ctx: MapContext): SessionUpdate[] {
  const payload = (event.payload ?? undefined) as Payload
  const updates: SessionUpdate[] = []

  switch (event.type) {
    case 'message.delta':
    case 'message.interim': {
      const text = coerceText(payload?.text)

      if (text) updates.push({ kind: 'agent_message_chunk', text })
      break
    }

    case 'thinking.delta':
    case 'reasoning.delta': {
      const text = coerceText(payload?.text)

      if (text) updates.push({ kind: 'agent_thought_chunk', text })
      break
    }

    case 'message.complete': {
      updates.push({ kind: 'turn_complete', stopReason: 'end_turn' })
      break
    }

    case 'tool.start':
    case 'tool.progress': {
      const id = toolIdOf(payload)
      const startedAt = ctx.toolStartedAt.get(id) ?? ctx.now
      ctx.toolStartedAt.set(id, startedAt)

      const call: ToolCall = {
        id,
        name: str(payload?.name) || 'tool',
        summary: toolSummary(payload),
        status: 'running',
        output: toolOutput(payload),
        startedAt
      }

      updates.push({ kind: 'tool_call', call })
      break
    }

    case 'tool.complete': {
      const id = toolIdOf(payload)
      const startedAt = ctx.toolStartedAt.get(id)
      ctx.toolStartedAt.delete(id)

      updates.push({
        kind: 'tool_call_update',
        id,
        status: completedStatus(payload),
        output: toolOutput(payload)
      })

      if (startedAt !== undefined) {
        updates.push({
          kind: 'event',
          record: {
            id: `${id}:complete:${ctx.now}`,
            at: ctx.now,
            name: 'tool.complete',
            detail: `${str(payload?.name) || 'tool'} · ${Math.max(0, ctx.now - startedAt)}ms`,
            status: payload?.error ? 'error' : 'ok',
            payload
          }
        })
      }

      break
    }

    case 'approval.request': {
      const req: PermissionRequest = {
        id: str(payload?.request_id),
        sessionId: str(event.session_id),
        tool: str(payload?.tool) || 'shell',
        command: str(payload?.command),
        description: str(payload?.description) || 'dangerous command',
        sudo: /^\s*sudo\b/.test(str(payload?.command)),
        // The backend omits the field unless a tirith warning forbids it.
        allowPermanent: payload?.allow_permanent !== false,
        // The event carries no expiry, but the host enforces `approvals.timeout`
        // and denies when it elapses (§7.6). Anchored to arrival: the app cannot
        // know when the host started waiting, and erring late would show time
        // that is already gone.
        expiresAt: ctx.approvalTimeoutMs === null ? null : ctx.now + ctx.approvalTimeoutMs
      }

      updates.push({ kind: 'permission_request', req })
      break
    }

    case 'clarify.request': {
      updates.push({
        kind: 'clarify_request',
        req: {
          id: str(payload?.request_id),
          sessionId: str(event.session_id),
          question: str(payload?.question) || str(payload?.prompt) || coerceText(payload?.text)
        }
      })
      break
    }

    case 'session.usage': {
      const usage = (payload?.usage ?? {}) as Record<string, unknown>

      updates.push({
        kind: 'usage',
        usage: {
          inputTokens: num(usage.input) ?? 0,
          outputTokens: num(usage.output) ?? 0,
          contextTokens: num(usage.total),
          costUsd: num(usage.cost_usd)
        }
      })
      break
    }

    case 'error': {
      const error: AgentError = {
        message: str(payload?.message) || str(payload?.error) || 'The agent reported an error',
        code: str(payload?.code) || undefined,
        retryable: payload?.retryable === true
      }

      updates.push({ kind: 'error', error })
      break
    }

    // `sudo.request` and `secret.request` also halt the turn, but their sheets
    // are not designed yet (design §Open items). Log them so the state is at
    // least visible rather than silently swallowed.
    default:
      break
  }

  if (LOG_ONLY.has(event.type) || updates.length === 0) {
    updates.push({ kind: 'event', record: toEventRecord(event, ctx.now) })
  }

  return updates
}

export function toEventRecord(event: GatewayEvent, now: number): EventRecord {
  const payload = (event.payload ?? undefined) as Payload

  return {
    id: `${event.type}:${now}:${Math.trunc(Math.random() * 1e6)}`,
    at: now,
    name: event.type,
    detail: str(payload?.name) || str(payload?.message) || str(payload?.status) || '',
    status: event.type === 'error' || payload?.error ? 'error' : 'info',
    sessionId: event.session_id || undefined,
    payload: event.payload
  }
}
