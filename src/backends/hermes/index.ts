/**
 * The Hermes backend: REST for state, the JSON-RPC gateway for the live turn.
 *
 * The gateway client itself is upstream code, vendored unmodified
 * (`vendor/hermes/shared/json-rpc-gateway.ts`) — it already ships backoff-free
 * connect with a 15s timeout chosen so a sleep/wake reconnect cannot hang the
 * composer (§5.4), and `resolveGatewayWsUrl` already implements the
 * mint-then-dial contract the 30-second ticket TTL demands (§5.3).
 */

import { File } from 'expo-file-system'

import {
  buildHermesWebSocketUrl,
  type ConnectionState as GatewayConnectionState,
  type GatewayEvent,
  JsonRpcGatewayClient,
  resolveGatewayWsUrl
} from '@hermes/shared'

import {
  type AgentBackend,
  type ApprovalPolicy,
  type Capabilities,
  type ConfigField,
  type ConnectionState,
  createObservable,
  type ContentBlock,
  type CronJobSummary,
  type EventRecord,
  type KanbanBoard,
  type KanbanCardCreate,
  type KanbanCardUpdate,
  type McpServerStatus,
  type ModelOption,
  type NewSessionOptions,
  NO_IMAGES,
  type PromptResult,
  type PushDeviceRegistration,
  type StoredImage,
  type ClarifyRequest,
  type PermissionRequest,
  type Observable,
  type PermissionOutcome,
  type SessionId,
  type SessionQuery,
  type SessionSearchHit,
  type SessionSummary,
  type SessionTranscript,
  type SessionUpdate,
  type SkillSummary,
  type Unsubscribe,
} from '@/domain'

import { mapGatewayEvent, type MapContext, toEventRecord } from './event-map'
import { toSearchHit, toSessionSummary, toTranscriptEntries, usableTitle } from './normalize'
import { HermesRest, type HermesRestConfig, HermesRestError } from './rest'

export { HermesRest, HermesRestError, probeScheme } from './rest'
export { mapGatewayEvent } from './event-map'

/**
 * What `session.resume` answers with.
 *
 * Only the fields this client acts on. `pending_approval` is the one that
 * matters here: upstream returns it "so a reconnect can restore a prompt whose
 * original event was emitted while the client transport was detached".
 */
interface ResumeResult {
  session_id?: string
  pending_approval?: {
    request_id?: string
    command?: string
    description?: string
    allow_permanent?: boolean
  }
  pending_clarify?: {
    request_id?: string
    question?: string
    choices?: unknown[] | null
    multi_select?: boolean
  }
}

/**
 * `prompt.submit` is fire-and-forget — turn completion arrives as events, not
 * as the RPC return — so its ack timeout matches the backend's own agent-turn
 * ceiling rather than the generic default (upstream `hermes.ts`).
 */
const PROMPT_SUBMIT_TIMEOUT_MS = 1_800_000

/**
 * How long an image upload may take.
 *
 * Generous against the gateway's own 25 MB ceiling on a phone radio, and well
 * short of the submit timeout: an attach that has not landed is a turn that
 * must not be sent, so this failing is the useful outcome, not a lost image.
 */
const IMAGE_ATTACH_TIMEOUT_MS = 120_000

/**
 * What an uncaptioned image asks.
 *
 * Matches the host's own wording for the same situation
 * (`_build_image_ref_message`), so a turn reads identically whichever client
 * sent it.
 */
const IMPLIED_IMAGE_PROMPT = 'What do you see in this image?'

/**
 * How long a password login is assumed good for.
 *
 * Deliberately short of any real session lifetime: the cost of being wrong is
 * one 401 that the next dial re-authenticates through, and the cost of being
 * too eager is a rate-limit lockout.
 */
const LOGIN_REUSE_MS = 300_000

/** Hermes reports nearly everything (§4.1). */
export const HERMES_CAPABILITIES: Capabilities = {
  sessions: { search: true, rename: true, pin: true },
  settings: { schemaDriven: true, model: true, providers: true },
  extras: { cron: true, skills: true, mcp: true, boards: true },
  approvals: { requests: true, policy: true },
  logs: { events: true },
  // Audio is request/response REST, not a duplex channel — push-to-talk only (§2.6, §7.9).
  media: { images: true, audioIn: true, audioOut: true },
  // True of the *kind*, not of a given host: the route exists once the
  // `polyflow_agents_push` plugin is installed and enabled. Without it, 404.
  push: { register: true }
}

const OUTCOME_TO_CHOICE: Record<PermissionOutcome, string> = {
  // Canonical gateway choices are `once | session | always | deny`.
  allow_once: 'once',
  allow_always: 'always',
  deny: 'deny'
}

export interface HermesBackendConfig extends HermesRestConfig {
  authMode: 'token' | 'oauth' | 'password'
}

export class HermesBackend implements AgentBackend {
  readonly capabilities = HERMES_CAPABILITIES

  private readonly config: HermesBackendConfig
  private readonly rest: HermesRest
  private readonly gateway: JsonRpcGatewayClient
  private readonly state = createObservable<ConnectionState>('idle')
  private readonly sinks = new Map<SessionId, Set<(u: SessionUpdate) => void>>()
  private readonly eventSinks = new Set<(record: EventRecord) => void>()
  /**
   * Stored session id → live runtime id, and back.
   *
   * These are two different identifiers for the same conversation and Hermes
   * does not accept one where it wants the other. `/api/sessions` lists
   * *stored* ids (`20260818_195944_3b37eb`); every gateway RPC and every event
   * uses the *runtime* id (`93ed1b33`), which only exists once a session has
   * been resumed and changes each time it is. Prompting with a stored id
   * returns `4001 session not found`, and — worse, because it is silent —
   * subscribing with one matches no events at all, so a turn would stream to
   * nobody.
   */
  private readonly runtimeByStored = new Map<SessionId, string>()
  private readonly storedByRuntime = new Map<string, SessionId>()
  private readonly resuming = new Map<SessionId, Promise<string>>()
  /**
   * Approvals recovered from a resume snapshot, by session.
   *
   * Resume is the only place an approval raised while this client was away can
   * still be found; the event that announced it is long gone.
   */
  private readonly pendingApprovals = new Map<SessionId, PermissionRequest>()
  /** Questions recovered from a resume snapshot, for the same reason. */
  private readonly pendingClarifies = new Map<SessionId, ClarifyRequest>()
  private readonly mapContext: MapContext = { now: 0, toolStartedAt: new Map(), approvalTimeoutMs: null }
  private detachGateway: Unsubscribe | null = null
  /**
   * When this client last exchanged a password for a session cookie.
   *
   * The cookie outlives a single dial, and the host rate-limits logins — so
   * re-authenticating on every reconnect is both wasted and the thing that
   * earns a 429. A redial inside the window reuses the session it already has.
   */
  private lastLoginAt = 0

  constructor(config: HermesBackendConfig) {
    this.config = config
    this.rest = new HermesRest(config)
    this.gateway = new JsonRpcGatewayClient({
      closedErrorMessage: 'Hermes gateway connection closed',
      connectErrorMessage: 'Could not reach the Hermes gateway',
      notConnectedErrorMessage: 'Hermes gateway is not connected',
      requestIdPrefix: 'hh'
    })
  }

  get connectionState(): Observable<ConnectionState> {
    return this.state
  }

  /** Exposed for screens that read Hermes-only surfaces (settings, activity). */
  get api(): HermesRest {
    return this.rest
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return

    this.state.set('connecting')

    // Password auth has to establish the session before anything else: the
    // ticket endpoint is itself session-gated, so minting one without logging
    // in first returns 401, not a ticket.
    if (this.config.authMode === 'password' && Date.now() - this.lastLoginAt > LOGIN_REUSE_MS) {
      await this.rest.login()
      this.lastLoginAt = Date.now()
    }

    if (signal?.aborted) return

    const wsUrl = await this.resolveWsUrl()

    if (signal?.aborted) return

    this.detachGateway?.()
    const offState = this.gateway.onState((next: GatewayConnectionState) => this.state.set(next))
    const offEvents = this.gateway.onAny(event => this.dispatch(event))

    this.detachGateway = () => {
      offState()
      offEvents()
    }

    await this.gateway.connect(wsUrl)

    // Not awaited: a slow or unavailable config read must not hold up the
    // socket. The countdown is absent until it lands, never wrong.
    void this.loadApprovalTimeout()
  }

  disconnect(): void {
    this.detachGateway?.()
    this.detachGateway = null
    this.gateway.close()
    this.state.set('closed')

    // Runtime ids belong to the connection that minted them. Keeping them
    // across a reconnect would send prompts to sessions that no longer exist.
    this.runtimeByStored.clear()
    this.storedByRuntime.clear()
    this.resuming.clear()
  }

  /**
   * The runtime id for a stored session, resuming it if necessary.
   *
   * Resume is idempotent and cheap on an already-live session, so this is safe
   * to call before every prompt. In-flight resumes are shared rather than
   * duplicated: opening a chat fires the transcript load and the subscription
   * at once, and two resumes for one session would mint two runtimes.
   */
  private async runtimeIdFor(stored: SessionId): Promise<string> {
    const known = this.runtimeByStored.get(stored)

    if (known) return known

    const inFlight = this.resuming.get(stored)

    if (inFlight) return inFlight

    const pending = this.gateway
      .request<ResumeResult>('session.resume', {
        session_id: stored,
        ...(this.config.profile ? { profile: this.config.profile } : {})
      })
      .then(result => {
        const runtime = result?.session_id || stored
        this.rememberRuntime(stored, runtime)

        const waiting = result?.pending_approval

        if (waiting?.request_id) {
          const command = String(waiting.command ?? '')

          this.pendingApprovals.set(stored, {
            id: String(waiting.request_id),
            sessionId: stored,
            tool: 'shell',
            command,
            description: String(waiting.description ?? '') || 'A command is waiting on your answer.',
            sudo: /^\s*sudo\b/.test(command),
            allowPermanent: waiting.allow_permanent !== false,
            // Deliberately no deadline. The host's timeout runs from when the
            // prompt was raised, which may have been long before this resume —
            // a countdown anchored to now would promise time that is gone.
            expiresAt: null
          })
        } else {
          this.pendingApprovals.delete(stored)
        }

        const asking = result?.pending_clarify

        if (asking?.request_id) {
          this.pendingClarifies.set(stored, {
            id: String(asking.request_id),
            sessionId: stored,
            question: String(asking.question ?? '') || 'The agent asked a question.',
            choices: Array.isArray(asking.choices) ? asking.choices.map(choice => String(choice)) : [],
            multiSelect: asking.multi_select === true
          })
        } else {
          this.pendingClarifies.delete(stored)
        }

        return runtime
      })
      .finally(() => {
        this.resuming.delete(stored)
      })

    this.resuming.set(stored, pending)

    return pending
  }

  private rememberRuntime(stored: SessionId, runtime: string): void {
    this.runtimeByStored.set(stored, runtime)
    this.storedByRuntime.set(runtime, stored)
  }

  /**
   * Mint the ticket immediately before dialling and never cache it: the TTL is
   * 30 seconds, and a phone waking from an hour in background has a stale
   * everything (§5.3).
   */
  private resolveWsUrl(): Promise<string> {
    const token = this.config.token
    const dial = (authParam?: readonly [string, string]) =>
      buildHermesWebSocketUrl({
        path: '/api/ws',
        host: this.config.host,
        protocol: this.rest.baseUrl.startsWith('https') ? 'https:' : 'http:',
        params: this.config.profile ? { profile: this.config.profile } : {},
        authParam
      })

    const base = dial(this.config.authMode === 'token' && token ? ['token', token] : undefined)

    return resolveGatewayWsUrl(
      {
        // Session auth — OAuth *or* password — cannot put a credential on a
        // WebSocket upgrade, so it dials with a single-use ticket instead.
        // Minted here, immediately before the dial, because the TTL is 30
        // seconds and a phone waking from background has a stale everything.
        getGatewayWsUrl: async () => {
          if (this.config.authMode === 'token') return base

          const { ticket } = await this.rest.wsTicket()

          return dial(['ticket', ticket])
        }
      },
      { authMode: this.config.authMode, profile: this.config.profile ?? null, wsUrl: base }
    )
  }

  /**
   * Read `approvals.timeout` once per connection so an approval can carry a
   * real deadline (§7.6).
   *
   * Best-effort by design: a host that does not report it leaves the countdown
   * absent rather than inventing one from the documented default, since the
   * whole point of the number is that it is the host's, not ours.
   */
  private async loadApprovalTimeout(): Promise<void> {
    try {
      const record = (await this.rest.configRecord()) as Record<string, unknown>
      const nested = (record.approvals as { timeout?: unknown } | undefined)?.timeout
      const seconds = Number(record['approvals.timeout'] ?? nested)

      this.mapContext.approvalTimeoutMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
    } catch {
      this.mapContext.approvalTimeoutMs = null
    }
  }

  private dispatch(event: GatewayEvent): void {
    this.mapContext.now = Date.now()

    // Activity and Logs are agent-scoped: every event reaches them, including
    // ones for a session nobody has open.
    if (this.eventSinks.size) {
      const record = toEventRecord(event, this.mapContext.now)

      for (const sink of this.eventSinks) sink(record)
    }

    const runtimeId = event.session_id

    if (!runtimeId) return

    // Events are keyed by runtime id; the UI subscribes by stored id. Fall back
    // to the raw id so a session the app only knows by one name still matches.
    const sessionId = this.storedByRuntime.get(runtimeId) ?? runtimeId
    const sinks = this.sinks.get(sessionId)

    if (!sinks?.size) return

    for (const update of mapGatewayEvent(event, this.mapContext)) {
      for (const sink of sinks) sink(update)
    }
  }

  // --- Sessions -----------------------------------------------------------

  async listSessions(query?: SessionQuery): Promise<SessionSummary[]> {
    console.log('[HermesBackend.listSessions] profile:', this.config.profile)
    const page = await this.rest.listSessions(query?.limit ?? 50, query?.offset ?? 0)
    console.log('[HermesBackend.listSessions] fetched', page.sessions.length, 'sessions')
    return page.sessions.map(toSessionSummary)
  }

  async createSession(opts: NewSessionOptions): Promise<SessionId> {
    const created = await this.gateway.request<{ session_id: string; stored_session_id?: string }>('session.create', {
      cwd: opts.cwd ?? '',
      ...(opts.model ? { model: opts.model } : {}),
      ...(this.config.profile ? { profile: this.config.profile } : {})
    })

    const stored = created.stored_session_id ?? created.session_id

    // Create hands back both ids, so this session never needs a resume to be
    // promptable — seed the mapping while we have it.
    this.rememberRuntime(stored, created.session_id)

    return stored
  }

  async loadSession(id: SessionId): Promise<SessionTranscript> {
    // One session, fetched as one session. Reading a page and searching it for
    // this id both sent `limit=200` — past the server's cap of 100, so it 422'd
    // — and pulled dozens of unrelated rows to use one.
    //
    // Both calls tolerate a 404, because a *brand-new* session genuinely is not
    // there: Hermes persists a session once it has content, so everything about
    // one created seconds ago 404s until its first turn lands. That is an empty
    // transcript, not a failure, and reporting it as one left an error banner
    // pinned above a chat that was working perfectly.
    const [messages, info] = await Promise.all([
      this.rest.sessionMessages(id).catch(emptyOn404),
      this.rest.session(id).catch(() => null),
      // Resume alongside the transcript, not for the runtime id — for the
      // approval snapshot it carries. Idempotent and cheap on a live session,
      // and it is the only way to learn about a prompt raised while the app was
      // closed. A failure here must not fail the load.
      this.runtimeIdFor(id).catch(() => null)
    ])

    return {
      sessionId: id,
      // Same fallback the list uses, so a session does not change name when you
      // open it.
      title: usableTitle(info?.title, (info?.preview ?? '').trim()),
      model: info?.model ?? null,
      entries: toTranscriptEntries(messages.messages),
      usage: info
        ? { inputTokens: info.input_tokens, outputTokens: info.output_tokens, costUsd: info.actual_cost_usd ?? undefined }
        : null,
      pendingApproval: this.pendingApprovals.get(id) ?? null,
      pendingClarify: this.pendingClarifies.get(id) ?? null
    }
  }

  deleteSession(id: SessionId): Promise<void> {
    return this.rest.deleteSession(id)
  }

  renameSession(id: SessionId, title: string): Promise<void> {
    return this.rest.updateSession(id, { title })
  }

  async searchSessions(query: string): Promise<SessionSearchHit[]> {
    if (!query.trim()) return []

    const response = await this.rest.searchSessions(query)

    return response.results.map(result => toSearchHit(result, query))
  }

  // --- Turns --------------------------------------------------------------

  async prompt(id: SessionId, content: ContentBlock[]): Promise<PromptResult> {
    const text = content
      .filter(block => block.kind === 'text')
      .map(block => block.text ?? '')
      .join('\n')
      .trim()

    const images = content.filter(block => block.kind === 'image' && block.uri)

    if (!text && images.length === 0) return NO_IMAGES

    const runtimeId = await this.runtimeIdFor(id)

    // Attach, then submit — in that order, and awaited.
    //
    // The gateway has no way to take an image *in* `prompt.submit`. An attach
    // queues the file on the session and the next submit consumes the queue
    // (`_enqueue_prompt` claims `attached_images` and clears it), so a submit
    // that overtakes an attach sends the text alone and leaves the image to
    // ambush whatever the user types next.
    const stored: StoredImage[] = []

    for (const block of images) {
      const name = await this.attachImage(runtimeId, block)

      if (name) stored.push({ name, sourceUri: block.uri as string })
    }

    await this.gateway.request(
      'prompt.submit',
      // An image with no caption is a real message — "what is this?" is implied
      // — but the host reads an empty `text` as nothing to do. Say the implied
      // thing rather than dropping a turn the user meant to send.
      { session_id: runtimeId, text: text || IMPLIED_IMAGE_PROMPT },
      PROMPT_SUBMIT_TIMEOUT_MS
    )

    return { images: stored }
  }

  /**
   * Upload one image and return the filename the host stored it as.
   *
   * `image.attach_bytes` is the remote-client path: the phone's file exists
   * only on the phone, so the bytes go up base64 and the gateway writes them
   * into its own images dir. Everything past that — the model's native image
   * content, the `@image:` ref on the persisted turn — is the same pipeline a
   * local paste goes through.
   */
  private async attachImage(runtimeId: string, block: ContentBlock): Promise<string | null> {
    const uri = block.uri as string
    const base64 = uri.startsWith('data:') ? uri.slice(uri.indexOf(',') + 1) : await new File(uri).base64()

    const attached = await this.gateway.request<{ attached?: boolean; path?: string }>(
      'image.attach_bytes',
      {
        session_id: runtimeId,
        content_base64: base64,
        ...(block.name ? { filename: block.name } : {})
      },
      IMAGE_ATTACH_TIMEOUT_MS
    )

    if (!attached?.path) return null

    return attached.path.replace(/^.*[/\\]/, '')
  }

  async cancel(id: SessionId): Promise<void> {
    const runtimeId = this.runtimeByStored.get(id)

    // Nothing to interrupt if it was never resumed — and resuming here just to
    // cancel would start the very session the user is trying to stop.
    if (!runtimeId) return

    await this.gateway.request('session.interrupt', { session_id: runtimeId })
  }

  async respondToPermission(reqId: string, outcome: PermissionOutcome, sessionId?: SessionId): Promise<void> {
    await this.gateway.request('approval.respond', {
      choice: OUTCOME_TO_CHOICE[outcome],
      request_id: reqId,
      ...(sessionId ? { session_id: sessionId } : {})
    })
  }

  async respondToClarify(reqId: string, answer: string): Promise<void> {
    await this.gateway.request('clarify.respond', { request_id: reqId, answer })
  }

  // --- Live stream --------------------------------------------------------

  subscribe(id: SessionId, sink: (u: SessionUpdate) => void): Unsubscribe {
    // Resolve the runtime id now rather than at first prompt, so a turn started
    // from elsewhere — a cron job, the desktop app — streams into this view too.
    void this.runtimeIdFor(id).catch(() => undefined)

    let sinks = this.sinks.get(id)

    if (!sinks) {
      sinks = new Set()
      this.sinks.set(id, sinks)
    }

    sinks.add(sink)

    return () => {
      sinks.delete(sink)

      if (sinks.size === 0) this.sinks.delete(id)
    }
  }

  subscribeEvents(sink: (record: EventRecord) => void): Unsubscribe {
    this.eventSinks.add(sink)

    return () => {
      this.eventSinks.delete(sink)
    }
  }

  // --- Capability-gated surfaces -----------------------------------------

  /**
   * `/api/logs` returns raw log lines, not structured events. They are parsed
   * into rows on a best-effort basis; the live socket is the authoritative
   * source of structured events, and this is what fills the screen before any
   * arrive.
   */
  async listEvents(limit = 200): Promise<EventRecord[]> {
    const { lines } = await this.rest.logs(limit)

    return lines
      .filter(line => line.trim().length > 0)
      .map((line, index) => parseLogLine(line, index))
      .reverse()
  }

  async listMcpServers(): Promise<McpServerStatus[]> {
    const { servers } = await this.rest.mcpServers()

    return servers.map(server => ({
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      toolCount: server.tools?.length ?? 0,
      tools: server.tools
    }))
  }

  async listKanbanBoard(): Promise<KanbanBoard> {
    return this.rest.kanbanBoard()
  }

  async updateKanbanCard(id: string, update: KanbanCardUpdate): Promise<void> {
    await this.rest.kanbanCardUpdate(id, update)
  }

  async createKanbanCard(card: KanbanCardCreate): Promise<void> {
    await this.rest.kanbanCardCreate(card)
  }

  async listSkills(): Promise<SkillSummary[]> {
    const skills = await this.rest.skills()

    return skills.map(skill => ({
      name: skill.name,
      category: skill.category,
      description: skill.description,
      enabled: skill.enabled,
      provenance: skill.provenance ?? 'unknown'
    }))
  }

  async listModels(): Promise<ModelOption[]> {
    const [options, info] = await Promise.all([this.rest.modelOptions(), this.rest.modelInfo()])

    return (options.providers ?? []).flatMap(provider =>
      (provider.models ?? []).map(model => ({
        id: model,
        provider: provider.slug,
        selected: model === info.model && provider.slug === info.provider
      }))
    )
  }

  async setModel(option: ModelOption): Promise<void> {
    await this.rest.request('/api/model/set', {
      method: 'POST',
      body: { scope: 'main', provider: option.provider, model: option.id }
    })
  }

  async getApprovalPolicy(): Promise<ApprovalPolicy> {
    const result = await this.gateway.request<{ value?: string }>('config.get', { key: APPROVAL_MODE_KEY })

    return POLICY_FROM_MODE[String(result?.value ?? '')] ?? 'destructive'
  }

  async setApprovalPolicy(policy: ApprovalPolicy): Promise<void> {
    await this.gateway.request('config.set', { key: APPROVAL_MODE_KEY, value: POLICY_TO_MODE[policy] })
  }

  /**
   * Settings, rendered from the schema the server publishes.
   *
   * The schema describes the fields; `/api/config` holds the values. Neither is
   * useful alone, so they are read together and zipped here — a field the
   * schema declares but the config has not set yet shows as empty rather than
   * being dropped.
   */
  async listConfigFields(): Promise<ConfigField[]> {
    const [schema, record] = await Promise.all([this.rest.configSchema(), this.rest.configRecord()])

    const order = schema.category_order ?? []

    return Object.entries(schema.fields)
      .map(([key, field]) => ({
        key,
        category: field.category ?? 'General',
        description: field.description ?? '',
        type: field.type ?? 'string',
        options: (field.options ?? []).map(option => String(option)),
        value: record[key] === undefined || record[key] === null ? '' : String(record[key])
      }))
      .sort((a, b) => {
        const byCategory = categoryRank(a.category, order) - categoryRank(b.category, order)

        return byCategory !== 0 ? byCategory : a.key.localeCompare(b.key)
      })
  }

  /**
   * Written through the gateway's per-key `config.set`, not `PUT /api/config`.
   *
   * The REST route replaces the whole config record, so writing one field
   * through it means read-modify-write — and any setting changed elsewhere
   * between the read and the write is silently reverted. Per-key avoids that
   * entirely. Values are strings because that is what the RPC takes.
   */
  async setConfigValue(key: string, value: string): Promise<void> {
    await this.gateway.request('config.set', { key, value })
  }

  async listCronJobs(): Promise<CronJobSummary[]> {
    const jobs = await this.rest.cronJobs()

    return jobs.map(job => ({
      id: job.id,
      name: (job.name ?? '').trim() || job.id,
      schedule: job.schedule_display ?? job.schedule?.display ?? job.schedule?.expr ?? 'unscheduled',
      enabled: job.enabled,
      nextRunAt: parseTimestamp(job.next_run_at),
      lastRunAt: parseTimestamp(job.last_run_at),
      lastError: job.last_error ?? null,
      model: job.model ?? null
    }))
  }

  async setCronJobEnabled(id: string, enabled: boolean): Promise<void> {
    await (enabled ? this.rest.cronResume(id) : this.rest.cronPause(id))
  }

  async triggerCronJob(id: string): Promise<void> {
    await this.rest.cronTrigger(id)
  }

  async registerPushDevice(registration: PushDeviceRegistration): Promise<void> {
    await this.rest.registerPush({
      token: registration.token,
      agentId: registration.agentId,
      platform: registration.platform,
      label: registration.label,
      prefs: registration.prefs
    })
  }

  async unregisterPushDevice(token: string): Promise<void> {
    await this.rest.unregisterPush(token)
  }

  async transcribe(dataUrl: string, mimeType: string): Promise<string> {
    const result = await this.rest.transcribe(dataUrl, mimeType)

    if (!result.ok) throw new Error('The agent could not transcribe that clip.')

    return result.transcript
  }

  async speak(text: string): Promise<{ dataUrl: string; mimeType: string }> {
    const result = await this.rest.speak(text)

    if (!result.ok) throw new Error('The agent could not synthesise that text.')

    return { dataUrl: result.data_url, mimeType: result.mime_type }
  }
}

/** Hermes's own key and vocabulary for the approval policy. */
const APPROVAL_MODE_KEY = 'approvals.mode'

const POLICY_TO_MODE: Record<ApprovalPolicy, string> = {
  nothing: 'off',
  destructive: 'smart',
  every_tool: 'manual'
}

const POLICY_FROM_MODE: Record<string, ApprovalPolicy> = {
  off: 'nothing',
  smart: 'destructive',
  manual: 'every_tool'
}

function categoryRank(category: string, order: string[]): number {
  const index = order.indexOf(category)

  // Categories the server did not rank sort after the ones it did, rather than
  // jumping to the front on a -1.
  return index === -1 ? order.length : index
}

/** Cron timestamps come back as ISO strings, not epochs. */
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A missing transcript is empty, not broken — but only for a 404. Anything else
 * (401 after a session expires, 500, a dead host) still surfaces, because those
 * are failures the user needs to know about.
 */
function emptyOn404(error: unknown): { messages: [] ; session_id: string } {
  if (error instanceof HermesRestError && error.status === 404) {
    return { messages: [], session_id: '' }
  }

  throw error
}

const LOG_LINE = /^(?<time>[\d-]{10}[ T][\d:]{8})\S*\s+(?<level>[A-Z]+)\s+(?<rest>.*)$/

/** Best-effort structure over a raw log line; unparseable lines still show. */
function parseLogLine(line: string, index: number): EventRecord {
  const match = LOG_LINE.exec(line)
  const at = match?.groups?.time ? Date.parse(match.groups.time.replace(' ', 'T')) : Number.NaN
  const level = match?.groups?.level ?? ''
  const rest = match?.groups?.rest ?? line

  return {
    id: `log-${index}`,
    at: Number.isNaN(at) ? 0 : at,
    name: level ? level.toLowerCase() : 'log',
    detail: rest.trim(),
    status: level === 'ERROR' || level === 'CRITICAL' ? 'error' : level === 'WARNING' ? 'info' : 'info',
    payload: line
  }
}
