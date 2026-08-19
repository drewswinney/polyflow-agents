import { createContext, type ReactNode, useContext, useEffect } from 'react'

import type { Agent, AgentConnection, ConnectionState } from '@/domain'

import { useAgents } from './agents'
import { type Connection, useConnection } from './connection'
import { useEventLogTap } from './event-log'
import { useNotificationTap } from './notification-tap'

const ConnectionContext = createContext<Connection | null>(null)

/**
 * Mounted once at the root so the single live socket (§5.2) survives navigation
 * between tabs and into a chat, instead of being re-dialled per screen.
 */
export function ConnectionProvider({ agent, children }: { agent: Agent | null; children: ReactNode }) {
  const connection = useConnection(agent)

  // Tapped here rather than on Activity, so the log accumulates while you are
  // elsewhere — those screens should open onto history, not start filling as
  // you watch.
  useEventLogTap(connection.backend, agent?.id ?? '')

  // Only fires while the app is backgrounded — see the tap's own comment.
  useNotificationTap(connection.backend, agent)

  // The status dot on the agent pill reads `agent.connection`, which nothing
  // was writing: the store had `setConnection` from the start and no caller, so
  // the dot showed whatever the agent was seeded with no matter what the socket
  // was doing. The live state is the only thing that knows, so it is the thing
  // that writes it.
  const setConnection = useAgents(state => state.setConnection)

  useEffect(() => {
    if (agent) setConnection(agent.id, describeConnection(connection.state))
  }, [agent, connection.state, setConnection])

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
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

export function useActiveConnection(): Connection {
  const connection = useContext(ConnectionContext)

  if (!connection) throw new Error('useActiveConnection must be used inside ConnectionProvider')

  return connection
}
