/**
 * The backend that proves the seam without a host (§4).
 *
 * It is not a toy: it exercises every branch the Chat screen has to survive —
 * token-level streaming, a thinking block, a tool call that settles, an
 * approval that blocks the turn, usage ticks and cancellation. Running the app
 * against this is how the UI gets built before §11 host prep exists.
 */

import {
  type AgentBackend,
  type Capabilities,
  type ConnectionState,
  createObservable,
  type ContentBlock,
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

export const MOCK_CAPABILITIES: Capabilities = {
  sessions: { search: true, rename: true, pin: true },
  settings: { schemaDriven: false, model: true, providers: false },
  extras: { cron: false, skills: true, mcp: true, profiles: false },
  approvals: { requests: true, policy: true },
  activity: { spend: true, events: true },
  media: { images: false, audioIn: false, audioOut: false }
}

const MINUTE = 60_000

interface MockSession extends SessionSummary {
  transcript: SessionTranscript
}

function seedSessions(now: number): MockSession[] {
  const rows: Array<Omit<MockSession, 'transcript'> & { reply: string }> = [
    {
      id: 'ses-zfs',
      title: 'ZFS scrub on tank',
      preview: 'Waiting on your answer before destroying the stale snapshots',
      updatedAt: now - 2 * MINUTE,
      pinned: true,
      unread: true,
      model: 'sonnet-4.5',
      messageCount: 14,
      blockedOn: 'approval',
      reply: 'The scrub finished clean. 110 stale snapshots are left over from the failed replication.'
    },
    {
      id: 'ses-proxmox',
      title: 'Proxmox backup window',
      preview: 'Moved the nightly job to 03:15 so it stops overlapping the scrub',
      updatedAt: now - 48 * MINUTE,
      pinned: false,
      unread: false,
      model: 'sonnet-4.5',
      messageCount: 22,
      blockedOn: null,
      reply: 'Backup window moved to 03:15. The scrub now has a clear four-hour run.'
    },
    {
      id: 'ses-homeassistant',
      title: 'Home Assistant MCP is flapping',
      preview: 'Six reconnect attempts in the last hour, all ECONNREFUSED',
      updatedAt: now - 5 * 60 * MINUTE,
      pinned: false,
      unread: false,
      model: 'haiku-4.5',
      messageCount: 8,
      blockedOn: null,
      reply: 'The MCP server is refusing connections. Its container exited 12 minutes ago.'
    }
  ]

  return rows.map(({ reply, ...summary }) => ({
    ...summary,
    transcript: {
      sessionId: summary.id,
      title: summary.title,
      model: summary.model,
      usage: { inputTokens: 18_400, outputTokens: 2_140, contextTokens: 18_400, costUsd: 0.21 },
      entries: [
        {
          kind: 'message',
          id: `${summary.id}-u1`,
          role: 'user',
          text: summary.title,
          at: summary.updatedAt - MINUTE
        },
        {
          kind: 'message',
          id: `${summary.id}-a1`,
          role: 'agent',
          text: reply,
          at: summary.updatedAt
        }
      ]
    }
  }))
}

const REPLY_TOKENS = [
  'Checked ',
  'the ',
  'pool ',
  'first — ',
  'tank ',
  'is ',
  'healthy, ',
  'no ',
  'read ',
  'or ',
  'checksum ',
  'errors. ',
  'The ',
  '110 ',
  'stale ',
  'snapshots ',
  'are ',
  'all ',
  'from ',
  'the ',
  'replication ',
  'that ',
  'failed ',
  'on ',
  'Tuesday.'
]

/** Wall-clock helper so the whole script can be sped up in tests. */
const tick = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export class MockBackend implements AgentBackend {
  readonly capabilities = MOCK_CAPABILITIES

  private readonly state = createObservable<ConnectionState>('idle')
  private readonly sinks = new Map<SessionId, Set<(u: SessionUpdate) => void>>()
  private readonly eventSinks = new Set<(record: EventRecord) => void>()
  private readonly cancelled = new Set<SessionId>()
  private sessions: MockSession[]
  private models: ModelOption[] = [
    { id: 'sonnet-4.5', provider: 'anthropic', selected: true },
    { id: 'opus-4.5', provider: 'anthropic', selected: false },
    { id: 'haiku-4.5', provider: 'anthropic', selected: false },
    { id: 'gpt-4o-mini', provider: 'openai', selected: false }
  ]

  /** Set false to skip the approval beat — used by the empty-agent fixture. */
  constructor(private readonly options: { withApproval?: boolean; seed?: boolean } = {}) {
    this.sessions = options.seed === false ? [] : seedSessions(Date.now())
  }

  get connectionState(): Observable<ConnectionState> {
    return this.state
  }

  async connect(): Promise<void> {
    this.state.set('connecting')
    await tick(180)
    this.state.set('open')
  }

  disconnect(): void {
    this.state.set('closed')
  }

  async listSessions(query?: SessionQuery): Promise<SessionSummary[]> {
    await tick(120)

    return this.sessions.map(({ transcript, ...summary }) => summary)
  }

  async createSession(opts: NewSessionOptions): Promise<SessionId> {
    const id = `ses-${Date.now().toString(36)}`
    const now = Date.now()

    this.sessions = [
      {
        id,
        title: opts.title ?? 'New session',
        preview: '',
        updatedAt: now,
        pinned: false,
        unread: false,
        model: opts.model ?? 'sonnet-4.5',
        messageCount: 0,
        blockedOn: null,
        transcript: { sessionId: id, title: opts.title ?? 'New session', model: opts.model ?? 'sonnet-4.5', entries: [], usage: null }
      },
      ...this.sessions
    ]

    return id
  }

  async loadSession(id: SessionId): Promise<SessionTranscript> {
    await tick(90)
    const session = this.sessions.find(row => row.id === id)

    if (!session) throw new Error(`No such session: ${id}`)

    return session.transcript
  }

  async deleteSession(id: SessionId): Promise<void> {
    this.sessions = this.sessions.filter(session => session.id !== id)
  }

  async renameSession(id: SessionId, title: string): Promise<void> {
    const session = this.sessions.find(row => row.id === id)

    if (session) {
      session.title = title
      session.transcript.title = title
    }
  }

  async searchSessions(query: string): Promise<SessionSearchHit[]> {
    await tick(80)
    const needle = query.trim().toLowerCase()

    if (!needle) return []

    return this.sessions
      .filter(session => `${session.title} ${session.preview}`.toLowerCase().includes(needle))
      .map(session => {
        const snippet = session.preview || session.title
        const matchStart = Math.max(0, snippet.toLowerCase().indexOf(needle))

        return {
          sessionId: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          snippet,
          matchStart,
          matchEnd: matchStart + needle.length
        }
      })
  }

  async prompt(id: SessionId, content: ContentBlock[]): Promise<void> {
    this.cancelled.delete(id)
    const text = content.map(block => block.text ?? '').join(' ').trim()
    const session = this.sessions.find(row => row.id === id)

    if (session) {
      session.preview = text
      session.updatedAt = Date.now()
      session.messageCount += 1
    }

    void this.runTurn(id)
  }

  async cancel(id: SessionId): Promise<void> {
    this.cancelled.add(id)
    this.emit(id, { kind: 'turn_complete', stopReason: 'cancelled' })
  }

  async respondToPermission(reqId: string, outcome: PermissionOutcome, sessionId?: SessionId): Promise<void> {
    if (!sessionId) return

    this.emit(sessionId, {
      kind: 'tool_call_update',
      id: 'call-zfs-destroy',
      status: outcome === 'deny' ? 'error' : 'ok',
      output: outcome === 'deny' ? 'Denied by the operator.' : 'destroyed 110 snapshots · freed 412G'
    })
    this.emit(sessionId, { kind: 'turn_complete', stopReason: 'end_turn' })
  }

  async respondToClarify(): Promise<void> {
    // Clarify is not part of the mock script yet.
  }

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

  async getUsage(): Promise<UsageSummary> {
    await tick(120)

    return { spendTodayUsd: 1.84, spendCapUsd: 10, turnsToday: 37, tokensToday: 214_800, latencyMs: 28 }
  }

  async listEvents(limit = 200): Promise<EventRecord[]> {
    await tick(100)
    const now = Date.now()

    const rows: Array<[string, string, EventRecord['status'], number]> = [
      ['tool.complete', 'shell · zpool status · 412ms', 'ok', 2],
      ['approval.request', 'shell · zfs destroy -r tank/backup@repl-*', 'info', 3],
      ['cron.fired', 'nightly-backup · started', 'ok', 48],
      ['mcp.error', 'home-assistant · ECONNREFUSED', 'error', 61],
      ['session.resumed', 'Proxmox backup window', 'info', 92]
    ]

    return rows.slice(0, limit).map(([name, detail, status, minutesAgo], index) => ({
      id: `evt-${index}`,
      at: now - minutesAgo * MINUTE,
      name,
      detail,
      status,
      payload: { name, detail, mock: true }
    }))
  }

  async listMcpServers(): Promise<McpServerStatus[]> {
    await tick(90)

    return [
      { name: 'home-assistant', enabled: true, transport: 'stdio', toolCount: 9, tools: ['light', 'climate'] },
      { name: 'filesystem', enabled: true, transport: 'stdio', toolCount: 4, tools: ['read', 'write'] },
      { name: 'github', enabled: false, transport: 'http', toolCount: 0, tools: null }
    ]
  }

  async listSkills(): Promise<SkillSummary[]> {
    await tick(90)

    return [
      { name: 'zfs-maintenance', category: 'ops', description: 'Scrub, snapshot and prune tank', enabled: true, provenance: 'agent' },
      { name: 'proxmox', category: 'ops', description: 'Backup windows and VM lifecycle', enabled: true, provenance: 'hub' },
      { name: 'summarise', category: 'writing', description: 'Condense long output', enabled: false, provenance: 'bundled' }
    ]
  }

  async listModels(): Promise<ModelOption[]> {
    await tick(90)

    return this.models
  }

  async setModel(option: ModelOption): Promise<void> {
    this.models = this.models.map(model => ({ ...model, selected: model.id === option.id }))
  }

  private emit(id: SessionId, update: SessionUpdate): void {
    for (const sink of this.sinks.get(id) ?? []) sink(update)

    // Everything that happens in a turn is also an event — that is what makes
    // Activity and Logs live rather than a periodic poll.
    if (this.eventSinks.size) {
      for (const sink of this.eventSinks) sink(toEventRecord(update))
    }
  }

  private stopped(id: SessionId): boolean {
    return this.cancelled.has(id)
  }

  /** The scripted turn: think → stream → tool → approval → settle. */
  private async runTurn(id: SessionId): Promise<void> {
    await tick(300)
    if (this.stopped(id)) return

    for (const chunk of ['Reading the pool status', ' and the snapshot list']) {
      this.emit(id, { kind: 'agent_thought_chunk', text: chunk })
      await tick(220)
      if (this.stopped(id)) return
    }

    this.emit(id, {
      kind: 'tool_call',
      call: {
        id: 'call-zpool-status',
        name: 'shell',
        summary: 'zpool status tank',
        status: 'running',
        startedAt: Date.now()
      }
    })

    await tick(700)
    if (this.stopped(id)) return

    this.emit(id, {
      kind: 'tool_call_update',
      id: 'call-zpool-status',
      status: 'ok',
      output: '  pool: tank\n state: ONLINE\n  scan: scrub repaired 0B in 03:41:12'
    })

    for (const token of REPLY_TOKENS) {
      this.emit(id, { kind: 'agent_message_chunk', text: token })
      await tick(45)
      if (this.stopped(id)) return
    }

    this.emit(id, {
      kind: 'usage',
      usage: { inputTokens: 18_412, outputTokens: 2_207, contextTokens: 18_412, costUsd: 0.22 }
    })

    if (this.options.withApproval === false) {
      this.emit(id, { kind: 'turn_complete', stopReason: 'end_turn' })

      return
    }

    await tick(400)
    if (this.stopped(id)) return

    this.emit(id, {
      kind: 'tool_call',
      call: {
        id: 'call-zfs-destroy',
        name: 'shell',
        summary: 'zfs destroy -r tank/backup@repl-*',
        status: 'pending',
        startedAt: Date.now(),
        held: true
      }
    })

    this.emit(id, {
      kind: 'permission_request',
      req: {
        id: 'req-1',
        sessionId: id,
        tool: 'shell',
        command: 'zfs destroy -r tank/backup@repl-2026-08-11',
        description:
          'This permanently removes 110 snapshots on hermes. Nothing else references them, and the data they hold cannot be recovered afterwards.',
        sudo: true,
        allowPermanent: true,
        expiresAt: null
      }
    })
  }
}

/** A normalised update, described the way the event log wants it. */
function toEventRecord(update: SessionUpdate): EventRecord {
  const at = Date.now()
  const base = { id: `${update.kind}-${at}-${Math.trunc(Math.random() * 1e6)}`, at }

  switch (update.kind) {
    case 'tool_call':
      return { ...base, name: 'tool.start', detail: `${update.call.name} · ${update.call.summary}`, status: 'info', payload: update.call }
    case 'tool_call_update':
      return {
        ...base,
        name: 'tool.complete',
        detail: `${update.id} · ${update.status}`,
        status: update.status === 'error' ? 'error' : 'ok',
        payload: update
      }
    case 'permission_request':
      return { ...base, name: 'approval.request', detail: update.req.command, status: 'info', payload: update.req }
    case 'turn_complete':
      return { ...base, name: 'message.complete', detail: update.stopReason, status: 'ok', payload: update }
    case 'error':
      return { ...base, name: 'error', detail: update.error.message, status: 'error', payload: update.error }
    case 'usage':
      return { ...base, name: 'session.usage', detail: `${update.usage.outputTokens} out`, status: 'info', payload: update.usage }
    case 'event':
      return update.record
    default:
      return { ...base, name: update.kind, detail: '', status: 'info', payload: update }
  }
}
