/**
 * A message handed to chat by the screen that produced it.
 *
 * Two screens produce one: voice, after transcribing, and the new-session home,
 * whose first message is what creates the session in the first place. Neither
 * calls `prompt()` itself. Chat owns the one send path — optimistic bubble,
 * outbox when offline, streaming tail — and a second caller would bypass all
 * three, so the message would vanish from the transcript until a reload and
 * would be dropped outright while disconnected.
 *
 * **A message carries the session it is for.** It used to be a bare string, and
 * whichever chat screen was mounted and loaded took it — which is not
 * necessarily the one it was written for. Home hands its first message over
 * *before* the new session's screen exists, so a chat still on the stack
 * beneath home took every one of them: the new session opened empty and the
 * previous session answered a message meant for it. Addressed, only the
 * intended screen can take it, however many are mounted.
 */

import { create } from 'zustand'

import type { SessionId } from '@/domain'

interface PendingMessage {
  sessionId: SessionId
  text: string
}

interface ChatInboxState {
  pending: PendingMessage | null
  submit: (sessionId: SessionId, text: string) => void
  /** The message, but only if it was addressed to this session. */
  take: (sessionId: SessionId) => string | null
}

export const useChatInbox = create<ChatInboxState>((set, get) => ({
  pending: null,

  submit(sessionId, text) {
    const trimmed = text.trim()

    if (trimmed) set({ pending: { sessionId, text: trimmed } })
  },

  take(sessionId) {
    const { pending } = get()

    if (!pending || pending.sessionId !== sessionId) return null

    set({ pending: null })

    return pending.text
  }
}))
