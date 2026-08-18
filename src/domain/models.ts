/**
 * Harness-agnostic domain models.
 *
 * Nothing Hermes-shaped may appear here or above (architecture §3, §4.2).
 * Backends normalise into these types at their boundary; the UI never sees a
 * `snake_case` field or a Hermes event name.
 */

export type AgentId = string
export type SessionId = string

/** The kinds of harness an Agent can be backed by (§4). */
export type AgentKind = 'hermes' | 'other'

/** Coarse reachability, as drawn on the agent pill (design §Global chrome). */
export type AgentConnection = 'connected' | 'idle' | 'offline'

/** How the app authenticates against the host (§5.3). */
export type AuthMode = 'token' | 'oauth'

/**
 * The single user-facing noun (§5.2). The harness is a *property* of an agent,
 * never a concept the user meets.
 */
export interface Agent {
  id: AgentId
  displayName: string
  kind: AgentKind
  /** One distinct glyph per agent; keys into the icon set, not a font name. */
  icon: AgentIconName
  /** `host:port`, e.g. `hermes.tailnet.ts.net:9119`. */
  host: string
  authMode: AuthMode
  /** Hermes multi-profile support; undefined → primary profile. */
  profile?: string
  /** Optional per-agent accent override; falls back to the base palette. */
  accent?: AgentAccent
  connection: AgentConnection
  /** Last measured round trip, milliseconds. Undefined until first probe. */
  latencyMs?: number
  /** Seconds the host reports being up. Undefined when unknown. */
  uptimeSeconds?: number
}

/**
 * Per-agent accent, so a glance at any screen says which agent you are in.
 * The baseline palette is used when an agent declares none.
 */
export interface AgentAccent {
  /** Gradient start / links. */
  primary: string
  /** Gradient end / active tab / agent glyph. */
  secondary: string
  /** Text on tinted surfaces. */
  secondaryDeep: string
  /** Focused borders, dashed outlines. */
  secondaryMuted: string
  /** Icon tiles, selected rows. */
  secondaryTint: string
  /** The strong icon-tile tint. */
  secondaryTintStrong: string
}

export type AgentIconName = 'home' | 'car' | 'flask' | 'cloud' | 'server' | 'terminal'

export interface SessionSummary {
  id: SessionId
  title: string
  /** One-line preview of the last message; empty for a fresh session. */
  preview: string
  /** Epoch milliseconds. */
  updatedAt: number
  pinned: boolean
  unread: boolean
  model: string | null
  messageCount: number
  /** Set when the agent is halted waiting on the user in this session. */
  blockedOn: BlockedReason | null
}

export type BlockedReason = 'approval' | 'clarify' | 'sudo' | 'secret'

export interface SessionQuery {
  limit?: number
  offset?: number
  /** Free-text search; backends without search ignore it (see Capabilities). */
  q?: string
}

export type MessageRole = 'user' | 'agent' | 'system'

export interface ContentBlock {
  kind: 'text' | 'image'
  text?: string
  /** Data URL or file URI for images. */
  uri?: string
}

/** A rendered transcript entry. Tool calls are their own entry kind. */
export type TranscriptEntry =
  | { kind: 'message'; id: string; role: MessageRole; text: string; at: number; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string; at: number; durationMs?: number; streaming?: boolean }
  | { kind: 'tool'; id: string; call: ToolCall }
  | { kind: 'stream_cut'; id: string; at: number }

export interface SessionTranscript {
  sessionId: SessionId
  title: string
  model: string | null
  entries: TranscriptEntry[]
  usage: Usage | null
}

/**
 * `unknown` is first-class, not an error: when a socket drops mid-turn the app
 * must not guess whether a tool completed (§4, §5.4, §7.16).
 */
export type ToolStatus = 'pending' | 'running' | 'ok' | 'error' | 'unknown'

export interface ToolCall {
  id: string
  name: string
  /** Short argument summary for the card header, already truncated. */
  summary: string
  status: ToolStatus
  /** Present once the call finishes, or while it streams progress. */
  output?: string
  startedAt: number
  durationMs?: number
  /** True while the call is held behind an approval. */
  held?: boolean
}

export interface PermissionRequest {
  id: string
  sessionId: SessionId
  /** Tool the agent wants to run, e.g. `shell`. */
  tool: string
  /** The exact command, shown verbatim in a code block. */
  command: string
  /** Plain-language consequence sentence naming the host. */
  description: string
  sudo: boolean
  /** False when the backend will not honour a permanent allow. */
  allowPermanent: boolean
  /** Epoch ms. Hermes carries no TTL today (§2.6); null until the API grows one. */
  expiresAt: number | null
}

export type PermissionOutcome = 'allow_once' | 'allow_always' | 'deny'

export interface ClarifyRequest {
  id: string
  sessionId: SessionId
  question: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Context window occupancy, tokens. */
  contextTokens?: number
  costUsd?: number
}

export type StopReason = 'end_turn' | 'cancelled' | 'error' | 'max_tokens'

export interface AgentError {
  message: string
  /** Machine-readable where the backend gives one, e.g. `ECONNREFUSED`. */
  code?: string
  retryable: boolean
}

export interface NewSessionOptions {
  title?: string
  model?: string
  /** Working directory on the host, when the harness has a notion of one. */
  cwd?: string
}

/** A logged event row, as shown on Activity and Logs (§7.5, §7.15). */
export interface EventRecord {
  id: string
  at: number
  name: string
  detail: string
  status: 'ok' | 'error' | 'info'
  /** Full payload, pretty-printed on expansion. */
  payload?: unknown
}
