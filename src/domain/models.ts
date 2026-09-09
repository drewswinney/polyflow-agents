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
  /**
   * Something the host put in the conversation, not the person.
   *
   * A compaction summary, a scheduled job's prompt, a skill's text, a note
   * that a background process finished. Hermes persists these under
   * `role: 'user'` — strict providers reject a system message that is not
   * first — so taken at face value they render as things you said. They are
   * kept, since they explain what the agent knew, but drawn as plumbing.
   */
  | { kind: 'system'; id: string; note: SystemNoteKind; label: string; detail?: string; text: string; at: number }

/** What kind of plumbing a system entry is; picks its glyph. */
export type SystemNoteKind = 'compaction' | 'cron' | 'skill' | 'background' | 'delegation' | 'continue' | 'system'

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

/**
 * What came back from switching a session's model.
 *
 * `deferred` is the case worth designing for: a switch asked for while a turn
 * is streaming cannot be applied in place — the worker thread reads the
 * agent's model and base URL every iteration, so a mid-turn swap can fire a
 * request with the new URL and the old model. The host stashes the pick and
 * applies it at the next turn start instead, which is a success the screen has
 * to report differently: the model has changed, but not yet.
 */
export interface ModelSwitch {
  /** The model now in effect, or queued to be. */
  model: string
  /** True when it takes effect on the next turn rather than immediately. */
  deferred: boolean
  /** Host-supplied caveat — an expensive model, a fallback. Empty when none. */
  warning: string
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

/** What a scheduled job runs: an agent turn on a prompt, or a script with no agent. */
export type ScheduledJobKind = 'prompt' | 'script'

/**
 * How the job's most recent run went, as the host reports it.
 *
 * `delivery_failed` is its own state because the host tracks it separately: the
 * agent finished and the output exists, only the hand-off to its delivery
 * target failed — a different thing to fix than a run that died. `never` is a
 * job that has not fired yet, which is not a failure either.
 */
export type ScheduledJobOutcome = 'ok' | 'failed' | 'delivery_failed' | 'running' | 'never'

/**
 * A scheduled job (§7.20) — what Hermes calls a cron job.
 *
 * Carries what the job *does*, not just when: the prompt or script, where the
 * output goes, which skills load first. A row that says only "every day at
 * 6" cannot be told from the next one, and the whole point of a list of these
 * on a phone is knowing which one to pause.
 */
export interface ScheduledJob {
  id: string
  name: string
  kind: ScheduledJobKind
  /** Human-readable schedule, e.g. `every day at 03:15` or `0 6 * * 0`. */
  schedule: string
  /** The schedule as the host accepts it back — a cron expression, `every 2h`, or a timestamp. */
  scheduleExpr: string
  enabled: boolean
  /** The prompt the agent runs; empty for a script job. */
  prompt: string
  /** The script a `script` job runs, relative to the host's scripts directory. */
  script: string | null
  /** Skills loaded before the prompt runs. */
  skills: string[]
  /** Where the output goes: `local`, `origin`, or a platform name. */
  deliver: string
  model: string | null
  nextRunAt: number | null
  lastRunAt: number | null
  outcome: ScheduledJobOutcome
  lastError: string | null
  lastDeliveryError: string | null
  /** Consecutive failed runs; resets on a success. */
  failureStreak: number
  /**
   * Jobs whose latest output is injected above this one's prompt. The host's
   * only chaining primitive today, and the seed of a workflow view: a job that
   * reads another's output is downstream of it.
   */
  contextFrom: string[]
}

/**
 * One firing of a job that ran the agent. A run is stored as an ordinary
 * session, so `sessionId` opens in chat like any other transcript. Script
 * jobs leave no session, and so no runs here — their output is the delivery.
 */
export interface ScheduledJobRun {
  sessionId: SessionId
  startedAt: number
  endedAt: number | null
  /** Still going, as far as the host can tell. */
  active: boolean
  /** The last thing said in the run, for the row. */
  preview: string
  messageCount: number
}

/** What the phone needs to create a job; the host fills in the rest. */
export interface ScheduledJobDraft {
  name: string
  schedule: string
  prompt: string
  deliver: string
  skills?: string[]
}

/** A partial edit; only the fields present change. */
export interface ScheduledJobUpdate {
  name?: string
  schedule?: string
  prompt?: string
  deliver?: string
  skills?: string[]
  contextFrom?: string[]
}

/**
 * Somewhere a job's output can go, as the host offers them: `local` always,
 * then each configured messaging platform. `ready` is false for a platform
 * that is set up but has no home channel yet, which the host lists anyway so
 * the form can say what is missing rather than hide the option.
 */
export interface DeliveryTarget {
  id: string
  name: string
  ready: boolean
  /** The env var that would make it ready, when it is not. */
  hint: string | null
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
  /**
   * The board's own ordering weight — higher is more urgent, matching
   * `hermes kanban`'s `priority DESC`. Absent from a host whose plugin
   * predates it, which is why it is optional rather than defaulted to zero:
   * "not reported" and "set to zero" should not look the same.
   */
  priority?: number | null
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

/**
 * How the app draws an artifact. Decided on the host, once, from the MIME
 * type and extension, so every client agrees on what is an image.
 */
export type ArtifactKind = 'image' | 'video' | 'audio' | 'document' | 'code' | 'data' | 'other'

/** `agent` produced it — a tool wrote or generated it. `upload` is a picture this app sent. */
export type ArtifactOrigin = 'agent' | 'upload'

/**
 * A live share link. `expiresAt` is null for "until revoked".
 *
 * Whether the link works for someone *outside* the host's own auth is the
 * host's decision, not this app's — see `docs/artifacts.md` §5. The screen
 * that shows it says so.
 */
export interface ArtifactShare {
  url: string
  expiresAt: number | null
  createdAt: number | null
}

/**
 * A file that passed through a conversation, kept by the host (`docs/artifacts.md`).
 *
 * Hermes has no such noun — upstream there is tool output and an `images/`
 * directory of uploads — so this is the app's word, backed by its own plugin.
 * `sessionId` is the stored id the app opens a chat by, or null when the host
 * could not say which conversation produced it.
 */
export interface Artifact {
  id: string
  name: string
  kind: ArtifactKind
  mimeType: string
  /** Bytes. */
  size: number
  sessionId: SessionId | null
  origin: ArtifactOrigin
  /** The tool that produced it, when an agent did. */
  tool: string | null
  /** Where it lived on the host when it was captured, if anywhere. */
  sourcePath: string | null
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms; moves when the same file is written again. */
  updatedAt: number
  /** Starts at 1; a rewrite of the same file in the same session bumps it. */
  version: number
  share: ArtifactShare | null
}

export interface ArtifactQuery {
  sessionId?: SessionId
  kind?: ArtifactKind
  limit?: number
  offset?: number
}

export interface ArtifactPage {
  artifacts: Artifact[]
  /** How many match the query in all, so a page knows what it is a page of. */
  total: number
}

/** A picture this app sent, being filed with the host under the host's own name for it. */
export interface ArtifactUpload {
  /** The filename the host stored the upload as — the one a reloaded transcript refers to. */
  name: string
  mimeType: string
  sessionId: SessionId
  /** A data URL or a local file URI. */
  uri: string
}

/** The bytes of one artifact, as fetched. */
export interface ArtifactBytes {
  bytes: Uint8Array
  mimeType: string
}
