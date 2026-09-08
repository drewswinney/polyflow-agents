/**
 * The gap between sending a message and seeing anything back.
 *
 * It used to be nothing at all: the bubble appeared, the composer went back to
 * Send, and the chat sat there until the first token — which, on a model with
 * a long time-to-first-token or a runtime the host had to rebuild, was tens of
 * seconds of looking exactly like a session doing nothing. Worse, a message
 * sent while a turn was already running was silently folded into that turn by
 * the host and gave no sign until the current step finished.
 *
 * This is the state of that gap. Pure and its own module, like `turn-settled`,
 * so the transitions are testable without a socket or a React tree behind
 * them; `session-stream` owns the value and feeds it every update.
 */

import type { PromptStatus, SessionUpdate, TranscriptEntry } from '@/domain'

export type PendingTurn =
  /**
   * Handed to the backend; no acknowledgement yet. Includes the resume.
   *
   * A notice can land here too: the host starts the turn — and may start
   * compacting for it — the moment it accepts the prompt, before the answer
   * to the submit is back on a serially read socket.
   */
  | { phase: 'sending'; since: number; notice?: string }
  /** The host accepted it and is working; nothing has arrived. */
  | { phase: 'starting'; since: number; notice?: string }
  /** Runs after the current turn ends. */
  | { phase: 'queued'; since: number }
  /** Folded into the running turn; takes effect at its next step. */
  | { phase: 'redirected'; since: number }

/**
 * A pending row older than this is dropped by a transcript refetch that
 * finds nothing running. The events that would have cleared it went down
 * with a socket, and a stale "Working…" is worse than none.
 */
export const PENDING_STALE_AFTER_MS = 15 * 60 * 1000

/**
 * What the host's answer to the submit makes of a message in flight.
 *
 * `notice` is whatever the host already said while the answer was on its
 * way; a plain start keeps it, because the wait it describes is still on.
 */
export function pendingAfterSubmit(status: PromptStatus | undefined, at: number, notice?: string): PendingTurn {
  if (status === 'queued') return { phase: 'queued', since: at }
  if (status === 'redirected') return { phase: 'redirected', since: at }

  return notice ? { phase: 'starting', since: at, notice } : { phase: 'starting', since: at }
}

/**
 * What one stream update does to the pending state.
 *
 * Returns the same object when nothing changes, so a caller using it as a
 * state updater does not re-render on every token.
 *
 * The phases differ on what counts as "seen":
 *
 * - **sending / starting** end on the first content of any kind. Text,
 *   thought, or a tool call is the turn under way; a halt on an approval or a
 *   question is the turn stopped on you, and the card says so.
 * - **queued** outlives the current turn's content by definition. It becomes
 *   `starting` when that turn completes, because that is when the host drains
 *   its queue.
 * - **redirected** also outlives the current turn's text: the correction is
 *   read at the model's next call, which shows up as the next tool call, the
 *   next turn start, or the turn ending.
 */
export function pendingAfterUpdate(current: PendingTurn | null, update: SessionUpdate): PendingTurn | null {
  if (!current) return null

  switch (update.kind) {
    case 'error':
    case 'permission_request':
    case 'clarify_request':
      return null

    case 'notice':
      return current.phase === 'starting' || current.phase === 'sending' ? { ...current, notice: update.text } : current

    case 'turn_complete':
      return current.phase === 'queued' ? { phase: 'starting', since: Date.now() } : null

    // Working, but nothing to show yet: the row stays. A redirect is the one
    // exception — a new model call is what consumes the correction.
    case 'turn_started':
      return current.phase === 'redirected' ? null : current

    case 'tool_call':
      return current.phase === 'redirected' ? null : current.phase === 'queued' ? current : contentClears(current)

    case 'agent_message_chunk':
    case 'agent_message_snapshot':
    case 'agent_thought_chunk':
      return current.phase === 'queued' || current.phase === 'redirected' ? current : null

    default:
      return current
  }
}

/** Sending and starting end on content; a tool call is content. */
function contentClears(current: PendingTurn): PendingTurn | null {
  return current.phase === 'sending' || current.phase === 'starting' ? null : current
}

/**
 * Whether a refetched transcript makes the pending row redundant.
 *
 * Consulted only once the refetch already says nothing is running. Even then
 * an unanswered user message is a turn the host may still be starting — the
 * reply is what proves it is over — unless the row has simply been there too
 * long to believe.
 */
export function pendingLooksStale(current: PendingTurn, entries: readonly TranscriptEntry[], now: number): boolean {
  if (now - current.since > PENDING_STALE_AFTER_MS) return true

  const lastMessage = [...entries].reverse().find(entry => entry.kind === 'message')

  return lastMessage?.kind === 'message' && lastMessage.role === 'agent'
}

/** The line the pending row shows. */
export function describePending(current: PendingTurn): string {
  switch (current.phase) {
    case 'sending':
      return current.notice ?? 'Sending…'
    case 'starting':
      return current.notice ?? 'Working…'
    case 'queued':
      return 'Queued — runs after the current turn'
    case 'redirected':
      return 'Noted — applies at the agent’s next step'
  }
}

/**
 * Whether a message that failed to send should go back to the outbox.
 *
 * Only when the failure is the socket: the request was refused because there
 * was no open connection, or it was still waiting on its acknowledgement when
 * the connection closed. Both are exactly what the outbox exists for. Anything
 * else — the host rejecting the session, a timeout — is an answer, and
 * retrying it blind would be a guess.
 */
export function shouldRequeue(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)

  return /not connected|connection closed|closed$/i.test(message)
}

/**
 * Whether the host already has this message.
 *
 * A prompt rejected because the socket closed may still have reached the host
 * first: the close cut off its acknowledgement, not necessarily its delivery.
 * The reconnect refetches the transcript, and Hermes persists a user row at
 * submit, so the message being the transcript's last user line — with no
 * outgoing message of ours after it — is the host saying it took it. Resending
 * then would run the turn twice, or worse, interrupt the one it started.
 */
export function alreadyLanded(entries: readonly TranscriptEntry[] | null, text: string): boolean {
  if (!entries) return false

  const trimmed = text.trim()

  if (!trimmed) return false

  const lastUser = [...entries].reverse().find(entry => entry.kind === 'message' && entry.role === 'user')

  return lastUser?.kind === 'message' && lastUser.text.trim() === trimmed
}
