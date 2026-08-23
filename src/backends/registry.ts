/**
 * Backend construction, and the one live socket the app is allowed to hold.
 *
 * Holding a socket per agent costs battery and loses to background limits
 * anyway, so exactly one backend is connected at a time and switching agents
 * tears the previous one down (§5.2). The consequence — background completion
 * for a non-selected agent can only arrive by push — is §10.2's problem.
 */

import type { Agent, AgentBackend, Server } from '@/domain'
import type { AgentCredential } from '@/platform/secure-store'

import { HermesBackend } from './hermes'
import { MockBackend } from './mock'
import { MOCK_HOST } from './mock-host'
import { OpenAiCompatBackend } from './openai-compat'

export { HermesBackend, HERMES_CAPABILITIES } from './hermes'
export { MockBackend, MOCK_CAPABILITIES } from './mock'
export { OpenAiCompatBackend, OPENAI_COMPAT_CAPABILITIES } from './openai-compat'

/** Servers whose host is this sentinel run against the in-process mock. */
export { MOCK_HOST }

/**
 * Where the server's address meets the agent's scope.
 *
 * The split is the point: everything about *reaching* the host comes from the
 * server, and the one thing that says which identity on it we are talking to is
 * `agent.scope` — opaque everywhere above this line, spent here as whatever the
 * harness actually wanted (§5.2).
 */
export function createBackend(server: Server, agent: Agent, credential: AgentCredential): AgentBackend {
  console.log('[createBackend] server:', server.displayName, 'agent:', agent.displayName, 'scope:', agent.scope)
  if (server.host === MOCK_HOST) {
    return new MockBackend()
  }

  if (server.kind === 'other') {
    return new OpenAiCompatBackend({
      host: server.host,
      token: credential.kind === 'token' ? credential.token : '',
      // An OpenAI-compatible host has no agent objects, so the identity the
      // user picked *is* a model. A server added before discovery could list
      // one carries no scope, and the backend falls back to its own default.
      ...(agent.scope ? { model: agent.scope } : {})
    })
  }

  console.log('[createBackend] creating HermesBackend with profile:', agent.scope)
  return new HermesBackend({
    host: server.host,
    profile: agent.scope,
    authMode: server.authMode,
    ...(server.secure === undefined ? {} : { secure: server.secure }),
    ...(credential.kind === 'token'
      ? { token: credential.token }
      : {
          password: {
            provider: credential.provider,
            username: credential.username,
            password: credential.password
          }
        })
  })
}

let current: { agentId: string; backend: AgentBackend } | null = null

/**
 * The single live backend. Switching agents disconnects the previous one.
 *
 * Keyed by agent rather than server even though the socket is the server's:
 * two agents on one host differ only by scope, and `HermesBackend` fixes its
 * scope at construction. Sharing one socket between them is the cheap
 * optimisation §5.2 rule 2 leaves on the table.
 */
export function activateBackend(server: Server, agent: Agent, credential: AgentCredential): AgentBackend {
  if (current?.agentId === agent.id) return current.backend

  current?.backend.disconnect()

  const backend = createBackend(server, agent, credential)
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
