import { createContext, useContext, type ReactNode } from 'react'

import type { Mention } from './mentions'

/**
 * How a `[[wiki-link]]` should be drawn, supplied by whoever knows what it
 * points at.
 *
 * The markdown renderer stays ignorant of kanban boards: it finds the mentions
 * and asks. Without a provider — every screen except Chat — a mention renders
 * as the plain text it always was, so nothing else in the app changes shape
 * because this exists.
 */
export type MentionRenderer = (mention: Mention, key: string) => ReactNode

const MentionContext = createContext<MentionRenderer | null>(null)

export function MentionProvider({ render, children }: { render: MentionRenderer; children: ReactNode }) {
  return <MentionContext.Provider value={render}>{children}</MentionContext.Provider>
}

export function useMentionRenderer(): MentionRenderer | null {
  return useContext(MentionContext)
}
