import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'

import type { Agent, AgentBackend, AgentConnection, ConnectionState } from '@/domain'

import { useAgents } from './agents'
import { useConnection } from './connection'

/**
 * What a screen holds onto: the backend, and the way to redial it.
 *
 * Deliberately not the socket's *state*. The two change at completely
 * different rates — the backend is replaced only when the socket is genuinely
 * rebuilt, while the state moves through connecting/open/closed on every
 * transition — and eleven screens read the backend where three read the state.
 * One context carrying both meant a reconnect re-rendered every open screen,
 * including the eight that could not tell the difference.
 */
interface BackendHandle {
  backend: AgentBackend | null
  reconnect: () => void
}

/** The last connect failure, for anything that reports *why* it is not up. */
export interface ConnectionFault {
  error: string | null
  /** Consecutive failed attempts. */
  attempt: number
}

const BackendContext = createContext<BackendHandle | null>(null)
const StateContext = createContext<ConnectionState>('idle')
const FaultContext = createContext<ConnectionFault>({ error: null, attempt: 0 })

/**
 * Mounted once at the root so the single live socket (§5.2) survives navigation
 * between tabs and into a chat, instead of being re-dialled per screen.
 */
export function ConnectionProvider({ agent, children }: { agent: Agent | null; children: ReactNode }) {
  const connection = useConnection(agent)

  // The status dot on the agent pill reads `agent.connection`, which nothing
  // was writing: the store had `setConnection` from the start and no caller, so
  // the dot showed whatever the agent was seeded with no matter what the socket
  // was doing. The live state is the only thing that knows, so it is the thing
  // that writes it.
  const setConnection = useAgents(state => state.setConnection)

  // Keyed on the id, not the agent object: writing the status replaces that
  // row, so depending on the object means depending on something this effect
  // itself changes.
  const agentId = agent?.id

  useEffect(() => {
    if (agentId) setConnection(agentId, describeConnection(connection.state))
  }, [agentId, connection.state, setConnection])

  // Split at the provider rather than at the consumer: a context value is only
  // as stable as its identity, so the pieces have to be handed out separately
  // for a screen to subscribe to one and not the other.
  const handle = useMemo(
    () => ({ backend: connection.backend, reconnect: connection.reconnect }),
    [connection.backend, connection.reconnect]
  )
  const fault = useMemo(
    () => ({ error: connection.error, attempt: connection.attempt }),
    [connection.error, connection.attempt]
  )

  return (
    <BackendContext.Provider value={handle}>
      <StateContext.Provider value={connection.state}>
        <FaultContext.Provider value={fault}>{children}</FaultContext.Provider>
      </StateContext.Provider>
    </BackendContext.Provider>
  )
}

/**
 * Socket state as the agent list talks about it.
 *
 * `connecting` counts as idle rather than offline: it is the normal state a
 * second after a switch, and flashing every agent orange on the way up would
 * make the dot mean nothing.
 */
function describeConnection(state: ConnectionState): AgentConnection {
  if (state === 'open') return 'connected'
  if (state === 'connecting' || state === 'idle') return 'idle'

  return 'offline'
}

/**
 * The live backend.
 *
 * What most screens want, and the one that costs them nothing: this changes
 * only when the socket is actually rebuilt, so a screen reading it sits still
 * through the connecting/open/closed traffic of a reconnect.
 */
export function useBackend(): AgentBackend | null {
  return useHandle().backend
}

/** Redial. Separate from the state, so asking to reconnect is not reading it. */
export function useReconnect(): () => void {
  return useHandle().reconnect
}

/**
 * The socket's state, for the screens that show it.
 *
 * A string, so the context value *is* the value — no wrapper object whose
 * identity changes when its contents do not.
 */
export function useConnectionState(): ConnectionState {
  return useContext(StateContext)
}

/** The last failure and the retry count. Nothing renders this today. */
export function useConnectionFault(): ConnectionFault {
  return useContext(FaultContext)
}

function useHandle(): BackendHandle {
  const handle = useContext(BackendContext)

  if (!handle) throw new Error('Connection hooks must be used inside ConnectionProvider')

  return handle
}
