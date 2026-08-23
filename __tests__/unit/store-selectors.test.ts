/**
 * Store reads have to be reference-stable.
 *
 * zustand v5 passes the selector straight to `useSyncExternalStore` with no
 * equality function (see `zustand/react.js`), so React compares one read to the
 * next with `Object.is`. A selector that *builds* its result — `.filter()`,
 * `.map()`, an object literal — hands back a new reference every time, the
 * snapshot never settles, and React tears the screen down with "The result of
 * getSnapshot should be cached to avoid an infinite loop".
 *
 * That is what crashed Settings: it selected `state.agents.filter(...)` to
 * count the agents on a server. The fix is to select what the store already
 * owns and derive in the component, which is the rule these tests pin.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import * as React from 'react'

import type { Agent, Server } from '@/domain'
import { useAgents } from '@/state/agents'

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined)
}))

// `require`, not `import`: react-test-renderer ships no types, and this is the
// one place the repo renders React outside the app.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer')

const SERVER = 'srv-1'

const agent = (id: string, serverId: string): Agent =>
  ({ id, serverId, displayName: id, icon: 'server', accent: 'blue' }) as unknown as Agent

beforeEach(() => {
  useAgents.setState({
    servers: [{ id: SERVER, displayName: 'Host', host: 'h', connection: 'online' } as unknown as Server],
    agents: [agent('a', SERVER), agent('b', SERVER), agent('c', 'srv-2')],
    selectedAgentId: 'a'
  })
})

/**
 * Renders and reports what React logged.
 *
 * `act` is what makes this deterministic: React reports the bad snapshot from a
 * scheduler flush rather than from `create`, so without it the assertion runs
 * before the log exists. The render of a looping component throws — that is the
 * behaviour under test, so it is swallowed and only the log is returned.
 */
function renderCapturingErrors(component: React.FunctionComponent): string {
  // Collected as they arrive: `mockRestore` clears `mock.calls`, so reading
  // them off the spy afterwards always yields nothing.
  const logged: string[] = []
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })

  try {
    TestRenderer.act(() => {
      try {
        TestRenderer.create(React.createElement(component))
      } catch {
        // The crash itself is the point; the log is the assertion.
      }
    })
  } catch {
    // Same, for a throw surfaced when act flushes.
  } finally {
    spy.mockRestore()
  }

  return logged.join('\n')
}

describe('zustand selectors must return stable references', () => {
  it('a selector that filters returns a fresh array for identical state', () => {
    const select = (state: { agents: Agent[] }) => state.agents.filter(a => a.serverId === SERVER)

    expect(select(useAgents.getState())).toEqual(select(useAgents.getState()))
    // Equal, but not the same object — which is all `Object.is` looks at.
    expect(select(useAgents.getState())).not.toBe(select(useAgents.getState()))
  })

  it('the arrays the store owns are the same reference across reads', () => {
    expect(useAgents.getState().agents).toBe(useAgents.getState().agents)
    expect(useAgents.getState().servers).toBe(useAgents.getState().servers)
  })

  it('selecting a built array trips React s infinite-loop guard', () => {
    const Filtering: React.FunctionComponent = () => {
      const onThisServer = useAgents(state => state.agents.filter(a => a.serverId === SERVER))

      return React.createElement('span', null, String(onThisServer.length))
    }

    expect(renderCapturingErrors(Filtering)).toContain('getSnapshot should be cached')
  })

  it('selecting the stored array and filtering in the component does not', () => {
    // The shape app/settings.tsx uses for `onThisServer`.
    const Deriving: React.FunctionComponent = () => {
      const agents = useAgents(state => state.agents)
      const onThisServer = agents.filter(a => a.serverId === SERVER)

      return React.createElement('span', null, String(onThisServer.length))
    }

    expect(renderCapturingErrors(Deriving)).not.toContain('getSnapshot should be cached')
  })
})
