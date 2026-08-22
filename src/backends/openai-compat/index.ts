/**
 * The second agent kind: anything speaking OpenAI-compatible streaming (§4).
 *
 * Deliberately unimplemented in this pass. The seam it has to fit through is
 * proven by `MockBackend`, and open question §12.3 — whether this is a v1
 * deliverable at all — is still open. What is settled is its shape: capability
 * flags that are almost all false, so every screen already omits what it
 * cannot report rather than rendering blank tiles (§4.1).
 */

import {
  type AgentBackend,
  type Capabilities,
  type ConnectionState,
  createObservable,
  type EventRecord,
  type Observable,
  type PromptResult,
  type SessionUpdate,
  type Unsubscribe
} from '@/domain'

export const OPENAI_COMPAT_CAPABILITIES: Capabilities = {
  sessions: { search: false, rename: true, pin: true },
  settings: { schemaDriven: false, model: true, providers: false },
  extras: { cron: false, skills: false, mcp: false, profiles: false },
  approvals: { requests: false, policy: false },
  logs: { events: true },
  media: { images: true, audioIn: false, audioOut: false }
}

class NotImplemented extends Error {
  constructor(what: string) {
    super(`The OpenAI-compatible backend does not implement ${what} yet.`)
    this.name = 'NotImplemented'
  }
}

export interface OpenAiCompatConfig {
  host: string
  token: string
  model: string
}

export class OpenAiCompatBackend implements AgentBackend {
  readonly capabilities = OPENAI_COMPAT_CAPABILITIES

  private readonly state = createObservable<ConnectionState>('idle')

  constructor(private readonly config: OpenAiCompatConfig) {}

  get connectionState(): Observable<ConnectionState> {
    return this.state
  }

  async connect(): Promise<void> {
    this.state.set('error')
    throw new NotImplemented('connect')
  }

  disconnect(): void {
    this.state.set('closed')
  }

  async listSessions() {
    return []
  }

  async createSession(): Promise<string> {
    throw new NotImplemented('createSession')
  }

  async loadSession(): Promise<never> {
    throw new NotImplemented('loadSession')
  }

  async deleteSession(): Promise<void> {
    throw new NotImplemented('deleteSession')
  }

  async renameSession(): Promise<void> {
    throw new NotImplemented('renameSession')
  }

  async searchSessions() {
    return []
  }

  async prompt(): Promise<PromptResult> {
    throw new NotImplemented('prompt')
  }

  async cancel(): Promise<void> {
    throw new NotImplemented('cancel')
  }

  async respondToPermission(): Promise<void> {
    throw new NotImplemented('approvals')
  }

  async respondToClarify(): Promise<void> {
    throw new NotImplemented('clarify')
  }

  subscribe(_id: string, _sink: (u: SessionUpdate) => void): Unsubscribe {
    return () => undefined
  }

  subscribeEvents(_sink: (record: EventRecord) => void): Unsubscribe {
    return () => undefined
  }

  // Every one of these is false in `OPENAI_COMPAT_CAPABILITIES`, so the UI omits
  // the screen and never calls them. Throwing is the honest answer if it does:
  // a fabricated empty list would read on screen as "this agent has no skills"
  // rather than "this agent cannot say".

  async listEvents(): Promise<never> {
    throw new NotImplemented('events')
  }

  async listMcpServers(): Promise<never> {
    throw new NotImplemented('MCP servers')
  }

  async listSkills(): Promise<never> {
    throw new NotImplemented('skills')
  }

  async listModels(): Promise<never> {
    throw new NotImplemented('model listing')
  }

  async setModel(): Promise<never> {
    throw new NotImplemented('model selection')
  }

  async getApprovalPolicy(): Promise<never> {
    throw new NotImplemented('approval policy')
  }

  async setApprovalPolicy(): Promise<never> {
    throw new NotImplemented('approval policy')
  }

  async listConfigFields(): Promise<never> {
    throw new NotImplemented('a config schema')
  }

  async setConfigValue(): Promise<never> {
    throw new NotImplemented('config writes')
  }

  async listCronJobs(): Promise<never> {
    throw new NotImplemented('cron')
  }

  async setCronJobEnabled(): Promise<never> {
    throw new NotImplemented('cron')
  }

  async triggerCronJob(): Promise<never> {
    throw new NotImplemented('cron')
  }

  async transcribe(): Promise<never> {
    throw new NotImplemented('transcription')
  }

  async speak(): Promise<never> {
    throw new NotImplemented('speech')
  }
}
