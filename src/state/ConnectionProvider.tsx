import { createContext, type ReactNode, useContext } from 'react'

import type { Agent } from '@/domain'

import { type Connection, useConnection } from './connection'
import { useEventLogTap } from './event-log'
import { useNotificationTap } from './notification-tap'

const ConnectionContext = createContext<Connection | null>(null)

/**
 * Mounted once at the root so the single live socket (§5.2) survives navigation
 * between tabs and into a chat, instead of being re-dialled per screen.
 */
export function ConnectionProvider({ agent, children }: { agent: Agent; children: ReactNode }) {
  const connection = useConnection(agent)

  // Tapped here rather than on Activity, so the log accumulates while you are
  // elsewhere — those screens should open onto history, not start filling as
  // you watch.
  useEventLogTap(connection.backend, agent.id)

  // Only fires while the app is backgrounded — see the tap's own comment.
  useNotificationTap(connection.backend, agent)

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
}

export function useActiveConnection(): Connection {
  const connection = useContext(ConnectionContext)

  if (!connection) throw new Error('useActiveConnection must be used inside ConnectionProvider')

  return connection
}
