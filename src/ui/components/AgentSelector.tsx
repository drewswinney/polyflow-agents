import { useConnectionOf, useSelectedAgentOrNull } from '@/state/agents'
import { useSheet } from '@/state/sheet'

import { AgentPill } from './AgentPill'

/**
 * The agent selector: the pill you press, and the sheet it asks for.
 *
 * Every screen used to wire these two together itself — five copies of the same
 * state, one of them a pill with no switcher behind it and two of them a
 * switcher no pill could open. `ScreenHeader` renders this by default now, so
 * "which agent am I talking to, and can I change it here" has one answer
 * everywhere instead of one per screen.
 *
 * Nothing renders before an agent exists. Onboarding is a screen you reach with
 * an empty registry, and a pill naming nothing is worse than no pill.
 *
 * The list — and what selecting does — lives in the sheet, not here. This used
 * to own both, which meant the switcher's modal opened from wherever the pill
 * happened to be mounted; once that was inside the sidebar's own modal, it was
 * a modal inside a modal.
 */
export function AgentSelector() {
  const agent = useSelectedAgentOrNull()
  const connection = useConnectionOf(agent)
  const openSheet = useSheet(store => store.open)
  // A primitive, so the store read stays reference-stable (see
  // `store-selectors.test.ts`) — this drives nothing but the chevron.
  const showing = useSheet(store => store.request?.kind === 'agent')

  if (!agent) return null

  return <AgentPill agent={agent} connection={connection} open={showing} onPress={() => openSheet({ kind: 'agent' })} />
}
