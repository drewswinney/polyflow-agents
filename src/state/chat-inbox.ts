/**
 * A message handed to chat by the screen that produced it.
 *
 * Two screens produce one: voice, after transcribing, and the new-session home,
 * whose first message is what creates the session in the first place. Neither
 * calls `prompt()` itself. Chat owns the one send path — optimistic bubble,
 * outbox when offline, streaming tail — and a second caller would bypass all
 * three, so the message would vanish from the transcript until a reload and
 * would be dropped outright while disconnected.
 */

import { create } from 'zustand'

interface ChatInboxState {
  pending: string | null
  submit: (text: string) => void
  take: () => string | null
}

export const useChatInbox = create<ChatInboxState>((set, get) => ({
  pending: null,

  submit(text) {
    const trimmed = text.trim()

    if (trimmed) set({ pending: trimmed })
  },

  take() {
    const { pending } = get()

    if (pending) set({ pending: null })

    return pending
  }
}))
