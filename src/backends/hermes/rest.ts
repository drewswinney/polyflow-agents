/**
 * Thin REST client for `hermes serve`, typed against the vendored upstream
 * types (`vendor/hermes/types/hermes.ts`).
 *
 * Why not vendor `apps/desktop/src/hermes.ts` wholesale, as §9 first assumed:
 * every call in it routes through `window.hermesDesktop.api` — the Electron IPC
 * bridge — and its connection descriptor comes from `window.hermesDesktop
 * .getConnection()`. It is the desktop app's *bridge*, not an HTTP client, so
 * there is nothing there to reuse on a phone. The types are the reusable half
 * and they carry the real maintenance cost. The desktop client is still
 * vendored, unreferenced, under `vendor/hermes/reference/` so `sync-upstream`
 * can diff endpoint shapes against it.
 */

import type {
  AnalyticsResponse,
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  ConfigSchemaResponse,
  CronJob,
  HermesConfig,
  HermesConfigRecord,
  LogsResponse,
  McpServerSummary,
  ModelInfoResponse,
  ModelOptionsResponse,
  PaginatedSessions,
  SessionMessagesResponse,
  SessionSearchResponse,
  SkillInfo,
  StatusResponse
} from '@hermes/types'

export interface HermesRestConfig {
  /** `host:port`, no scheme. */
  host: string
  /** Bearer token, for a host running a token-only auth provider. */
  token?: string
  /** Username/password credentials, for the built-in `basic` provider. */
  password?: { provider: string; username: string; password: string }
  /** Hermes profile to scope profile-aware endpoints to; null → primary. */
  profile?: string | null
  /** Defaults to https for anything that is not a loopback host. */
  secure?: boolean
  fetchImpl?: typeof fetch
}

export interface AuthProviderInfo {
  name: string
  displayName: string
  supportsPassword: boolean
}

export class HermesRestError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, url: string) {
    super(`Hermes API ${status} on ${url}${body ? `: ${body.slice(0, 200)}` : ''}`)
    this.name = 'HermesRestError'
    this.status = status
    this.body = body
  }
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

function isLoopback(host: string): boolean {
  return LOOPBACK.test(host)
}

/**
 * Find out whether a host speaks TLS, by asking it.
 *
 * There is no rule about the *address* that gets this right. `hermes serve`
 * speaks plain HTTP; a tailnet address (100.64.0.0/10) is neither loopback nor
 * public; and any of them could be behind a TLS terminator. So the add-agent
 * flow probes both schemes against `/api/health` — which is public — and
 * remembers the answer on the agent.
 *
 * HTTPS is tried first: guessing wrong in that direction fails safely, whereas
 * defaulting to plaintext against a TLS host would send a password in the clear
 * before anything noticed.
 */
export async function probeScheme(host: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  for (const secure of [true, false]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)

    try {
      const response = await fetchImpl(`${secure ? 'https' : 'http'}://${host}/api/health`, {
        signal: controller.signal
      })

      // Any HTTP answer proves the scheme, including a 4xx — the endpoint being
      // reachable is the signal, not what it says.
      if (response.status > 0) return secure
    } catch {
      // Wrong scheme, or nothing there. Try the other one before giving up.
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(`Nothing answered on ${host} over https or http.`)
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Audio endpoints scale with payload size, between three and ten minutes. */
function audioTimeoutMs(estimate: number): number {
  return Math.min(600_000, Math.max(180_000, Math.ceil(estimate)))
}

export class HermesRest {
  private readonly config: HermesRestConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: HermesRestConfig) {
    this.config = config
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  get baseUrl(): string {
    const scheme = (this.config.secure ?? !isLoopback(this.config.host)) ? 'https' : 'http'

    return `${scheme}://${this.config.host}`
  }

  /** WS origin for the same host, used when minting the gateway URL (§5.3). */
  get wsBaseUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws')
  }

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${this.withProfile(path)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    if (init.signal) {
      if (init.signal.aborted) controller.abort()
      else init.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const response = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          // Only sent when a bearer token exists. Password auth mints a session
          // cookie instead, which React Native's fetch carries automatically
          // from the platform cookie store.
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        credentials: 'include',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      })

      const text = await response.text()

      if (!response.ok) {
        throw new HermesRestError(response.status, text, url)
      }

      return (text ? JSON.parse(text) : undefined) as T
    } finally {
      clearTimeout(timer)
    }
  }

  /** Profile-scoped endpoints take the profile as a query param, as upstream does. */
  private withProfile(path: string): string {
    const profile = this.config.profile

    if (!profile) return path

    return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
  }

  // --- Sessions -----------------------------------------------------------

  listSessions(limit = 50, offset = 0, minMessages = 1): Promise<PaginatedSessions> {
    return this.request<PaginatedSessions>(
      `/api/sessions?limit=${limit}&offset=${offset}&min_messages=${Math.max(0, minMessages)}`,
      { timeoutMs: 60_000 }
    )
  }

  sessionMessages(id: string, limit?: number): Promise<SessionMessagesResponse> {
    const suffix = limit ? `?limit=${limit}&order=oldest` : ''

    return this.request<SessionMessagesResponse>(`/api/sessions/${encodeURIComponent(id)}/messages${suffix}`)
  }

  searchSessions(query: string): Promise<SessionSearchResponse> {
    return this.request<SessionSearchResponse>(`/api/sessions/search?q=${encodeURIComponent(query)}`)
  }

  deleteSession(id: string): Promise<void> {
    return this.request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  updateSession(id: string, updates: Record<string, unknown>): Promise<void> {
    return this.request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates })
  }

  // --- Status, config, model ---------------------------------------------

  status(): Promise<StatusResponse> {
    return this.request<StatusResponse>('/api/status', { timeoutMs: 10_000 })
  }

  hermesConfig(): Promise<HermesConfig> {
    return this.request<HermesConfig>('/api/config')
  }

  configSchema(): Promise<ConfigSchemaResponse> {
    return this.request<ConfigSchemaResponse>('/api/config/schema')
  }

  /** The flat key → value record the schema describes. */
  configRecord(): Promise<HermesConfigRecord> {
    return this.request<HermesConfigRecord>('/api/config')
  }

  modelInfo(): Promise<ModelInfoResponse> {
    return this.request<ModelInfoResponse>('/api/model/info')
  }

  modelOptions(): Promise<ModelOptionsResponse> {
    return this.request<ModelOptionsResponse>('/api/model/options')
  }

  // --- Extras -------------------------------------------------------------

  skills(): Promise<SkillInfo[]> {
    return this.request<SkillInfo[]>('/api/skills')
  }

  mcpServers(): Promise<{ servers: McpServerSummary[] }> {
    return this.request<{ servers: McpServerSummary[] }>('/api/mcp/servers')
  }

  cronJobs(): Promise<CronJob[]> {
    return this.request<CronJob[]>('/api/cron/jobs', { timeoutMs: 60_000 })
  }

  cronPause(id: string): Promise<void> {
    return this.request<void>(`/api/cron/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' })
  }

  cronResume(id: string): Promise<void> {
    return this.request<void>(`/api/cron/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' })
  }

  /**
   * The trigger endpoint deliberately waits for the whole job so its response
   * reflects the persisted result, and an agent job can run for a long time.
   * Upstream allows it a full day; a phone should not hold a request open that
   * long, so this caps at five minutes and lets the event stream report the rest.
   */
  cronTrigger(id: string): Promise<void> {
    return this.request<void>(`/api/cron/jobs/${encodeURIComponent(id)}/trigger`, {
      method: 'POST',
      timeoutMs: 300_000
    })
  }

  transcribe(dataUrl: string, mimeType: string): Promise<AudioTranscriptionResponse> {
    return this.request<AudioTranscriptionResponse>('/api/audio/transcribe', {
      method: 'POST',
      body: { data_url: dataUrl, mime_type: mimeType },
      // Transcription blocks on provider STT and base64 handling; the clip's
      // own length is the only signal for how long that takes.
      timeoutMs: audioTimeoutMs(dataUrl.length * 0.1)
    })
  }

  speak(text: string): Promise<AudioSpeakResponse> {
    return this.request<AudioSpeakResponse>('/api/audio/speak', {
      method: 'POST',
      body: { text },
      timeoutMs: audioTimeoutMs(text.length * 35)
    })
  }

  analytics(days = 7): Promise<AnalyticsResponse> {
    return this.request<AnalyticsResponse>(`/api/analytics/usage?days=${days}`)
  }

  logs(limit = 200): Promise<LogsResponse> {
    return this.request<LogsResponse>(`/api/logs?limit=${limit}`)
  }

  /**
   * Single-use WebSocket ticket for any session-gated gateway — OAuth *or*
   * password. TTL is 30 seconds, so this is minted immediately before dialling
   * and never cached (§5.3).
   *
   * The reason it exists is worth remembering: a WebSocket upgrade cannot carry
   * an `Authorization` header, so a session-authenticated client has no way to
   * present its credential except as a query param.
   */
  wsTicket(): Promise<{ ticket: string; ttl_seconds: number }> {
    return this.request<{ ticket: string; ttl_seconds: number }>('/api/auth/ws-ticket', {
      method: 'POST',
      timeoutMs: 10_000
    })
  }

  // --- Auth ---------------------------------------------------------------

  /**
   * Which auth providers the host offers. Public — no credential needed — so
   * this is how the app discovers what to ask the user for before it has one.
   */
  async authProviders(): Promise<AuthProviderInfo[]> {
    const result = await this.request<{ providers?: Array<{ name: string; display_name: string; supports_password?: boolean }> }>(
      '/api/auth/providers',
      { timeoutMs: 10_000 }
    )

    return (result.providers ?? []).map(provider => ({
      name: provider.name,
      displayName: provider.display_name,
      supportsPassword: provider.supports_password === true
    }))
  }

  /**
   * Exchange username/password for a session.
   *
   * The server sets its session cookies on this response and returns only
   * `{ok, next}` — the access token is never in the body. That is why the rest
   * of this client sends `credentials: 'include'` rather than holding a token:
   * the credential lives in the platform cookie store, not in app memory.
   */
  async login(): Promise<void> {
    const credentials = this.config.password

    if (!credentials) throw new Error('No password credentials configured for this agent.')

    await this.request<{ ok: boolean; next?: string }>('/auth/password-login', {
      method: 'POST',
      body: {
        provider: credentials.provider,
        username: credentials.username,
        password: credentials.password
      },
      timeoutMs: 20_000
    })
  }
}
