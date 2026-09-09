/**
 * The backend that proves the seam without a host (§4).
 *
 * It is not a toy: it exercises every branch the Chat screen has to survive —
 * token-level streaming, a thinking block, a tool call that settles, an
 * approval that blocks the turn, usage ticks and cancellation. Running the app
 * against this is how the UI gets built before §11 host prep exists.
 */

import { File } from 'expo-file-system'

import {
  type AgentBackend,
  type ApprovalPolicy,
  type Artifact,
  type ArtifactBytes,
  type ArtifactPage,
  type ArtifactQuery,
  type ArtifactShare,
  type ArtifactUpload,
  type Capabilities,
  type ConfigField,
  type ConnectionState,
  createObservable,
  type ContentBlock,
  type PromptResult,
  type DeliveryTarget,
  type ScheduledJob,
  type ScheduledJobDraft,
  type ScheduledJobRun,
  type ScheduledJobUpdate,
  type EventRecord,
  type KanbanBoard,
  type KanbanCardCreate,
  type KanbanCardSummary,
  type KanbanCardUpdate,
  type McpServerStatus,
  type ModelOption,
  type ModelSwitch,
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

import { DEMO_IMAGE_PNG_BASE64 } from './demo-image'

export const MOCK_CAPABILITIES: Capabilities = {
  sessions: { search: true, rename: true, pin: true },
  settings: { schemaDriven: true, model: true, providers: false, sessionModel: true },
  extras: { cron: true, skills: true, mcp: true, boards: true },
  approvals: { requests: true, policy: true },
  logs: { events: true },
  // Push-to-talk is exercisable against the mock; speech synthesis is not, and
  // says so rather than returning silence.
  media: { images: true, audioIn: true, audioOut: false },
  // There is no host to register with. The demo agent exists so the UI can be
  // built without one, and a fake "registered" would hide the only thing that
  // matters about push: whether a real device reached a real host.
  push: { register: false },
  // Kept in memory, so the Artifacts screen has something to draw and every
  // action on it — share, delete, the picture coming back — can be exercised.
  artifacts: { store: true, share: true }
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
    },
    {
      id: 'ses-board',
      title: 'Kanban board screen',
      preview: 'Lanes are in; a mentioned ticket now unfurls in the transcript',
      updatedAt: now - 12 * MINUTE,
      pinned: false,
      unread: false,
      model: 'sonnet-4.5',
      messageCount: 6,
      blockedOn: null,
      // Wiki-links, because that is what an agent working an Obsidian board
      // writes — and what the transcript now resolves into cards.
      reply:
        'Lanes are in on [[kanban-board]] — swipe between columns, tap a card for the ticket. ' +
        'That leaves [[push-notifications]] as the last thing that shipped.'
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
  /**
   * The board the demo agent renders. A field, not a per-call literal, because
   * the write methods mutate it — create/edit/move/archive must be
   * exercisable on the demo agent, not just readable.
   */
  private board: KanbanBoard
  /** Seeded on first use, so the constructor stays as it was. */
  private artifacts: Artifact[] | null = null
  private readonly artifactBytes = new Map<string, Uint8Array>()
  private models: ModelOption[] = [
    { id: 'sonnet-4.5', provider: 'anthropic', selected: true },
    { id: 'opus-4.5', provider: 'anthropic', selected: false },
    { id: 'haiku-4.5', provider: 'anthropic', selected: false },
    { id: 'gpt-4o-mini', provider: 'openai', selected: false }
  ]

  /** Set false to skip the approval beat — used by the empty-agent fixture. */
  constructor(private readonly options: { withApproval?: boolean; seed?: boolean } = {}) {
    this.sessions = options.seed === false ? [] : seedSessions(Date.now())
    this.board = this.seedBoard()
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
        .map(block => ({ name: block.name ?? 'image.jpg', sourceUri: block.uri as string })),
      status: 'started'
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
    return this.board
  }

  private seedBoard(): KanbanBoard {
    return {
      title: 'Agent Handheld',
      source: 'hermes kanban board: polyflow-agents',
      updatedAt: Date.now(),
      columns: [
        {
          id: 'backlog',
          title: 'Backlog',
          cards: [
            { id: 'settings-screen', title: 'Settings screen polish', description: 'Tighten grouped rows and empty states', status: 'backlog', statusLabel: 'Backlog', checked: false, risk: 'low', priority: 5 }
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
                'Read the native Hermes kanban board over the push plugin and render it as lanes.',
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
        { id: 'blocked', title: 'Blocked', cards: [{ id: 'eas-build-slot', title: 'EAS build slot', description: 'Waiting on a free production build slot for the iOS preview', status: 'blocked', statusLabel: 'Blocked', checked: false }] },
        { id: 'done', title: 'Done', cards: [{ id: 'push-notifications', title: 'Push notifications', description: 'Registered device endpoint and local notification routing', status: 'done', statusLabel: 'Done', checked: true }] }
      ]
    }
  }

  private findMockCard(id: string): { card: KanbanCardSummary; columnId: string } | null {
    for (const column of this.board.columns) {
      const card = column.cards.find(candidate => candidate.id === id)
      if (card) return { card, columnId: column.id }
    }
    return null
  }

  async updateKanbanCard(id: string, update: KanbanCardUpdate): Promise<void> {
    await tick(120)
    const located = this.findMockCard(id)
    if (!located) throw new Error(`No kanban card "${id}"`)
    const { card, columnId } = located

    if (update.title !== undefined) card.title = update.title
    if (update.body !== undefined) {
      card.body = update.body
      card.description = update.body
        .split('\n')
        .find(line => line.trim() && !line.trim().startsWith('#'))
        ?.trim() ?? card.description
    }

    const move = update.move
    if (!move) return

    if (move.kind === 'archive') {
      const column = this.board.columns.find(candidate => candidate.id === columnId)
      if (column) column.cards = column.cards.filter(candidate => candidate.id !== id)
      this.board.updatedAt = Date.now()
      return
    }

    // Mirror the host's rule: the dispatcher owns In Progress, so a card can
    // land there but never be moved there.
    if (move.status === 'in_progress') throw new Error('Cannot move a card to In Progress from the phone — the host assigns workers to cards')
    if (columnId === move.status) return

    const from = this.board.columns.find(candidate => candidate.id === columnId)
    const to = this.board.columns.find(candidate => candidate.id === move.status)
    if (!from || !to) throw new Error(`Unknown column ${move.status}`)

    from.cards = from.cards.filter(candidate => candidate.id !== id)
    card.status = move.status
    card.statusLabel = to.title
    card.checked = move.status === 'done'
    to.cards = [...to.cards, card]
    this.board.updatedAt = Date.now()
  }

  async createKanbanCard(card: KanbanCardCreate): Promise<void> {
    await tick(120)
    const column = this.board.columns.find(candidate => candidate.id === 'backlog')
    if (!column) throw new Error('No Backlog column on the mock board')
    column.cards = [
      ...column.cards,
      {
        id: `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        title: card.title,
        description: card.body?.split('\n').find(line => line.trim())?.trim() ?? card.title,
        status: 'backlog',
        statusLabel: column.title,
        checked: false,
        body: card.body
      }
    ]
    this.board.updatedAt = Date.now()
  }

  async listSkills(): Promise<SkillSummary[]> {
    await tick(90)

    return [
      { name: 'zfs-maintenance', category: 'ops', description: 'Scrub, snapshot and prune tank', enabled: true, provenance: 'agent' },
      { name: 'proxmox', category: 'ops', description: 'Backup windows and VM lifecycle', enabled: true, provenance: 'hub' },
      { name: 'summarise', category: 'writing', description: 'Condense long output', enabled: false, provenance: 'bundled' }
    ]
  }

  async getModel(): Promise<string | null> {
    await tick(80)

    return 'sonnet-4.5'
  }

  async listModels(): Promise<ModelOption[]> {
    await tick(90)

    return this.models
  }

  async setModel(option: ModelOption): Promise<void> {
    this.models = this.models.map(model => ({ ...model, selected: model.id === option.id }))
  }

  async setSessionModel(_id: SessionId, option: ModelOption): Promise<ModelSwitch> {
    await tick(120)

    // Never deferred: the scripted turn is the only thing that streams here,
    // and a mock that reported a queued switch would be inventing a state the
    // screen could not then resolve.
    return { model: option.id, deferred: false, warning: '' }
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

  private scheduledJobs: ScheduledJob[] = [
    {
      id: 'nightly-backup',
      name: 'nightly backup',
      kind: 'prompt',
      schedule: 'every day at 03:15',
      scheduleExpr: '15 3 * * *',
      enabled: true,
      prompt:
        'Run the nightly backup: snapshot the tank pool, replicate to the offsite box, and report what changed. If replication lags more than a day behind, say so first.',
      script: null,
      skills: ['zfs-ops'],
      deliver: 'polyflow_agents_push',
      model: 'haiku-4.5',
      nextRunAt: Date.now() + 6 * 60 * MINUTE,
      lastRunAt: Date.now() - 18 * 60 * MINUTE,
      outcome: 'ok',
      lastError: null,
      lastDeliveryError: null,
      failureStreak: 0,
      contextFrom: []
    },
    {
      id: 'zfs-scrub',
      name: 'zfs scrub',
      kind: 'script',
      schedule: 'first Sunday of the month',
      scheduleExpr: '0 2 1-7 * 0',
      enabled: true,
      prompt: '',
      script: 'zfs-scrub.sh',
      skills: [],
      deliver: 'local',
      model: null,
      nextRunAt: Date.now() + 9 * 24 * 60 * MINUTE,
      lastRunAt: Date.now() - 3 * 24 * 60 * MINUTE,
      outcome: 'ok',
      lastError: null,
      lastDeliveryError: null,
      failureStreak: 0,
      contextFrom: []
    },
    {
      id: 'digest',
      name: 'morning digest',
      kind: 'prompt',
      schedule: 'weekdays at 07:00',
      scheduleExpr: '0 7 * * 1-5',
      enabled: false,
      prompt: 'Summarise overnight Home Assistant events and the backup report into five lines.',
      script: null,
      skills: [],
      deliver: 'polyflow_agents_push',
      model: 'haiku-4.5',
      nextRunAt: null,
      lastRunAt: Date.now() - 5 * 24 * 60 * MINUTE,
      outcome: 'failed',
      lastError: 'home-assistant MCP unreachable',
      lastDeliveryError: null,
      failureStreak: 3,
      contextFrom: ['nightly-backup']
    }
  ]

  /** Runs point at sessions the demo already has, so a tap opens a real transcript. */
  private scheduledRuns: Record<string, ScheduledJobRun[]> = {
    'nightly-backup': [
      {
        sessionId: 'ses-zfs',
        startedAt: Date.now() - 18 * 60 * MINUTE,
        endedAt: Date.now() - 17 * 60 * MINUTE,
        active: false,
        preview: 'Snapshot taken and replicated; 14 GB changed since yesterday.',
        messageCount: 6
      },
      {
        sessionId: 'ses-proxmox',
        startedAt: Date.now() - 42 * 60 * MINUTE,
        endedAt: Date.now() - 41 * 60 * MINUTE,
        active: false,
        preview: 'Snapshot taken; replication was already current.',
        messageCount: 4
      }
    ],
    digest: [
      {
        sessionId: 'ses-homeassistant',
        startedAt: Date.now() - 5 * 24 * 60 * MINUTE,
        endedAt: Date.now() - 5 * 24 * 60 * MINUTE + 20_000,
        active: false,
        preview: 'Could not reach the home-assistant MCP server.',
        messageCount: 3
      }
    ]
  }

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

  async listScheduledJobs(): Promise<ScheduledJob[]> {
    await tick(100)

    return this.scheduledJobs
  }

  async listScheduledJobRuns(id: string): Promise<ScheduledJobRun[]> {
    await tick(80)

    return this.scheduledRuns[id] ?? []
  }

  async createScheduledJob(draft: ScheduledJobDraft): Promise<ScheduledJob> {
    await tick(120)

    const job: ScheduledJob = {
      id: `job-${Date.now().toString(36)}`,
      name: draft.name || draft.prompt.slice(0, 40),
      kind: 'prompt',
      schedule: draft.schedule,
      scheduleExpr: draft.schedule,
      enabled: true,
      prompt: draft.prompt,
      script: null,
      skills: draft.skills ?? [],
      deliver: draft.deliver || 'local',
      model: null,
      nextRunAt: Date.now() + 60 * MINUTE,
      lastRunAt: null,
      outcome: 'never',
      lastError: null,
      lastDeliveryError: null,
      failureStreak: 0,
      contextFrom: []
    }

    this.scheduledJobs = [...this.scheduledJobs, job]

    return job
  }

  async updateScheduledJob(id: string, update: ScheduledJobUpdate): Promise<ScheduledJob> {
    await tick(120)

    const current = this.scheduledJobs.find(job => job.id === id)

    if (!current) throw new Error('Job not found')

    const next: ScheduledJob = {
      ...current,
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.schedule !== undefined ? { schedule: update.schedule, scheduleExpr: update.schedule } : {}),
      ...(update.prompt !== undefined ? { prompt: update.prompt } : {}),
      ...(update.deliver !== undefined ? { deliver: update.deliver } : {}),
      ...(update.skills !== undefined ? { skills: update.skills } : {}),
      ...(update.contextFrom !== undefined ? { contextFrom: update.contextFrom } : {})
    }

    this.scheduledJobs = this.scheduledJobs.map(job => (job.id === id ? next : job))

    return next
  }

  async deleteScheduledJob(id: string): Promise<void> {
    await tick(80)
    this.scheduledJobs = this.scheduledJobs.filter(job => job.id !== id)
  }

  async setScheduledJobEnabled(id: string, enabled: boolean): Promise<void> {
    this.scheduledJobs = this.scheduledJobs.map(job =>
      job.id === id ? { ...job, enabled, nextRunAt: enabled ? Date.now() + 60 * MINUTE : null } : job
    )
  }

  async triggerScheduledJob(id: string): Promise<void> {
    const job = this.scheduledJobs.find(row => row.id === id)

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

  async listDeliveryTargets(): Promise<DeliveryTarget[]> {
    await tick(60)

    return [
      { id: 'local', name: 'Local (save only)', ready: true, hint: null },
      { id: 'polyflow_agents_push', name: 'Polyflow Agents', ready: true, hint: null },
      { id: 'telegram', name: 'Telegram', ready: false, hint: 'TELEGRAM_HOME_CHANNEL' }
    ]
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

  // --- Artifacts ----------------------------------------------------------

  private seededArtifacts(): Artifact[] {
    if (this.artifacts === null) {
      this.artifacts = this.options.seed === false ? [] : seedArtifacts(Date.now(), this.artifactBytes)
    }

    return this.artifacts
  }

  async listArtifacts(query: ArtifactQuery = {}): Promise<ArtifactPage> {
    await tick(120)

    const all = this.seededArtifacts()
      .filter(artifact => (!query.sessionId || artifact.sessionId === query.sessionId) && (!query.kind || artifact.kind === query.kind))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const offset = query.offset ?? 0

    return { artifacts: all.slice(offset, offset + (query.limit ?? 50)), total: all.length }
  }

  async getArtifact(id: string): Promise<Artifact> {
    const hit = this.seededArtifacts().find(artifact => artifact.id === id)

    if (!hit) throw new Error('No such artifact.')

    return hit
  }

  async readArtifact(id: string): Promise<ArtifactBytes> {
    await tick(200)

    const artifact = await this.getArtifact(id)
    const bytes = this.artifactBytes.get(id)

    if (!bytes) throw new Error('The demo agent lost the bytes for that artifact.')

    return { bytes, mimeType: artifact.mimeType }
  }

  async readArtifactThumbnail(id: string): Promise<ArtifactBytes> {
    // The demo has no renderer. Pictures are their own thumbnail; everything
    // else is honestly a miss, which is what draws the glyph the real host
    // draws when it has no Pillow or `pdftoppm`.
    const artifact = await this.getArtifact(id)

    if (artifact.kind !== 'image') throw new Error('The demo agent renders no thumbnails.')

    return this.readArtifact(id)
  }

  async uploadArtifact(upload: ArtifactUpload): Promise<Artifact> {
    const base64 = upload.uri.startsWith('data:') ? upload.uri.slice(upload.uri.indexOf(',') + 1) : await new File(upload.uri).base64()
    const bytes = bytesFromBase64(base64)
    const rows = this.seededArtifacts()
    const now = Date.now()
    const existing = rows.find(row => row.origin === 'upload' && row.sessionId === upload.sessionId && row.name === upload.name)

    if (existing) {
      existing.updatedAt = now
      existing.version += 1
      existing.size = bytes.length
      this.artifactBytes.set(existing.id, bytes)

      return existing
    }

    const artifact: Artifact = {
      id: `mock-upload-${now.toString(36)}`,
      name: upload.name,
      kind: upload.mimeType.startsWith('image/') ? 'image' : 'other',
      mimeType: upload.mimeType,
      size: bytes.length,
      sessionId: upload.sessionId,
      origin: 'upload',
      tool: null,
      sourcePath: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      share: null
    }

    rows.push(artifact)
    this.artifactBytes.set(artifact.id, bytes)

    return artifact
  }

  async deleteArtifact(id: string): Promise<void> {
    const rows = this.seededArtifacts()
    const index = rows.findIndex(artifact => artifact.id === id)

    if (index === -1) throw new Error('No such artifact.')

    rows.splice(index, 1)
    this.artifactBytes.delete(id)
  }

  async shareArtifact(id: string, options: { expiresInHours?: number } = {}): Promise<ArtifactShare> {
    const artifact = await this.getArtifact(id)
    const now = Date.now()
    const expiresAt = options.expiresInHours ? now + options.expiresInHours * 60 * 60 * 1000 : null

    // A live link keeps its token; only the expiry follows the request.
    artifact.share = artifact.share
      ? { ...artifact.share, expiresAt }
      : { url: `https://demo.polyflow.local/share/${now.toString(36)}`, expiresAt, createdAt: now }

    return artifact.share
  }

  async unshareArtifact(id: string): Promise<void> {
    const artifact = await this.getArtifact(id)

    artifact.share = null
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
    // What a real host does first, and what the pending row waits on.
    this.emit(id, { kind: 'turn_started' })
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

function bytesFromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

function bytesFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * What the demo agent has produced: one of each kind the screen draws, a
 * rewrite with a version count, a picture the phone sent, and a live share.
 * The bytes go into `store` so the detail screen can actually open them.
 */
function seedArtifacts(now: number, store: Map<string, Uint8Array>): Artifact[] {
  const rows: (Artifact & { bytes: Uint8Array })[] = [
    {
      id: 'mock-art-report',
      name: 'scrub-report.md',
      kind: 'document',
      mimeType: 'text/markdown',
      size: 0,
      sessionId: 'ses-zfs',
      origin: 'agent',
      tool: 'write_file',
      sourcePath: '/home/agent/reports/scrub-report.md',
      // Between the question and the reply in `ses-zfs`, where its card belongs.
      createdAt: now - 3 * MINUTE + 20_000,
      updatedAt: now - 2 * MINUTE - 10_000,
      version: 3,
      share: { url: 'https://demo.polyflow.local/share/k3v9x1', expiresAt: null, createdAt: now - 20 * MINUTE },
      bytes: bytesFromText(
        '# Scrub report — tank\n\n' +
          '- Scrub finished clean in 3h 41m\n' +
          '- 110 stale snapshots from the failed replication\n' +
          '- 412G reclaimable once they are destroyed\n\n' +
          'Waiting on approval before touching anything.\n'
      )
    },
    {
      id: 'mock-art-timeline',
      name: 'recovery-timeline.html',
      kind: 'document',
      mimeType: 'text/html',
      size: 0,
      sessionId: 'ses-zfs',
      origin: 'agent',
      tool: 'write_file',
      sourcePath: '/home/agent/reports/recovery-timeline.html',
      // One row after the report it illustrates, so the strip reads in order.
      createdAt: now - 2 * MINUTE - 30_000,
      updatedAt: now - 2 * MINUTE - 20_000,
      version: 1,
      share: null,
      bytes: bytesFromText(
        '<!doctype html>\n' +
          '<html>\n' +
          '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recovery timeline</title>\n' +
          '<style>\n' +
          '  body { font-family: system-ui, sans-serif; margin: 24px; color: #111827; background: #fafafa; }\n' +
          '  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 28px; }\n' +
          '  ol { line-height: 1.7; } li { margin-bottom: 6px; }\n' +
          '  .note { background: #eef2ff; border-left: 3px solid #4f46e5; padding: 10px 14px; margin-top: 24px; font-size: 14px; }\n' +
          '</style></head>\n' +
          '<body>\n' +
          '<h1>Recovery timeline — tank</h1>\n' +
          '<ol><li>Scrub finished clean in 3h 41m</li><li>110 stale snapshots queued</li><li>412G reclaimable after destroy</li></ol>\n' +
          '<h2>Next</h2>\n' +
          '<div class="note">Waiting on approval before touching anything. The destroy step is the point of no return.</div>\n' +
          '</body></html>\n'
      )
    },
    {
      id: 'mock-art-pool',
      name: 'pool-layout.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 0,
      sessionId: 'ses-zfs',
      origin: 'agent',
      tool: 'image_generate',
      sourcePath: '/home/agent/.hermes/image_cache/pool-layout.png',
      createdAt: now - 2 * MINUTE - 30_000,
      updatedAt: now - 2 * MINUTE - 30_000,
      version: 1,
      share: null,
      bytes: bytesFromBase64(DEMO_IMAGE_PNG_BASE64)
    },
    {
      id: 'mock-art-window',
      name: 'backup-window.sh',
      kind: 'code',
      mimeType: 'application/x-sh',
      size: 0,
      sessionId: 'ses-proxmox',
      origin: 'agent',
      tool: 'write_file',
      sourcePath: '/etc/cron.d/backup-window.sh',
      createdAt: now - 48 * MINUTE - 20_000,
      updatedAt: now - 48 * MINUTE - 20_000,
      version: 1,
      share: null,
      bytes: bytesFromText('#!/bin/sh\n# Nightly backup, moved clear of the scrub.\n15 3 * * * root /usr/local/bin/pve-backup --all\n')
    },
    {
      id: 'mock-art-reconnects',
      name: 'reconnects.json',
      kind: 'data',
      mimeType: 'application/json',
      size: 0,
      sessionId: 'ses-homeassistant',
      origin: 'agent',
      tool: 'write_file',
      sourcePath: '/home/agent/reconnects.json',
      createdAt: now - 5 * 60 * MINUTE - 20_000,
      updatedAt: now - 5 * 60 * MINUTE - 20_000,
      version: 1,
      share: null,
      bytes: bytesFromText(JSON.stringify({ attempts: 6, lastError: 'ECONNREFUSED', container: 'exited' }, null, 2) + '\n')
    },
    {
      id: 'mock-art-photo',
      name: 'upload_20260907_132822_1.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 0,
      sessionId: 'ses-board',
      origin: 'upload',
      tool: null,
      sourcePath: null,
      createdAt: now - 3 * 60 * MINUTE,
      updatedAt: now - 3 * 60 * MINUTE,
      version: 1,
      share: null,
      bytes: bytesFromBase64(DEMO_IMAGE_PNG_BASE64)
    }
  ]

  return rows.map(({ bytes, ...artifact }) => {
    store.set(artifact.id, bytes)

    return { ...artifact, size: bytes.length }
  })
}
