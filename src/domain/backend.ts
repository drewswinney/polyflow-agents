/**
 * The harness-swap seam (§4).
 *
 * Everything above this file is harness-agnostic. Two backends ship: `hermes`
 * (full support) and `other` (anything speaking OpenAI-compatible streaming).
 * `MockBackend` proves the seam without a host.
 */

import type { Capabilities } from './capabilities'
import type {
  AgentError,
  ClarifyRequest,
  ContentBlock,
  EventRecord,
  NewSessionOptions,
  PermissionOutcome,
  PermissionRequest,
  SessionId,
  SessionQuery,
  SessionSummary,
  SessionTranscript,
  StopReason,
  ToolCall,
  ToolStatus,
  Usage
} from './models'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export type Unsubscribe = () => void

/** Minimal push source; avoids taking an rxjs-shaped dependency for one field. */
export interface Observable<T> {
  get(): T
  subscribe(listener: (value: T) => void): Unsubscribe
}

/**
 * Normalised stream updates. Deliberately *not* Hermes's event names — the
 * mapping from those lives in exactly one file (`backends/hermes/event-map.ts`).
 */
export type SessionUpdate =
  | { kind: 'agent_message_chunk'; text: string }
  | { kind: 'agent_thought_chunk'; text: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'tool_call_update'; id: string; status: ToolStatus; output?: string }
  | { kind: 'permission_request'; req: PermissionRequest }
  | { kind: 'clarify_request'; req: ClarifyRequest }
  | { kind: 'turn_complete'; stopReason: StopReason }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'error'; error: AgentError }
  /** Raw passthrough for the Logs & events screen (§7.15). Never rendered in chat. */
  | { kind: 'event'; record: EventRecord }

export interface AgentBackend {
  readonly capabilities: Capabilities

  connect(signal?: AbortSignal): Promise<void>
  disconnect(): void
  readonly connectionState: Observable<ConnectionState>

  // Sessions
  listSessions(query?: SessionQuery): Promise<SessionSummary[]>
  createSession(opts: NewSessionOptions): Promise<SessionId>
  loadSession(id: SessionId): Promise<SessionTranscript>
  deleteSession(id: SessionId): Promise<void>
  renameSession(id: SessionId, title: string): Promise<void>
  searchSessions(query: string): Promise<SessionSearchHit[]>

  // Turns
  prompt(id: SessionId, content: ContentBlock[]): Promise<void>
  cancel(id: SessionId): Promise<void>

  // The agent asking us something
  respondToPermission(reqId: string, outcome: PermissionOutcome, sessionId?: SessionId): Promise<void>
  respondToClarify(reqId: string, answer: string): Promise<void>

  // Live stream
  subscribe(id: SessionId, sink: (u: SessionUpdate) => void): Unsubscribe
}

export interface SessionSearchHit {
  sessionId: SessionId
  title: string
  updatedAt: number
  /** Context around the match; `matchStart`/`matchEnd` index into it. */
  snippet: string
  matchStart: number
  matchEnd: number
}

/** Tiny mutable observable used by backends for `connectionState`. */
export function createObservable<T>(initial: T): Observable<T> & { set(value: T): void } {
  let current = initial
  const listeners = new Set<(value: T) => void>()

  return {
    get: () => current,
    set(value: T) {
      if (Object.is(current, value)) return
      current = value
      for (const listener of listeners) listener(value)
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(current)
      return () => listeners.delete(listener)
    }
  }
}
