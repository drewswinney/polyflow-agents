/**
 * Backend construction, and the one live socket the app is allowed to hold.
 *
 * Holding a socket per agent costs battery and loses to background limits
 * anyway, so exactly one backend is connected at a time and switching agents
 * tears the previous one down (§5.2). The consequence — background completion
 * for a non-selected agent can only arrive by push — is §10.2's problem.
 */

import type { Agent, AgentBackend } from '@/domain'

import { HermesBackend } from './hermes'
import { MockBackend } from './mock'
import { OpenAiCompatBackend } from './openai-compat'

export { HermesBackend, HERMES_CAPABILITIES } from './hermes'
export { MockBackend, MOCK_CAPABILITIES } from './mock'
export { OpenAiCompatBackend, OPENAI_COMPAT_CAPABILITIES } from './openai-compat'

/** Agents whose host is this sentinel run against the in-process mock. */
export const MOCK_HOST = 'mock.local'

export function createBackend(agent: Agent, token: string): AgentBackend {
  if (agent.host === MOCK_HOST) {
    return new MockBackend()
  }

  if (agent.kind === 'other') {
    return new OpenAiCompatBackend({ host: agent.host, token, model: 'gpt-4o-mini' })
  }

  return new HermesBackend({
    host: agent.host,
    token,
    profile: agent.profile ?? null,
    authMode: agent.authMode
  })
}

let current: { agentId: string; backend: AgentBackend } | null = null

/** The single live backend. Switching agents disconnects the previous one. */
export function activateBackend(agent: Agent, token: string): AgentBackend {
  if (current?.agentId === agent.id) return current.backend

  current?.backend.disconnect()

  const backend = createBackend(agent, token)
  current = { agentId: agent.id, backend }

  return backend
}

export function activeBackend(): AgentBackend | null {
  return current?.backend ?? null
}

export function releaseBackend(): void {
  current?.backend.disconnect()
  current = null
}
