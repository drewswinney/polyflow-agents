/**
 * The server registry, the agents discovered on those servers, and the
 * selection that scopes the entire app (§5.2).
 *
 * Two collections, one selection. A **Server** is how the phone reaches a host;
 * an **Agent** is one identity on it, and the selected agent is what sessions,
 * search and settings all filter by — session ids are only unique within a
 * backend *and* a scope. That scoping is the part that is genuinely painful to
 * retrofit, so it is here from the first screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

import type { Agent, AgentConnection, AgentIconName, AgentId, AgentIdentity, Server, ServerId } from '@/domain'

const STORAGE_KEY = 'agents/v2'
/** Read once, on first hydrate after the upgrade, and then never written. */
const LEGACY_STORAGE_KEY = 'agents/v1'

interface AgentsState {
  servers: Server[]
  agents: Agent[]
  selectedAgentId: AgentId
  hydrated: boolean
  /**
   * Why the saved registry could not be read, when it could not be read.
   *
   * A corrupt registry must not brick the app, but it must not vanish quietly
   * either: falling back to empty was honest when it meant re-pairing one host
   * and is not now that it can mean losing several. Onboarding surfaces this.
   */
  hydrationError: string | null

  hydrate: () => Promise<void>
  select: (id: AgentId) => void
  /** Adds a server and the identities discovered on it, selecting the default. */
  addServer: (server: Server, identities: AgentIdentity[]) => Promise<AgentId>
  /** Drops a server and every agent on it. The only destructive action (§7.4). */
  removeServer: (id: ServerId) => Promise<void>
  /** Forgets one agent already marked missing (§5.2a). Refuses a live one. */
  dismissAgent: (id: AgentId) => Promise<void>
  /** Folds a fresh discovery into what is stored, adding and marking (§5.2a). */
  reconcile: (serverId: ServerId, identities: AgentIdentity[]) => void
  patchServer: (id: ServerId, updates: Partial<Server>) => void
  setConnection: (id: ServerId, connection: AgentConnection, latencyMs?: number) => void
}

export const useAgents = create<AgentsState>((set, get) => ({
  // No fixture agent. One used to be seeded so the app was usable before a host
  // existed, and it cost more than it gave: it runs against `MockBackend`, so a
  // broken connection to a real host still looked like a working app — which is
  // exactly how a dead socket went unnoticed for an afternoon. An empty list is
  // honest, and onboarding (§7.8) is what fills it.
  servers: [],
  agents: [],
  selectedAgentId: '',
  hydrated: false,
  hydrationError: null,

  async hydrate() {
    if (get().hydrated) return

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)

      if (raw) {
        const saved = JSON.parse(raw) as { servers?: Server[]; agents?: Agent[]; selectedAgentId?: AgentId }

        set(reselect({ servers: saved.servers ?? [], agents: saved.agents ?? [] }, saved.selectedAgentId ?? ''))
      } else {
        const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY)

        if (legacy) {
          const migrated = migrate(JSON.parse(legacy) as LegacyRegistry)

          set(migrated)
          await persist({ ...get(), ...migrated })
        }
      }
    } catch (cause) {
      set({ hydrationError: cause instanceof Error ? cause.message : String(cause) })
    }

    set({ hydrated: true })
  },

  select(id) {
    if (!get().agents.some(agent => agent.id === id)) return

    set({ selectedAgentId: id })
    void persist(get())
  },

  async addServer(server, identities) {
    const agents = identities.map(identity => toAgent(server, identity))
    const selected = (agents.find(agent => agent.scope === null) ?? agents[0])?.id ?? get().selectedAgentId

    set(state => ({
      servers: [...state.servers, server],
      agents: [...state.agents, ...agents],
      selectedAgentId: selected
    }))
    await persist(get())

    return selected
  },

  async removeServer(id) {
    set(state => {
      const servers = state.servers.filter(server => server.id !== id)
      const agents = state.agents.filter(agent => agent.serverId !== id)

      // Removing the last server empties both lists rather than resurrecting a
      // fixture. The app has a first-run state; it does not need a decoy.
      return reselect({ servers, agents }, state.selectedAgentId)
    })
    await persist(get())
  },

  async dismissAgent(id) {
    // The one per-agent destructive action, and it exists only for agents the
    // server has stopped reporting (§5.2a). A live agent is removed by removing
    // its server — anything else would leave a row the next reconcile restores.
    if (!get().agents.some(agent => agent.id === id && agent.missing)) return

    set(state => reselect({ servers: state.servers, agents: state.agents.filter(agent => agent.id !== id) }, state.selectedAgentId))
    await persist(get())
  },

  reconcile(serverId, identities) {
    const state = get()
    const server = state.servers.find(candidate => candidate.id === serverId)

    if (!server) return

    const mine = state.agents.filter(agent => agent.serverId === serverId)
    const live = new Set(identities.map(identity => identity.scope))

    const kept = mine.map(agent => {
      const gone = !live.has(agent.scope)

      // Only ever a flag flip, and only when it actually changes: every
      // subscriber gets a new object identity from a rebuild, and one that
      // writes back on identity turns that into an infinite render loop.
      if (gone === Boolean(agent.missing)) return agent

      return gone ? { ...agent, missing: true } : omitMissing(agent)
    })

    const known = new Set(mine.map(agent => agent.scope))
    const added = identities
      .filter(identity => !known.has(identity.scope))
      .map(identity => toAgent(server, identity))

    // Nothing new and nothing lost. Reconcile runs on every successful connect,
    // so the steady state has to be a genuine no-op — returning a rebuilt list
    // here would redial the socket that just came up.
    if (added.length === 0 && kept.every((agent, index) => agent === mine[index])) return

    const others = state.agents.filter(agent => agent.serverId !== serverId)

    set({ agents: [...others, ...kept, ...added] })
    void persist(get())
  },

  patchServer(id, updates) {
    set(state => ({ servers: state.servers.map(server => (server.id === id ? { ...server, ...updates } : server)) }))
    void persist(get())
  },

  setConnection(id, connection, latencyMs) {
    set(state => {
      const current = state.servers.find(server => server.id === id)

      // Bail before touching state when nothing actually changed. Rebuilding
      // the row unconditionally gives every subscriber a new object identity,
      // and a subscriber that writes back on identity — as the connection
      // provider does — turns that into an infinite render loop.
      if (!current || (current.connection === connection && (latencyMs === undefined || current.latencyMs === latencyMs))) {
        return state
      }

      return {
        servers: state.servers.map(server =>
          server.id === id ? { ...server, connection, ...(latencyMs === undefined ? {} : { latencyMs }) } : server
        )
      }
    })
  }
}))

/** One distinct glyph per agent, cycled so a server's agents never collide. */
const GLYPHS: AgentIconName[] = ['server', 'terminal', 'flask', 'cloud', 'home', 'car']

/**
 * Monotonic within a run, so two agents minted in the same millisecond — a
 * whole server's worth arrive at once — cannot collide on id.
 */
let minted = 0

function toAgent(server: Server, identity: AgentIdentity): Agent {
  const index = minted++

  return {
    id: `agent-${Date.now().toString(36)}-${index.toString(36)}`,
    serverId: server.id,
    displayName: identity.label,
    icon: GLYPHS[index % GLYPHS.length] as AgentIconName,
    scope: identity.scope,
    ...(identity.hint ? { hint: identity.hint } : {})
  }
}

function omitMissing(agent: Agent): Agent {
  const { missing: _missing, ...rest } = agent

  return rest
}

/** Keeps the selection pointing at an agent that still exists. */
function reselect(next: { servers: Server[]; agents: Agent[] }, selectedAgentId: AgentId) {
  return {
    ...next,
    selectedAgentId: next.agents.some(agent => agent.id === selectedAgentId)
      ? selectedAgentId
      : (next.agents[0]?.id ?? '')
  }
}

// --- Migration ------------------------------------------------------------

/** The shape `agents/v1` persisted, when an agent still meant a host. */
interface LegacyRegistry {
  agents?: {
    id: string
    displayName: string
    kind: Server['kind']
    icon: AgentIconName
    host: string
    authMode: Server['authMode']
    username?: string
    authProvider?: string
    secure?: boolean
    profile?: string
    accent?: Agent['accent']
  }[]
  selectedAgentId?: AgentId
}

/**
 * One legacy agent becomes one server carrying one agent.
 *
 * The server **keeps the old id**. That is not tidiness: credentials and push
 * config are keyed by server id in the keychain (§5.2), and every one of those
 * keys was written under the old agent id. Minting a fresh server id here would
 * strand a working credential behind a name nothing reads, and the first thing
 * the user would see is a host that suddenly needs its password again.
 */
function migrate(legacy: LegacyRegistry): Pick<AgentsState, 'servers' | 'agents' | 'selectedAgentId'> {
  const servers: Server[] = []
  const agents: Agent[] = []

  for (const [index, old] of (legacy.agents ?? []).entries()) {
    servers.push({
      id: old.id,
      displayName: old.displayName,
      kind: old.kind,
      host: old.host,
      authMode: old.authMode,
      ...(old.username === undefined ? {} : { username: old.username }),
      ...(old.authProvider === undefined ? {} : { authProvider: old.authProvider }),
      ...(old.secure === undefined ? {} : { secure: old.secure }),
      // Not carried over: reachability is a live fact, and the value stored
      // last run describes a network the phone may no longer be on.
      connection: 'idle'
    })

    agents.push({
      id: `${old.id}.a`,
      serverId: old.id,
      displayName: old.displayName,
      icon: old.icon ?? GLYPHS[index % GLYPHS.length],
      // `profile` was in the domain but never set by any screen, so in practice
      // this is always null. Read anyway — a hand-edited registry is cheap to
      // honour and expensive to silently discard.
      scope: old.profile ?? null,
      ...(old.accent ? { accent: old.accent } : {})
    })
  }

  return reselect(
    { servers, agents },
    legacy.selectedAgentId ? `${legacy.selectedAgentId}.a` : ''
  )
}

async function persist(state: Pick<AgentsState, 'servers' | 'agents' | 'selectedAgentId'>): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ servers: state.servers, agents: state.agents, selectedAgentId: state.selectedAgentId })
    )
  } catch {
    // Persistence is best-effort; the in-memory registry is still correct.
  }
}

// --- Selectors ------------------------------------------------------------

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
 * registry the only reachable route is onboarding, and when the last server is
 * removed the root swaps what it renders, so a screen never re-renders into an
 * empty registry. Screens stay free of null checks that could never fire.
 */
export function useSelectedAgent(): Agent {
  return useSelectedAgentOrNull() as Agent
}

/** The server behind the selected agent — the address, the socket, the state. */
export function useSelectedServerOrNull(): Server | null {
  return useAgents(state => {
    const agent = state.agents.find(candidate => candidate.id === state.selectedAgentId) ?? state.agents[0]

    return state.servers.find(server => server.id === agent?.serverId) ?? null
  })
}

export function useSelectedServer(): Server {
  return useSelectedServerOrNull() as Server
}

/** Reachability, which is the server's (§5.2 rule 4), read for one agent. */
export function useConnectionOf(agent: Agent | null): AgentConnection {
  return useAgents(state => state.servers.find(server => server.id === agent?.serverId)?.connection ?? 'offline')
}
