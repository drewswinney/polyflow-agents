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
  ApprovalPolicy,
  ClarifyRequest,
  ConfigField,
  ContentBlock,
  CronJobSummary,
  EventRecord,
  KanbanBoard,
  KanbanCardCreate,
  KanbanCardUpdate,
  McpServerStatus,
  ModelOption,
  NewSessionOptions,
  PermissionOutcome,
  PermissionRequest,
  SessionId,
  SessionQuery,
  SessionSummary,
  SessionTranscript,
  SkillSummary,
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
  /**
   * The whole assistant message so far, not the piece that just arrived.
   *
   * Hermes emits `message.interim` alongside `message.delta` when
   * `display.interim_assistant_messages` is on, and it carries the *cumulative*
   * text. Folding it in as another chunk is what made every such reply render
   * twice, so it is a distinct update that replaces the tail rather than
   * extending it.
   */
  | { kind: 'agent_message_snapshot'; text: string }
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
  prompt(id: SessionId, content: ContentBlock[]): Promise<PromptResult>
  cancel(id: SessionId): Promise<void>

  // The agent asking us something
  respondToPermission(reqId: string, outcome: PermissionOutcome, sessionId?: SessionId): Promise<void>
  respondToClarify(reqId: string, answer: string): Promise<void>

  // Live stream
  subscribe(id: SessionId, sink: (u: SessionUpdate) => void): Unsubscribe

  /**
   * Every event the agent emits, not just one session's.
   *
   * Activity and Logs are agent-scoped, not session-scoped: a cron job firing
   * or an MCP server dropping belongs on those screens whether or not the
   * session that caused it is open (§7.5, §7.15).
   */
  subscribeEvents(sink: (record: EventRecord) => void): Unsubscribe

  // --- Capability-gated surfaces -----------------------------------------
  //
  // Each of these is guarded by a flag in `capabilities`. The UI omits the
  // screen when the flag is false and therefore never calls the method, so a
  // backend that cannot answer is free to throw rather than fake a shape
  // (§4.1). None of them exist to be called speculatively.

  /** Requires `capabilities.logs.events`. Historical rows, newest first. */
  listEvents(limit?: number): Promise<EventRecord[]>
  /** Requires `capabilities.extras.mcp`. */
  listMcpServers(): Promise<McpServerStatus[]>
  /** Requires `capabilities.extras.boards`. */
  listKanbanBoard(): Promise<KanbanBoard>
  /** Requires `capabilities.extras.boards`. Edit title/body and/or move a card. */
  updateKanbanCard(id: string, update: KanbanCardUpdate): Promise<void>
  /** Requires `capabilities.extras.boards`. Create a card on the active board. */
  createKanbanCard(card: KanbanCardCreate): Promise<void>
  /** Requires `capabilities.extras.skills`. */
  listSkills(): Promise<SkillSummary[]>
  /** Requires `capabilities.settings.model`. */
  listModels(): Promise<ModelOption[]>
  /** Requires `capabilities.settings.model`. */
  setModel(option: ModelOption): Promise<void>

  /** Requires `capabilities.approvals.policy`. */
  getApprovalPolicy(): Promise<ApprovalPolicy>
  /** Requires `capabilities.approvals.policy`. */
  setApprovalPolicy(policy: ApprovalPolicy): Promise<void>

  /** Requires `capabilities.settings.schemaDriven`. Fields with their current values. */
  listConfigFields(): Promise<ConfigField[]>
  /** Requires `capabilities.settings.schemaDriven`. */
  setConfigValue(key: string, value: string): Promise<void>

  /** Requires `capabilities.extras.cron`. */
  listCronJobs(): Promise<CronJobSummary[]>
  /** Requires `capabilities.extras.cron`. */
  setCronJobEnabled(id: string, enabled: boolean): Promise<void>
  /** Requires `capabilities.extras.cron`. Runs the job now. */
  triggerCronJob(id: string): Promise<void>

  /**
   * Requires `capabilities.push.register`. Tell the host where to push.
   *
   * Idempotent by token, and called on every launch rather than once at
   * install: Expo rotates push tokens, and a host registry keyed on a stale one
   * pushes into the void with no error anyone sees.
   */
  registerPushDevice(registration: PushDeviceRegistration): Promise<void>
  /** Requires `capabilities.push.register`. */
  unregisterPushDevice(token: string): Promise<void>

  /**
   * Requires `capabilities.media.audioIn`. Takes a base64 data URL.
   *
   * Push-to-talk, not a duplex channel: Hermes's audio surface is three
   * request/response REST endpoints, so speech is recorded, sent, and comes
   * back as text (§2.6, §7.9).
   */
  transcribe(dataUrl: string, mimeType: string): Promise<string>
  /** Requires `capabilities.media.audioOut`. Returns audio as a data URL. */
  speak(text: string): Promise<{ dataUrl: string; mimeType: string }>
}

/**
 * What a submitted turn tells the caller about its images.
 *
 * The agent files an attached image under a name of its own choosing, and that
 * name — not the one the phone picked it as — is the handle the stored
 * transcript will refer to it by on every later load. Only the backend sees the
 * renaming happen, so it is the only thing that can report it.
 */
export interface PromptResult {
  /** One entry per image the agent accepted. Empty for a text-only turn. */
  images: StoredImage[]
}

export interface StoredImage {
  /** The name the agent filed it under. */
  name: string
  /** The `uri` of the `ContentBlock` it came from, so the caller can pair the two. */
  sourceUri: string
}

/** A turn that carried nothing to report. */
export const NO_IMAGES: PromptResult = { images: [] }

/**
 * What the host needs in order to push to this device.
 *
 * `prefs` is here because a *closed* app cannot filter its own push: once the
 * process is gone the host is the only thing that can decide whether something
 * is worth waking someone for. Quiet hours are deliberately absent — they are
 * evaluated on the device against its own clock and timezone, which the host
 * does not know and should not guess.
 */
export interface PushDeviceRegistration {
  /** The Expo push token. Rotates; never travels in a push payload. */
  token: string
  /**
   * The *app's* id for the agent, which the host has no idea about. It comes
   * back on every push so a tap can re-scope the app before opening the
   * session (§5.2); without it a notification cannot route.
   */
  agentId: string
  /** `ios` / `android`, for the host's own logs. */
  platform: string
  /** Human-readable, so a device list is legible on the host. */
  label: string
  prefs: PushPrefs
}

export interface PushPrefs {
  approvals: boolean
  clarify: boolean
  turnComplete: boolean
  cronFailures: boolean
  artifacts: boolean
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
