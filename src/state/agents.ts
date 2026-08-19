/**
 * Agent registry and the selection that scopes the entire app.
 *
 * Sessions, search, activity and settings all filter by `selectedAgentId` —
 * session ids are only unique within a backend, and nothing merges across
 * agents (§5.2). This is the part that is genuinely painful to retrofit, so it
 * is here from the first screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

import type { Agent, AgentConnection, AgentId } from '@/domain'
import { MOCK_HOST } from '@/backends/registry'

const STORAGE_KEY = 'agents/v1'

/**
 * The fixture agent. It runs against `MockBackend`, so the app is usable before
 * §11 host prep exists — and it is a real row in the list, not a special case,
 * which keeps the agent-scoping honest.
 */
const DEMO_AGENT: Agent = {
  id: 'demo',
  displayName: 'demo agent',
  kind: 'hermes',
  icon: 'flask',
  host: MOCK_HOST,
  authMode: 'token',
  connection: 'connected'
}

interface AgentsState {
  agents: Agent[]
  selectedAgentId: AgentId
  hydrated: boolean
  hydrate: () => Promise<void>
  select: (id: AgentId) => void
  add: (agent: Agent) => Promise<void>
  remove: (id: AgentId) => Promise<void>
  patch: (id: AgentId, updates: Partial<Agent>) => void
  setConnection: (id: AgentId, connection: AgentConnection, latencyMs?: number) => void
}

export const useAgents = create<AgentsState>((set, get) => ({
  agents: [DEMO_AGENT],
  selectedAgentId: DEMO_AGENT.id,
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)

      if (raw) {
        const saved = JSON.parse(raw) as { agents: Agent[]; selectedAgentId: AgentId }
        const agents = saved.agents?.length ? saved.agents : [DEMO_AGENT]
        const selected = agents.some(agent => agent.id === saved.selectedAgentId)
          ? saved.selectedAgentId
          : agents[0].id

        set({ agents, selectedAgentId: selected })
      }
    } catch {
      // A corrupt registry must not brick the app; fall back to the fixture.
    }

    set({ hydrated: true })
  },

  select(id) {
    if (!get().agents.some(agent => agent.id === id)) return

    set({ selectedAgentId: id })
    void persist(get())
  },

  async add(agent) {
    set(state => ({ agents: [...state.agents, agent], selectedAgentId: agent.id }))
    await persist(get())
  },

  async remove(id) {
    set(state => {
      const agents = state.agents.filter(agent => agent.id !== id)
      const fallback = agents[0] ?? DEMO_AGENT

      return {
        agents: agents.length ? agents : [DEMO_AGENT],
        selectedAgentId: state.selectedAgentId === id ? fallback.id : state.selectedAgentId
      }
    })
    await persist(get())
  },

  patch(id, updates) {
    set(state => ({ agents: state.agents.map(agent => (agent.id === id ? { ...agent, ...updates } : agent)) }))
    void persist(get())
  },

  setConnection(id, connection, latencyMs) {
    set(state => ({
      agents: state.agents.map(agent =>
        agent.id === id ? { ...agent, connection, ...(latencyMs === undefined ? {} : { latencyMs }) } : agent
      )
    }))
  }
}))

async function persist(state: AgentsState): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ agents: state.agents, selectedAgentId: state.selectedAgentId })
    )
  } catch {
    // Persistence is best-effort; the in-memory registry is still correct.
  }
}

/** The selected agent. Never undefined — the registry always holds at least one. */
export function useSelectedAgent(): Agent {
  return useAgents(state => state.agents.find(agent => agent.id === state.selectedAgentId) ?? state.agents[0])
}
