/**
 * Routes that belong to one agent, and what happens when the selection leaves.
 *
 * A session id means nothing on its own: it is unique within a backend and a
 * scope, and nowhere else (§5.2). So `/chat/[id]` and `/voice/[id]` are not
 * merely scoped by the selected agent — they are only *legible* to the agent
 * they were opened for. Switching agents underneath one leaves a screen whose
 * id addresses a session the new agent has never heard of, which is how a
 * switch ended up showing one agent's transcript with another's socket behind
 * it.
 *
 * The rule this enforces: a session screen outlives the switch by exactly as
 * long as it takes to notice. It stops reading (the id is not the new agent's
 * to resolve) and it steps out of the way the moment it is the screen in front
 * of you.
 */

import { router, useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'

import { useAgents } from './agents'

/**
 * Marks the current route as belonging to the agent selected when it opened.
 *
 * Returns whether the selection has since moved on — true means the screen is
 * addressing a session that is no longer reachable, and the caller must stop
 * loading it. Withhold the backend rather than the session id: chat's stream
 * hook already treats a null backend as "nothing to read from", so the
 * transcript it has stays on screen for the frame or two before it leaves,
 * instead of blanking or refetching against the wrong host.
 *
 * Leaving happens on focus, not on the switch itself. The switcher lives on
 * home and Sessions, so the chat that goes stale is usually *underneath* the
 * screen you switched on, and a background screen popping the stack would take
 * the foreground one with it — you would tap an agent on Sessions and be thrown
 * to home. Waiting for focus means the stale chat is skipped past on the way
 * back instead, which is the only moment its absence is the right answer.
 */
export function useAgentScopedRoute(): boolean {
  const selectedAgentId = useAgents(state => state.selectedAgentId)
  // The agent this screen was opened for. A ref, and never rewritten: the whole
  // question is whether the selection has moved since, and a value that follows
  // the selection can never answer it.
  const openedFor = useRef(selectedAgentId)
  const stale = selectedAgentId !== openedFor.current

  useFocusEffect(
    useCallback(() => {
      if (!stale) return

      // Back, so the screen you came from is the screen you land on — that is
      // Sessions or home, both of which are already showing the agent you just
      // picked. Only a screen with nothing behind it needs telling where to go:
      // a notification that opened the app straight into a session and
      // re-scoped it on the way in, or the last server being removed out from
      // under an open chat. Home, because it is the one destination that holds
      // with an empty registry — it redirects into onboarding rather than
      // rendering a screen that assumes an agent.
      if (router.canGoBack()) router.back()
      else router.replace('/')
    }, [stale])
  )

  return stale
}
