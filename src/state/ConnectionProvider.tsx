import { createContext, type ReactNode, useContext } from 'react'

import type { Agent } from '@/domain'

import { type Connection, useConnection } from './connection'

const ConnectionContext = createContext<Connection | null>(null)

/**
 * Mounted once at the root so the single live socket (§5.2) survives navigation
 * between tabs and into a chat, instead of being re-dialled per screen.
 */
export function ConnectionProvider({ agent, children }: { agent: Agent; children: ReactNode }) {
  const connection = useConnection(agent)

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
}

export function useActiveConnection(): Connection {
  const connection = useContext(ConnectionContext)

  if (!connection) throw new Error('useActiveConnection must be used inside ConnectionProvider')

  return connection
}
