/**
 * The glyph an agent wears is the user's choice, and it has to stay theirs.
 *
 * Two ways it could quietly revert: `reconcile` rebuilding a stored agent from
 * the identity the host just re-reported (the host has no opinion about glyphs,
 * so a rebuild would reset one), and the no-op guard in `setAgentIcon` being
 * wrong in the direction that drops a real change rather than the one that
 * spends a render.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

import type { Agent, AgentIdentity, Server } from '@/domain'
import { useAgents } from '@/state/agents'

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined)
}))

const SERVER = 'srv-1'

const server = { id: SERVER, displayName: 'Host', host: 'h', kind: 'hermes', connection: 'online' } as unknown as Server

const agent = (id: string, scope: string | null): Agent =>
  ({ id, serverId: SERVER, displayName: id, icon: 'server', scope }) as unknown as Agent

const identity = (scope: string | null, label: string): AgentIdentity =>
  ({ scope, label }) as unknown as AgentIdentity

beforeEach(() => {
  useAgents.setState({
    servers: [server],
    agents: [agent('a', null), agent('b', 'profile-b')],
    selectedAgentId: 'a'
  })
})

const find = (id: string) => useAgents.getState().agents.find(candidate => candidate.id === id)

describe('setAgentIcon', () => {
  it('re-glyphs the named agent and leaves its neighbours alone', () => {
    useAgents.getState().setAgentIcon('a', 'rocket')

    expect(find('a')?.icon).toBe('rocket')
    expect(find('b')?.icon).toBe('server')
  })

  it('is a no-op — same array, same objects — when the glyph is unchanged', () => {
    const before = useAgents.getState().agents

    useAgents.getState().setAgentIcon('a', 'server')

    expect(useAgents.getState().agents).toBe(before)
  })

  it('ignores an agent that is not there', () => {
    const before = useAgents.getState().agents

    useAgents.getState().setAgentIcon('nobody', 'rocket')

    expect(useAgents.getState().agents).toBe(before)
  })

  it('survives the reconcile that follows every reconnect', () => {
    useAgents.getState().setAgentIcon('a', 'rocket')
    useAgents.getState().reconcile(SERVER, [identity(null, 'a'), identity('profile-b', 'b')])

    expect(find('a')?.icon).toBe('rocket')
  })

  it('survives a reconcile that adds an agent alongside it', () => {
    useAgents.getState().setAgentIcon('a', 'rocket')
    useAgents
      .getState()
      .reconcile(SERVER, [identity(null, 'a'), identity('profile-b', 'b'), identity('profile-c', 'c')])

    expect(find('a')?.icon).toBe('rocket')
    expect(useAgents.getState().agents).toHaveLength(3)
  })
})

