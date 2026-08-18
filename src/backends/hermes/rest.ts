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
  token: string
  /** Hermes profile to scope profile-aware endpoints to; null → primary. */
  profile?: string | null
  /** Defaults to https for anything that is not a loopback host. */
  secure?: boolean
  fetchImpl?: typeof fetch
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
          Authorization: `Bearer ${this.config.token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
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
   * Single-use WebSocket ticket for OAuth-gated gateways. TTL is 30 seconds, so
   * this is minted immediately before dialling and never cached (§5.3).
   */
  wsTicket(): Promise<{ ticket: string }> {
    return this.request<{ ticket: string }>('/api/auth/ws-ticket', { method: 'POST', timeoutMs: 10_000 })
  }
}
