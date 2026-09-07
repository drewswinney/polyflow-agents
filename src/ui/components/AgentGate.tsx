import type { ComponentType, FunctionComponent } from 'react'

import { useSelectedAgentOrNull } from '@/state/agents'

/**
 * Holds the invariant that `useSelectedAgent` claims.
 *
 * Every screen past home reads the selected agent as non-null, on the reasoning
 * that an empty registry is only reachable at first run. That was never true of
 * *removal*: forgetting the last server empties the registry underneath a stack
 * that is already mounted, and the screens below the one you are on re-render
 * before any redirect can move you. They read `agent.scope` off null and take
 * the root layout down with them — after which the navigator is gone and even
 * the redirect out fails.
 *
 * A screen wrapped here does not mount without an agent, so the hooks inside it
 * never see the empty state and stay free of null checks. Rendering nothing is
 * deliberate: the root ({@link app/_layout.tsx}) resets the stack to home on the
 * same state change, so this is the one frame between the registry emptying and
 * onboarding arriving — not a destination. Redirecting from here instead would
 * fire one navigation per mounted screen rather than one for the app.
 */
export function withAgent<P extends object>(Screen: ComponentType<P>): FunctionComponent<P> {
  function AgentGated(props: P) {
    const agent = useSelectedAgentOrNull()

    if (!agent) return null

    return <Screen {...props} />
  }

  AgentGated.displayName = `withAgent(${Screen.displayName ?? Screen.name ?? 'Screen'})`

  return AgentGated
}
