/**
 * Harness-agnostic domain models.
 *
 * Nothing Hermes-shaped may appear here or above (architecture §3, §4.3).
 * Backends normalise into these types at their boundary; the UI never sees a
 * `snake_case` field or a Hermes event name.
 */

export type AgentId = string
export type ServerId = string
export type SessionId = string

/** The kinds of harness a Server can be running (§4). */
export type AgentKind = 'hermes' | 'other'

/** Coarse reachability, as drawn on the agent pill (design §Global chrome). */
export type AgentConnection = 'connected' | 'idle' | 'offline'

/**
 * How the app authenticates against the host (§5.3).
 *
 * `password` is the one §5.3 did not anticipate and the one a self-hosted
 * Hermes actually uses. A non-loopback bind requires an auth provider, and the
 * built-in provider is username/password: the app posts credentials to
 * `/auth/password-login`, the server mints a session, and the WebSocket is then
 * dialled with a short-lived ticket. There is no paste-a-bearer-token path
 * unless a token-only provider is configured.
 */
export type AuthMode = 'token' | 'oauth' | 'password'

/**
 * A host the phone can reach: an address, a credential, one socket (§5.2).
 *
 * Not a noun the user meets under this name — what they see is the agents on
 * it. The harness is a property of the *connection*, which is why `kind` lives
 * here rather than on `Agent`, and so does reachability: every agent on an
 * unreachable host is unreachable together, because it is one socket that is
 * down.
 */
export interface Server {
  id: ServerId
  /** Heads this server's group in the switcher, e.g. `home hermes`. */
  displayName: string
  kind: AgentKind
  /** `host:port`, e.g. `hermes.tailnet.ts.net:9119`. */
  host: string
  authMode: AuthMode
  /** Set for `password` auth. The secret itself lives in the keychain. */
  username?: string
  /** Which auth provider on the host to authenticate against, e.g. `basic`. */
  authProvider?: string
  /**
   * Whether the host speaks TLS. Resolved by probing at add time rather than
   * inferred from the address: `hermes serve` speaks plain HTTP, and a tailnet
   * address is neither loopback nor public, so no rule about the address can
   * answer this correctly.
   */
  secure?: boolean
  /** Version reported by the host when it was added; shown on Settings. */
  version?: string
  connection: AgentConnection
  /** Last measured round trip, milliseconds. Undefined until first probe. */
  latencyMs?: number
  /** Seconds the host reports being up. Undefined when unknown. */
  uptimeSeconds?: number
}

/**
 * The single user-facing noun (§5.2): one identity on one server.
 *
 * A Hermes profile is an agent — its own model, provider, skills and memory —
 * so one server routinely carries several. The harness stays a property of the
 * server, never a concept the user meets.
 */
export interface Agent {
  id: AgentId
  serverId: ServerId
  displayName: string
  /** One distinct glyph per agent; keys into the icon set, not a font name. */
  icon: AgentIconName
  /**
   * The backend's own selector for this identity, opaque above the §4 seam.
   *
   * Hermes stores a profile name here, an OpenAI-compatible host a model id,
   * and a server that hosts exactly one identity stores null. Nothing at this
   * layer or above may read it: a field named `profile` would be precisely the
   * Hermes leak §4.3 forbids, and the next harness will not have profiles.
   */
  scope: string | null
  /** One line of provenance from discovery, e.g. `claude-opus-4 · 12 skills`. */
  hint?: string
  /** Optional per-agent accent override; falls back to the base palette. */
  accent?: AgentAccent
  /**
   * Set when the last reconciliation no longer found this identity on its
   * server (§5.2a). Kept rather than deleted: selection, caches and
   * notification routing all hang off an agent id, and dropping the row
   * silently loses things a person would notice going.
   */
  missing?: boolean
}

/**
 * One identity as a server reports it (§4.2).
 *
 * Produced by `discoverAgents` at the REST layer, before any socket exists, and
 * turned into an `Agent` by onboarding or by reconciliation.
 */
export interface AgentIdentity {
  /** Opaque selector; null when the server hosts exactly one identity. */
  scope: string | null
  /** What to name the agent, e.g. `research` or `gpt-4o-mini`. */
  label: string
  /** One prebuilt line of detail for the picker row. */
  hint?: string
  /** Pre-selects this row, and wins when a name has to be chosen. */
  isDefault: boolean
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

/**
 * The glyphs an agent can wear.
 *
 * One agent gets a starting glyph by position (see `GLYPHS` in the agents
 * store); the user can change it per agent, and that choice is phone-side —
 * the host has no opinion about it, so nothing here crosses the §4 seam.
 *
 * Names are the app's own, not font names: `home` is a house. Adding one means
 * adding its glyph to `AGENT_GLYPH`, and only ever *adding* — a name that has
 * been persisted on someone's phone can never be removed.
 */
export type AgentIconName =
  | 'home'
  | 'car'
  | 'flask'
  | 'cloud'
  | 'server'
  | 'terminal'
  | 'robot'
  | 'brain'
  | 'rocket'
  | 'bolt'
  | 'code'
  | 'database'
  | 'microchip'
  | 'laptop'
  | 'compass'
  | 'cube'
  | 'leaf'
  | 'ghost'

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
  /** Image media type, e.g. `image/jpeg`. Set on `image` blocks. */
  mimeType?: string
  /** Filename hint. The host uses it to pick an extension when magic bytes are ambiguous. */
  name?: string
}

/**
 * An image on a settled user message.
 *
 * `name` is the filename the *host* stored, which is the only durable handle:
 * a reloaded transcript carries `@image:<host path>` refs and nothing else, and
 * the host serves no endpoint to read those bytes back. `uri` is this device's
 * own copy of the same picture, kept so a reopened session still shows it —
 * absent when the cache has been cleared, which renders as a name-only chip.
 */
export interface MessageImage {
  name: string
  uri?: string
}

/** A rendered transcript entry. Tool calls are their own entry kind. */
export type TranscriptEntry =
  | {
      kind: 'message'
      id: string
      role: MessageRole
      text: string
      at: number
      streaming?: boolean
      /** Images the user sent with this message. Never set on agent rows. */
      images?: MessageImage[]
    }
  | { kind: 'thinking'; id: string; text: string; at: number; durationMs?: number; streaming?: boolean }
  | { kind: 'tool'; id: string; call: ToolCall }
  | { kind: 'stream_cut'; id: string; at: number }

export interface SessionTranscript {
  sessionId: SessionId
  title: string
  model: string | null
  entries: TranscriptEntry[]
  usage: Usage | null
  /**
   * An approval still blocking this session, recovered on load.
   *
   * The live `approval.request` event fires once. A phone that was closed when
   * it fired — the case notifications exist for — never sees it, so opening the
   * session from a notification would show a halted agent and no way to answer.
   * Hermes returns the outstanding prompt on resume for exactly this reason.
   */
  pendingApproval: PermissionRequest | null
  /** A question still blocking this session, recovered on load. Same reason. */
  pendingClarify: ClarifyRequest | null
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
  /** Offered answers. Empty when the agent wants free text. */
  choices: string[]
  /** Whether more than one choice may be picked. */
  multiSelect: boolean
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

/** A logged event row, as shown on Logs & events (§7.15). */
export interface EventRecord {
  id: string
  at: number
  name: string
  detail: string
  status: 'ok' | 'error' | 'info'
  /** The session that raised it, when there was one. Lets a notification open it. */
  sessionId?: SessionId
  /** Full payload, pretty-printed on expansion. */
  payload?: unknown
}

/**
 * An MCP server as the API describes it.
 *
 * `/api/mcp/servers` reports configuration, not reachability — health needs an
 * explicit `POST /api/mcp/servers/{name}/test`. So this models what is known
 * (`on` / `off` and the tools it declares) rather than the design's
 * "unreachable, retrying", which would be a guess.
 */
export interface McpServerStatus {
  name: string
  enabled: boolean
  transport: string
  toolCount: number
  /** Null when the backend has not reported a tool list yet. */
  tools: string[] | null
}

export interface SkillSummary {
  name: string
  category: string
  description: string
  enabled: boolean
  /** 'agent' = learned locally, 'bundled' = ships with the harness, 'hub' = installed. */
  provenance: 'agent' | 'bundled' | 'hub' | 'unknown'
}

export interface ModelOption {
  /** The model id as the harness names it, e.g. `sonnet-4.5`. */
  id: string
  provider: string
  selected: boolean
}

/**
 * The approval policy, as one decision with one control (§7.10).
 *
 * These map onto Hermes's `approvals.mode` config key — `off` / `smart` /
 * `manual` — which is why there are exactly three: the design's segmented
 * control and the backend's enum happen to agree, and inventing a fourth
 * option would have nothing to write to.
 */
export type ApprovalPolicy = 'nothing' | 'destructive' | 'every_tool'

/**
 * One setting, as the *server* describes it (§2.3).
 *
 * This is the highest-leverage decision in the app: the Settings UI renders
 * from the schema the backend publishes rather than hardcoding a form per
 * setting, so the app does not need a release every time Hermes adds a toggle.
 */
export interface ConfigField {
  key: string
  category: string
  description: string
  type: 'boolean' | 'list' | 'number' | 'select' | 'string' | 'text'
  /** Only meaningful for `select`. */
  options: string[]
  /** Current value, always as a string — that is how `config.set` takes it. */
  value: string
}

export interface CronJobSummary {
  id: string
  name: string
  /** Human-readable schedule, e.g. `every day at 03:15`. */
  schedule: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastError: string | null
  model: string | null
}

export type KanbanStatus = 'backlog' | 'in_progress' | 'testing' | 'done' | 'blocked' | 'other'

export interface KanbanCardSummary {
  id: string
  title: string
  description: string
  status: KanbanStatus
  statusLabel: string
  checked: boolean
  branch?: string | null
  pr?: string | null
  risk?: string | null
  updatedAt?: number | null
  body?: string
}

export interface KanbanColumn {
  id: KanbanStatus | string
  title: string
  cards: KanbanCardSummary[]
}

export interface KanbanBoard {
  title: string
  source: string
  updatedAt: number | null
  columns: KanbanColumn[]
}

export interface KanbanCardCreate {
  title: string
  body?: string
}

export type KanbanMoveTarget =
  | { kind: 'column'; status: KanbanStatus }
  | { kind: 'archive' }

export interface KanbanCardUpdate {
  title?: string
  body?: string
  move?: KanbanMoveTarget
}
