/**
 * Forgetting the last server must not take the app down with it.
 *
 * Every screen past home reads `useSelectedAgent()` as non-null. That held for
 * a fresh install, where home's redirect is the only way in — and not for
 * removal, which empties the registry underneath a stack that is already built.
 * The screens *below* Settings re-render first, read `agent.scope` off null and
 * throw during render, which unmounts the root layout; the `router.replace('/')`
 * that was meant to land you on onboarding then failed with "Attempted to
 * navigate before mounting the Root Layout component", and the app was stuck.
 *
 * `withAgent` is what makes the non-null read true. These pin both halves: the
 * unguarded shape still crashes, and the wrapped one stops rendering instead.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import * as React from 'react'

import type { Agent, Server } from '@/domain'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { withAgent } from '@/ui/components/AgentGate'

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined)
}))

// `require`, not `import`: react-test-renderer ships no types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer')

// Tells React that `act` is available here; without it every render logs
// "The current testing environment is not configured to support act(...)".
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SERVER = 'srv-1'

const agent = (id: string, serverId: string): Agent =>
  ({ id, serverId, displayName: id, icon: 'server', accent: 'blue', scope: id }) as unknown as Agent

beforeEach(() => {
  useAgents.setState({
    servers: [{ id: SERVER, displayName: 'Host', host: 'h', connection: 'online' } as unknown as Server],
    agents: [agent('a', SERVER)],
    selectedAgentId: 'a'
  })
})

/** The shape of every gated screen: read the agent, dereference it. */
const Scoped: React.FunctionComponent = () => {
  const selected = useSelectedAgent()

  return React.createElement('span', null, selected.scope)
}

/**
 * Renders, then empties the registry the way Settings does, and reports what
 * escaped. A render that throws surfaces when `act` flushes the update, not
 * from `removeServer` itself.
 */
function renderThenForgetLastServer(component: React.FunctionComponent): Error | null {
  let thrown: Error | null = null

  // React logs the render error as well as rethrowing it; the log is noise here.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

  try {
    let tree: { unmount: () => void } | undefined

    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(component))
    })

    TestRenderer.act(() => {
      void useAgents.getState().removeServer(SERVER)
    })

    tree?.unmount()
  } catch (error) {
    thrown = error as Error
  } finally {
    spy.mockRestore()
  }

  return thrown
}

describe('an emptied registry under a mounted stack', () => {
  it('removeServer on the last server leaves no selected agent', () => {
    TestRenderer.act(() => {
      void useAgents.getState().removeServer(SERVER)
    })

    expect(useAgents.getState().agents).toEqual([])
    expect(useAgents.getState().servers).toEqual([])
  })

  it('an ungated screen throws when the registry empties under it', () => {
    // The regression itself. If this ever stops throwing, `useSelectedAgent`
    // has been made null-safe and the gate is no longer load-bearing.
    const thrown = renderThenForgetLastServer(Scoped)

    expect(thrown).not.toBeNull()
    expect(String(thrown?.message)).toContain('scope')
  })

  it('the same screen wrapped in withAgent renders nothing instead', () => {
    expect(renderThenForgetLastServer(withAgent(Scoped))).toBeNull()
  })

  it('withAgent renders the screen while an agent exists', () => {
    let tree: { toJSON: () => unknown } | undefined

    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(withAgent(Scoped)))
    })

    expect(JSON.stringify(tree?.toJSON())).toContain('a')
  })

  it('names the screen it wraps, so the tree stays readable', () => {
    expect(withAgent(Scoped).displayName).toBe('withAgent(Scoped)')
  })
})
