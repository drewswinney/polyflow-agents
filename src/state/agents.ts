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
const STORAGE_KEY = 'agents/v1'

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
  // No fixture agent. One used to be seeded so the app was usable before a host
  // existed, and it cost more than it gave: it runs against `MockBackend`, so a
  // broken connection to a real host still looked like a working app — which is
  // exactly how a dead socket went unnoticed for an afternoon. An empty list is
  // honest, and onboarding (§7.8) is what fills it.
  agents: [],
  selectedAgentId: '',
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)

      if (raw) {
        const saved = JSON.parse(raw) as { agents: Agent[]; selectedAgentId: AgentId }
        const agents = saved.agents ?? []
        const selected = agents.some(agent => agent.id === saved.selectedAgentId)
          ? saved.selectedAgentId
          : (agents[0]?.id ?? '')

        set({ agents, selectedAgentId: selected })
      }
    } catch {
      // A corrupt registry must not brick the app. It falls back to empty,
      // which onboarding handles — the same path a fresh install takes.
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

      // Removing the last agent empties the list rather than resurrecting a
      // fixture. The app has a first-run state; it does not need a decoy.
      return {
        agents,
        selectedAgentId: state.selectedAgentId === id ? (agents[0]?.id ?? '') : state.selectedAgentId
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

/**
 * The selected agent, or null when the registry is empty.
 *
 * Empty is a real state now that no fixture agent is seeded, and only two
 * places have to think about it: the root layout, which mounts the providers,
 * and home, which redirects into onboarding. Everything else runs behind that
 * gate — see `useSelectedAgent`.
 */
export function useSelectedAgentOrNull(): Agent | null {
  return useAgents(
    state => state.agents.find(agent => agent.id === state.selectedAgentId) ?? state.agents[0] ?? null
  )
}

/**
 * The selected agent, for screens that cannot be reached without one.
 *
 * The invariant is held by the redirect in `app/index.tsx`: with an empty
 * registry the only reachable route is onboarding, and when the last agent is
 * removed the root swaps what it renders, so a screen never re-renders into an
 * empty registry. Screens stay free of null checks that could never fire.
 */
export function useSelectedAgent(): Agent {
  return useSelectedAgentOrNull() as Agent
}
