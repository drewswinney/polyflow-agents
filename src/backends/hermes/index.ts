/**
 * The Hermes backend: REST for state, the JSON-RPC gateway for the live turn.
 *
 * The gateway client itself is upstream code, vendored unmodified
 * (`vendor/hermes/shared/json-rpc-gateway.ts`) — it already ships backoff-free
 * connect with a 15s timeout chosen so a sleep/wake reconnect cannot hang the
 * composer (§5.4), and `resolveGatewayWsUrl` already implements the
 * mint-then-dial contract the 30-second ticket TTL demands (§5.3).
 */

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
  type McpServerStatus,
  type ModelOption,
  type NewSessionOptions,
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
  type UsageSummary
} from '@/domain'

import { mapGatewayEvent, type MapContext, toEventRecord } from './event-map'
import { toSearchHit, toSessionSummary, toTranscriptEntries } from './normalize'
import { HermesRest, type HermesRestConfig } from './rest'

export { HermesRest, HermesRestError } from './rest'
export { mapGatewayEvent } from './event-map'

/**
 * `prompt.submit` is fire-and-forget — turn completion arrives as events, not
 * as the RPC return — so its ack timeout matches the backend's own agent-turn
 * ceiling rather than the generic default (upstream `hermes.ts`).
 */
const PROMPT_SUBMIT_TIMEOUT_MS = 1_800_000

/** Hermes reports nearly everything (§4.1). */
export const HERMES_CAPABILITIES: Capabilities = {
  sessions: { search: true, rename: true, pin: true },
  settings: { schemaDriven: true, model: true, providers: true },
  extras: { cron: true, skills: true, mcp: true, profiles: true },
  approvals: { requests: true, policy: true },
  activity: { spend: true, events: true },
  // Audio is request/response REST, not a duplex channel — push-to-talk only (§2.6, §7.9).
  media: { images: true, audioIn: true, audioOut: true }
}

const OUTCOME_TO_CHOICE: Record<PermissionOutcome, string> = {
  // Canonical gateway choices are `once | session | always | deny`.
  allow_once: 'once',
  allow_always: 'always',
  deny: 'deny'
}

export interface HermesBackendConfig extends HermesRestConfig {
  authMode: 'token' | 'oauth'
}

export class HermesBackend implements AgentBackend {
  readonly capabilities = HERMES_CAPABILITIES

  private readonly config: HermesBackendConfig
  private readonly rest: HermesRest
  private readonly gateway: JsonRpcGatewayClient
  private readonly state = createObservable<ConnectionState>('idle')
  private readonly sinks = new Map<SessionId, Set<(u: SessionUpdate) => void>>()
  private readonly eventSinks = new Set<(record: EventRecord) => void>()
  private readonly mapContext: MapContext = { now: 0, toolStartedAt: new Map() }
  private detachGateway: Unsubscribe | null = null

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
  }

  disconnect(): void {
    this.detachGateway?.()
    this.detachGateway = null
    this.gateway.close()
    this.state.set('closed')
  }

  /**
   * Mint the ticket immediately before dialling and never cache it: the TTL is
   * 30 seconds, and a phone waking from an hour in background has a stale
   * everything (§5.3).
   */
  private resolveWsUrl(): Promise<string> {
    const base = buildHermesWebSocketUrl({
      path: '/api/ws',
      host: this.config.host,
      protocol: this.rest.baseUrl.startsWith('https') ? 'https:' : 'http:',
      params: this.config.profile ? { profile: this.config.profile } : {},
      authParam: this.config.authMode === 'token' ? ['token', this.config.token] : undefined
    })

    return resolveGatewayWsUrl(
      {
        getGatewayWsUrl: async () => {
          if (this.config.authMode !== 'oauth') return base

          const { ticket } = await this.rest.wsTicket()

          return buildHermesWebSocketUrl({
            path: '/api/ws',
            host: this.config.host,
            protocol: this.rest.baseUrl.startsWith('https') ? 'https:' : 'http:',
            params: this.config.profile ? { profile: this.config.profile } : {},
            authParam: ['ticket', ticket]
          })
        }
      },
      { authMode: this.config.authMode, profile: this.config.profile ?? null, wsUrl: base }
    )
  }

  private dispatch(event: GatewayEvent): void {
    this.mapContext.now = Date.now()

    // Activity and Logs are agent-scoped: every event reaches them, including
    // ones for a session nobody has open.
    if (this.eventSinks.size) {
      const record = toEventRecord(event, this.mapContext.now)

      for (const sink of this.eventSinks) sink(record)
    }

    const sessionId = event.session_id

    if (!sessionId) return

    const sinks = this.sinks.get(sessionId)

    if (!sinks?.size) return

    for (const update of mapGatewayEvent(event, this.mapContext)) {
      for (const sink of sinks) sink(update)
    }
  }

  // --- Sessions -----------------------------------------------------------

  async listSessions(query?: SessionQuery): Promise<SessionSummary[]> {
    const page = await this.rest.listSessions(query?.limit ?? 50, query?.offset ?? 0)

    return page.sessions.map(toSessionSummary)
  }

  async createSession(opts: NewSessionOptions): Promise<SessionId> {
    const created = await this.gateway.request<{ session_id: string; stored_session_id?: string }>('session.create', {
      cwd: opts.cwd ?? '',
      ...(opts.model ? { model: opts.model } : {}),
      ...(this.config.profile ? { profile: this.config.profile } : {})
    })

    return created.stored_session_id ?? created.session_id
  }

  async loadSession(id: SessionId): Promise<SessionTranscript> {
    const [messages, info] = await Promise.all([
      this.rest.sessionMessages(id),
      this.rest.listSessions(200).then(page => page.sessions.find(session => session.id === id) ?? null)
    ])

    return {
      sessionId: id,
      title: (info?.title ?? '').trim() || 'Untitled session',
      model: info?.model ?? null,
      entries: toTranscriptEntries(messages.messages),
      usage: info
        ? { inputTokens: info.input_tokens, outputTokens: info.output_tokens, costUsd: info.actual_cost_usd ?? undefined }
        : null
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

  async prompt(id: SessionId, content: ContentBlock[]): Promise<void> {
    const text = content
      .filter(block => block.kind === 'text')
      .map(block => block.text ?? '')
      .join('\n')
      .trim()

    if (!text) return

    await this.gateway.request('prompt.submit', { session_id: id, text }, PROMPT_SUBMIT_TIMEOUT_MS)
  }

  async cancel(id: SessionId): Promise<void> {
    await this.gateway.request('session.interrupt', { session_id: id })
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

  async getUsage(): Promise<UsageSummary> {
    const analytics = await this.rest.analytics(1)
    const today = analytics.daily.at(-1) ?? null

    // `actual` is set when the provider quoted a price; `estimated` is Hermes's
    // own pricing-table math. Subscription auth quotes neither, which is why
    // both can legitimately be zero — reported as null rather than "$0.00".
    const spend = today ? today.actual_cost || today.estimated_cost : 0

    return {
      spendTodayUsd: spend > 0 ? spend : null,
      // Hermes exposes no per-day spend cap endpoint; the design's cap line has
      // nothing behind it, so it stays absent rather than invented.
      spendCapUsd: null,
      turnsToday: today?.api_calls ?? 0,
      tokensToday: today ? today.input_tokens + today.output_tokens : 0,
      latencyMs: null
    }
  }

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
