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
  type ApprovalPolicy,
  type Capabilities,
  type ConfigField,
  type ConnectionState,
  createObservable,
  type ContentBlock,
  type PromptResult,
  type CronJobSummary,
  type EventRecord,
  type KanbanBoard,
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
} from '@/domain'

export const MOCK_CAPABILITIES: Capabilities = {
  sessions: { search: true, rename: true, pin: true },
  settings: { schemaDriven: true, model: true, providers: false },
  extras: { cron: true, skills: true, mcp: true, boards: true },
  approvals: { requests: true, policy: true },
  logs: { events: true },
  // Push-to-talk is exercisable against the mock; speech synthesis is not, and
  // says so rather than returning silence.
  media: { images: true, audioIn: true, audioOut: false },
  // There is no host to register with. The demo agent exists so the UI can be
  // built without one, and a fake "registered" would hide the only thing that
  // matters about push: whether a real device reached a real host.
  push: { register: false }
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
      pendingApproval: null,
      pendingClarify: null,
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
        transcript: {
          sessionId: id,
          title: opts.title ?? 'New session',
          model: opts.model ?? 'sonnet-4.5',
          entries: [],
          usage: null,
          pendingApproval: null,
          pendingClarify: null
        }
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

  async prompt(id: SessionId, content: ContentBlock[]): Promise<PromptResult> {
    this.cancelled.delete(id)
    const text = content.map(block => block.text ?? '').join(' ').trim()
    const session = this.sessions.find(row => row.id === id)

    if (session) {
      session.preview = text
      session.updatedAt = Date.now()
      session.messageCount += 1
    }

    void this.runTurn(id)

    // The mock has no host to rename anything, so it answers with the names the
    // caller already knows. That is enough for the transcript-cache path to be
    // exercised without a server, which is the point of the mock (§4).
    return {
      images: content
        .filter(block => block.kind === 'image' && block.uri)
        .map(block => ({ name: block.name ?? 'image.jpg', sourceUri: block.uri as string }))
    }
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

  async listKanbanBoard(): Promise<KanbanBoard> {
    return {
      title: 'DEV Kanban Board',
      source: 'mock',
      updatedAt: Date.now(),
      columns: [
        {
          id: 'backlog',
          title: 'Backlog',
          cards: [
            { id: 'settings-screen', title: 'Settings screen polish', description: 'Tighten grouped rows and empty states', status: 'backlog', statusLabel: 'Backlog', checked: false, risk: 'low' }
          ]
        },
        {
          id: 'in_progress',
          title: 'In Progress',
          cards: [
            {
              id: 'kanban-board',
              title: 'Expose kanban board screen',
              description: 'Boards link, status columns, dense cards, and closeable detail modal',
              status: 'in_progress',
              statusLabel: 'In Progress',
              checked: false,
              branch: 'feat/expose-kanban-board-screen',
              pr: '#38',
              risk: 'medium',
              // A real ticket body is markdown on disk, and the detail modal
              // renders it as markdown — so the mock carries markdown, or the
              // demo agent exercises a path the real one never takes.
              body: [
                '# Expose kanban board screen',
                '',
                'Read the Obsidian board over the push plugin and render it as lanes.',
                '',
                '## Checklist',
                '',
                '- [x] Plugin route + parser',
                '- [x] Horizontal columns',
                '- [ ] Drag between columns',
                '',
                '`GET /api/plugins/polyflow_agents_push/kanban`'
              ].join('\n')
            }
          ]
        },
        { id: 'testing', title: 'Testing / QA', cards: [] },
        { id: 'done', title: 'Done', cards: [{ id: 'push-notifications', title: 'Push notifications', description: 'Registered device endpoint and local notification routing', status: 'done', statusLabel: 'Done', checked: true }] }
      ]
    }
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

  private approvalPolicy: ApprovalPolicy = 'destructive'
  private config: ConfigField[] = [
    {
      key: 'agent.reasoning_effort',
      category: 'Agent',
      description: 'How much the agent thinks before answering.',
      type: 'select',
      options: ['low', 'medium', 'high'],
      value: 'medium'
    },
    {
      key: 'display.timestamps',
      category: 'Display',
      description: 'Show a timestamp on every message.',
      type: 'boolean',
      options: [],
      value: 'false'
    },
    {
      key: 'display.personality',
      category: 'Display',
      description: 'Which personality the agent answers in.',
      type: 'string',
      options: [],
      value: 'default'
    },
    {
      key: 'sessions.auto_archive_days',
      category: 'Sessions',
      description: 'Archive sessions untouched for this many days.',
      type: 'number',
      options: [],
      value: '30'
    }
  ]

  private cronJobs: CronJobSummary[] = [
    {
      id: 'nightly-backup',
      name: 'nightly backup',
      schedule: 'every day at 03:15',
      enabled: true,
      nextRunAt: Date.now() + 6 * 60 * MINUTE,
      lastRunAt: Date.now() - 18 * 60 * MINUTE,
      lastError: null,
      model: 'haiku-4.5'
    },
    {
      id: 'zfs-scrub',
      name: 'zfs scrub',
      schedule: 'first Sunday of the month',
      enabled: true,
      nextRunAt: Date.now() + 9 * 24 * 60 * MINUTE,
      lastRunAt: Date.now() - 3 * 24 * 60 * MINUTE,
      lastError: null,
      model: null
    },
    {
      id: 'digest',
      name: 'morning digest',
      schedule: 'weekdays at 07:00',
      enabled: false,
      nextRunAt: null,
      lastRunAt: Date.now() - 5 * 24 * 60 * MINUTE,
      lastError: 'home-assistant MCP unreachable',
      model: 'haiku-4.5'
    }
  ]

  async getApprovalPolicy(): Promise<ApprovalPolicy> {
    await tick(60)

    return this.approvalPolicy
  }

  async setApprovalPolicy(policy: ApprovalPolicy): Promise<void> {
    this.approvalPolicy = policy
  }

  async listConfigFields(): Promise<ConfigField[]> {
    await tick(110)

    return this.config
  }

  async setConfigValue(key: string, value: string): Promise<void> {
    this.config = this.config.map(field => (field.key === key ? { ...field, value } : field))
  }

  async listCronJobs(): Promise<CronJobSummary[]> {
    await tick(100)

    return this.cronJobs
  }

  async setCronJobEnabled(id: string, enabled: boolean): Promise<void> {
    this.cronJobs = this.cronJobs.map(job => (job.id === id ? { ...job, enabled } : job))
  }

  async triggerCronJob(id: string): Promise<void> {
    const job = this.cronJobs.find(row => row.id === id)

    for (const sink of this.eventSinks) {
      sink({
        id: `cron-${Date.now()}`,
        at: Date.now(),
        name: 'cron.fired',
        detail: `${job?.name ?? id} · started`,
        status: 'ok',
        payload: { job: id, triggered: 'manually' }
      })
    }
  }

  async registerPushDevice(): Promise<never> {
    throw new Error('The demo agent has no host to register a device with.')
  }

  async unregisterPushDevice(): Promise<never> {
    throw new Error('The demo agent has no host to register a device with.')
  }

  async transcribe(dataUrl: string, _mimeType: string): Promise<string> {
    await tick(700)

    // Clip length stands in for content: the mock cannot hear, so it answers
    // with something plausible rather than pretending to have understood.
    return dataUrl.length > 1000 ? 'Check the pool status and tell me if the scrub finished.' : 'Status?'
  }

  async speak(_text: string): Promise<{ dataUrl: string; mimeType: string }> {
    throw new Error('The mock agent has no voice.')
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
        // Hermes's own default, so the mock exercises the countdown and the
        // expiry the real host enforces rather than only the null path.
        expiresAt: Date.now() + 300_000
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
