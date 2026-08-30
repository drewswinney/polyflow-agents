/**
 * Whether a refetched transcript shows a turn that is already over.
 *
 * Its own module, and pure, for the reason `notification-copy` is: this is a
 * decision, and a decision is worth testing without a filesystem, a socket or a
 * React tree behind it. `session-stream` cannot be imported in a test at all —
 * it reaches the attachment cache, which reaches `expo-file-system`.
 */

import type { ConnectionState, SessionTranscript, TranscriptEntry } from '@/domain'

export interface TurnEvidence {
  connectionState: ConnectionState
  /** Whether the tail is receiving, or received something this turn. */
  streaming: boolean
  entries: TranscriptEntry[]
  transcript: Pick<SessionTranscript, 'pendingApproval' | 'pendingClarify'>
}

/**
 * Whether a refetched transcript shows a turn that is over.
 *
 * Only ever consulted to *stop* claiming a turn is running; nothing here can
 * start one. See the call site for why each condition is present — in short,
 * this must never contradict a live stream, so it stays silent whenever the
 * stream still has something to say.
 */
export function turnLooksSettled(state: TurnEvidence): boolean {
  // Not connected: a turn may well still be running where we cannot see it, and
  // saying otherwise is the guess §7.16 refuses to make.
  if (state.connectionState !== 'open') return false

  // Halted on you is not finished.
  if (state.transcript.pendingApproval || state.transcript.pendingClarify) return false

  // A reply is arriving right now.
  if (state.streaming) return false

  // A tool the live stream still believes is running. Minutes can pass here
  // with no tokens, and it is exactly when Stop is worth having. A drop marks
  // these `unknown` (§7.16), so `running` means the stream, not a stale row.
  return !state.entries.some(
    entry => entry.kind === 'tool' && (entry.call.status === 'running' || entry.call.status === 'pending')
  )
}
