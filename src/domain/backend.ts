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
  Artifact,
  ArtifactBytes,
  ArtifactPage,
  ArtifactQuery,
  ArtifactShare,
  ArtifactUpload,
  ClarifyRequest,
  ConfigField,
  ContentBlock,
  DeliveryTarget,
  ScheduledJob,
  ScheduledJobDraft,
  ScheduledJobRun,
  ScheduledJobUpdate,
  EventRecord,
  KanbanBoard,
  KanbanCardCreate,
  KanbanCardUpdate,
  McpServerStatus,
  ModelOption,
  ModelSwitch,
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
  /**
   * The host has started working on a turn — nothing has arrived yet.
   *
   * The gap between a submit and the first token is the model's whole
   * time-to-first-token, and on a session whose runtime was rebuilt it is the
   * agent build as well. Without this the chat had no way to tell that gap
   * from an idle session, and looked dead for exactly as long as the model
   * thought.
   */
  | { kind: 'turn_started' }
  /**
   * A line from the host about the turn, for the pending row.
   *
   * Hermes emits one when an agent build outlives thirty seconds ("still
   * starting the agent … your message will be sent as soon as it's ready"),
   * and when it compacts context before or between model calls ("Compacting
   * context — summarizing earlier conversation…"), which can take minutes.
   * Rendered only while a turn is pending; never a transcript entry.
   */
  | { kind: 'notice'; text: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'tool_call_update'; id: string; status: ToolStatus; output?: string }
  | { kind: 'permission_request'; req: PermissionRequest }
  | { kind: 'clarify_request'; req: ClarifyRequest }
  | { kind: 'turn_complete'; stopReason: StopReason }
  | { kind: 'usage'; usage: Usage }
  /**
   * The session's model changed, and this is what it is now.
   *
   * Not only from this app: a switch made in the TUI or the desktop client
   * reaches the same session, and the chip has to follow it rather than report
   * whatever the transcript happened to load with. A switch asked for mid-turn
   * arrives here too — the host reports the *pending* pick, because that is
   * the model the next turn runs on and blipping back to the old one for the
   * rest of the turn would be a lie about what was chosen.
   */
  | { kind: 'model_changed'; model: string }
  | { kind: 'error'; error: AgentError }
  /** Raw passthrough for the Logs & events screen (§7.15). Never rendered in chat. */
  | { kind: 'event'; record: EventRecord }

export interface AgentBackend {
  readonly capabilities: Capabilities

  connect(signal?: AbortSignal): Promise<void>
  disconnect(): void
  readonly connectionState: Observable<ConnectionState>

  /**
   * Ask, right now, whether the socket still carries traffic.
   *
   * Optional because it only means something to a backend holding a real
   * duplex connection — the mock and the OpenAI-compatible shim have nothing
   * to probe. A backend that implements it must resolve once the answer is
   * known and report a dead socket the same way a close frame would, by
   * driving `connectionState` to `closed`; the caller reads the state, not the
   * return.
   *
   * Exists because a phone loses a socket without being told, and the periodic
   * watchdog that normally catches that cannot run while the app is frozen.
   * Returning to the foreground is the moment the answer is both stale and
   * wanted — see the AppState trigger in `useConnection`.
   */
  checkLiveness?(): Promise<void>

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
  /**
   * The model this agent runs on when nothing overrides it.
   *
   * Asked for directly rather than read off `listModels`' `selected` flag: that
   * flag can only tick a row the list actually contains, and a host reaching
   * its model through a proxy or an aggregator answers with an id that is not
   * in any of the groups it offers. Null when the backend cannot say.
   */
  getModel(): Promise<string | null>
  /** Requires `capabilities.settings.model`. */
  setModel(option: ModelOption): Promise<void>
  /**
   * Switches the model for **one session**, leaving every other session and
   * the profile default alone.
   *
   * Separate from {@link setModel} because they are different decisions with
   * different blast radii, not one call with a flag: `setModel` rewrites the
   * profile's config and is reached from Settings, while this pins an override
   * on a single conversation. Gated on `settings.sessionModel`.
   */
  setSessionModel(id: SessionId, option: ModelOption): Promise<ModelSwitch>

  /** Requires `capabilities.approvals.policy`. */
  getApprovalPolicy(): Promise<ApprovalPolicy>
  /** Requires `capabilities.approvals.policy`. */
  setApprovalPolicy(policy: ApprovalPolicy): Promise<void>

  /** Requires `capabilities.settings.schemaDriven`. Fields with their current values. */
  listConfigFields(): Promise<ConfigField[]>
  /** Requires `capabilities.settings.schemaDriven`. */
  setConfigValue(key: string, value: string): Promise<void>

  // Scheduled jobs (§7.20). All require `capabilities.extras.cron`.

  listScheduledJobs(): Promise<ScheduledJob[]>
  /** Runs that produced a session, newest first. A script job has none. */
  listScheduledJobRuns(id: string, limit?: number): Promise<ScheduledJobRun[]>
  createScheduledJob(draft: ScheduledJobDraft): Promise<ScheduledJob>
  updateScheduledJob(id: string, update: ScheduledJobUpdate): Promise<ScheduledJob>
  deleteScheduledJob(id: string): Promise<void>
  setScheduledJobEnabled(id: string, enabled: boolean): Promise<void>
  /** Runs the job now, off its schedule. */
  triggerScheduledJob(id: string): Promise<void>
  /** Where a job's output can be sent, as the host offers them. */
  listDeliveryTargets(): Promise<DeliveryTarget[]>

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

  // --- Artifacts (`docs/artifacts.md`) ------------------------------------
  //
  // All gated on `capabilities.artifacts.store`; the two share calls on
  // `capabilities.artifacts.share` as well. A Hermes host without the plugin
  // answers 404 to the first of these, which the screen reads as "not set up".

  /** Newest first. */
  listArtifacts(query?: ArtifactQuery): Promise<ArtifactPage>
  getArtifact(id: string): Promise<Artifact>
  /**
   * The bytes, over the same authenticated connection everything else uses.
   *
   * A method rather than a URL on purpose: an `<Image>` handed a bare URL
   * carries neither the bearer token nor the session cookie on Android, so
   * the bytes come through `fetch` and are cached on disk by the caller.
   *
   * The version goes with the id because the platform's HTTP cache sits
   * under `fetch` and keys on the URL: the host says the bytes for one
   * version may be kept for a day, so a rewrite has to be a different URL
   * or the cache answers with the old file.
   */
  readArtifact(id: string, version: number): Promise<ArtifactBytes>
  /**
   * A first-page PNG the host rendered, for a card or a tile.
   *
   * Rejects when the host has none for this kind of file — no Pillow for
   * pictures, no `pdftoppm` for a PDF, nothing at all for a video — and the
   * caller draws a glyph instead. Never a substitute for `readArtifact`.
   */
  readArtifactThumbnail(id: string, version: number): Promise<ArtifactBytes>
  /**
   * File a picture this app sent, under the name the host gave it.
   *
   * Called after `prompt()` reports the name, which is the only moment both
   * the bytes and the host's name for them are known on this side. What it
   * buys is the picture coming back on any device, not just the one that
   * sent it (`attachment-cache.ts` is per phone).
   */
  uploadArtifact(upload: ArtifactUpload): Promise<Artifact>
  deleteArtifact(id: string): Promise<void>
  /** Mint a link, or return the one already live. Requires `capabilities.artifacts.share`. */
  shareArtifact(id: string, options?: { expiresInHours?: number }): Promise<ArtifactShare>
  /** Revoke the link. Requires `capabilities.artifacts.share`. */
  unshareArtifact(id: string): Promise<void>
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
  /**
   * What the host did with the message. Absent when it did not say, which the
   * caller reads as `started`.
   */
  status?: PromptStatus
}

/**
 * How a submitted message was taken.
 *
 * A message sent while a turn is already running is not rejected by Hermes: by
 * default it is folded into the live turn as a correction (`redirected`), and
 * a host configured to queue instead runs it as the next turn (`queued`).
 * Either way nothing visible happens until the current step ends, and the app
 * has to say so rather than draw the bubble as though a reply were seconds
 * away.
 */
export type PromptStatus = 'started' | 'queued' | 'redirected'

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
