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
  type Capabilities,
  type ConnectionState,
  createObservable,
  type ContentBlock,
  type NewSessionOptions,
  type Observable,
  type PermissionOutcome,
  type SessionId,
  type SessionQuery,
  type SessionSearchHit,
  type SessionSummary,
  type SessionTranscript,
  type SessionUpdate,
  type Unsubscribe
} from '@/domain'

import { mapGatewayEvent, type MapContext } from './event-map'
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
    const sessionId = event.session_id

    if (!sessionId) return

    const sinks = this.sinks.get(sessionId)

    if (!sinks?.size) return

    this.mapContext.now = Date.now()

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
}
