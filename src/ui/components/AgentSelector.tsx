import { router } from 'expo-router'
import { useState } from 'react'

import { useAgents, useConnectionOf, useSelectAgent, useSelectedAgentOrNull } from '@/state/agents'

import { AgentPill } from './AgentPill'
import { AgentSwitcher } from './AgentSwitcher'

/**
 * The agent selector, whole: the pill you press and the switcher it opens.
 *
 * Every screen used to wire these two together itself — five copies of the same
 * state, one of them a pill with no switcher behind it and two of them a
 * switcher no pill could open. `ScreenHeader` renders this by default now, so
 * "which agent am I talking to, and can I change it here" has one answer
 * everywhere instead of one per screen.
 *
 * Nothing renders before an agent exists. Onboarding is a screen you reach with
 * an empty registry, and a pill naming nothing is worse than no pill.
 */
export function AgentSelector() {
  // Selected straight off the store: both are arrays it already owns, so the
  // snapshot is reference-stable. Deriving one here — a `.filter()`, an object
  // literal — is what tears the screen down with "The result of getSnapshot
  // should be cached" (see `store-selectors.test.ts`).
  const servers = useAgents(state => state.servers)
  const agents = useAgents(state => state.agents)
  const dismissAgent = useAgents(state => state.dismissAgent)
  const agent = useSelectedAgentOrNull()
  const connection = useConnectionOf(agent)
  const selectAgent = useSelectAgent()
  const [open, setOpen] = useState(false)

  if (!agent) return null

  /**
   * Switching lands you on New session.
   *
   * The alternative is staying put, and staying put is rarely coherent: the
   * screens you can switch from are scoped to the agent you just left — a
   * transcript belongs to one agent's session, a cron list to one agent's jobs
   * — so keeping the screen means redrawing it against something else's data.
   * New session is the one screen that means the same thing for every agent.
   *
   * `navigate`, not `push`: New session is already at the root of the stack, so
   * this returns to it rather than growing a second copy on top.
   */
  const switchTo = (id: string) => {
    // The switcher closes itself around this call, so there is no `setOpen`
    // here — and re-picking the agent you are already on is not a switch, so it
    // closes and leaves you where you were.
    if (id === agent.id) return

    selectAgent(id)
    router.navigate('/')
  }

  return (
    <>
      <AgentPill agent={agent} connection={connection} open={open} onPress={() => setOpen(true)} />

      <AgentSwitcher
        servers={servers}
        agents={agents}
        selectedId={agent.id}
        visible={open}
        onSelect={switchTo}
        onDismissAgent={id => void dismissAgent(id)}
        onAddServer={() => router.push('/servers/new' as never)}
        onDismiss={() => setOpen(false)}
      />
    </>
  )
}
