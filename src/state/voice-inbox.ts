/**
 * The hand-off from the voice screen back to the chat that opened it.
 *
 * Voice deliberately does not call `prompt()` itself. Chat owns the one send
 * path — optimistic bubble, outbox when offline, streaming tail — and a second
 * caller would bypass all three, so a dictated message would vanish from the
 * transcript until a reload and would be dropped outright while disconnected.
 * Voice transcribes; chat sends.
 */

import { create } from 'zustand'

interface VoiceInboxState {
  pending: string | null
  submit: (text: string) => void
  take: () => string | null
}

export const useVoiceInbox = create<VoiceInboxState>((set, get) => ({
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
