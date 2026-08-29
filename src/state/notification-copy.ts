/**
 * What a notification says, and what identifies it.
 *
 * Split out from `notification-tap` because it is the part with no phone in it:
 * given an event, what should the banner read, and which happening is it — the
 * two questions worth pinning in tests, and neither of them needs an `AppState`
 * or a live backend.
 */

import { coerceText } from '@/backends/hermes/event-map'
import type { Agent, EventRecord, SessionId } from '@/domain'

import { forgetAnnouncement, notificationKey, type NotificationKind } from './notification-ledger'

/** How much of what the agent said fits in a banner before it is cut. */
const PREVIEW_LIMIT = 180

type Payload = Record<string, unknown> | undefined

/**
 * What the agent has said on a session this turn, kept only to describe it.
 *
 * The notification wants a sentence from the reply, and the reply arrives as
 * deltas that are otherwise the open chat's business — so a session nobody has
 * open has nothing holding its text. This is that, and nothing more: it is
 * discarded the moment the turn it describes has been announced.
 */
export interface TurnDigest {
  text: string
  /** Whether this turn's completion has already gone out. */
  announced: boolean
}

/**
 * Keep each session's live reply, so a completion can quote it.
 *
 * Mirrors the streaming tail's rule for the two events that carry assistant
 * text: `message.delta` extends, `message.interim` restates. Getting that
 * backwards here would put the reply in the banner twice, the same way it used
 * to appear in the transcript twice.
 */
export function followTurn(digests: Map<SessionId, TurnDigest>, record: EventRecord): void {
  const session = record.sessionId

  if (!session) return

  const payload = record.payload as Payload

  switch (record.name) {
    // A new turn. Anything held from the last one is history.
    case 'message.start':
      digests.set(session, { text: '', announced: false })
      break

    case 'message.delta': {
      const digest = digests.get(session) ?? { text: '', announced: false }

      digests.set(session, { text: digest.text + coerceText(payload?.text), announced: false })
      break
    }

    case 'message.interim': {
      const digest = digests.get(session) ?? { text: '', announced: false }

      digests.set(session, { text: coerceText(payload?.text) || digest.text, announced: false })
      break
    }

    // A tool run is new work on this session, so whatever was announced about
    // the last turn no longer covers what is happening now.
    case 'tool.start': {
      const digest = digests.get(session)

      if (digest) digest.announced = false
      break
    }

    // An approval answered elsewhere — on the desktop, or by the host timing
    // out — is settled, so the ledger stops speaking for it: if the same
    // request id is genuinely raised again it is announced again rather than
    // silently swallowed.
    //
    // Deliberately here, in the part that runs whatever the app is doing,
    // rather than in `describeNotification`. It was in the latter, behind the
    // check for whether the app is backgrounded — so an approval answered on
    // the desktop while you were looking at the phone never cleared its key,
    // and the next real question about it went unannounced.
    case 'approval.response':
    case 'approval.resolved':
      forgetAnnouncement(notificationKey('approval', str((record.payload as Payload)?.request_id)))
      break

    default:
      break
  }
}

export type Described = {
  kind: NotificationKind
  data: 'approval' | 'complete'
  title: string
  body: string
  /** Identity for the ledger, or null when this one cannot be deduplicated. */
  key: string | null
  sessionId?: SessionId
}

/**
 * What a banner should say about one event, or null when it says nothing.
 *
 * Exported for tests: the wording and the deduplication key are the whole
 * substance of this file, and they are worth pinning without standing up a
 * backend and an `AppState`.
 */
export function describeNotification(
  record: EventRecord,
  agent: Agent,
  digests: Map<SessionId, TurnDigest> = new Map()
): Described | null {
  const payload = record.payload as Payload

  if (record.name === 'approval.request') {
    // The command is the thing worth reading on a lock screen: it is what would
    // run on your machine if you say yes. `record.detail` carried the tool's
    // *name* at best, and usually nothing at all.
    const command = str(payload?.command)
    const description = str(payload?.description)

    return {
      kind: 'approval',
      data: 'approval',
      title: `${agent.displayName} needs approval`,
      body: previewOf(command || description || record.detail) || 'A command is waiting on your answer.',
      key: notificationKey('approval', str(payload?.request_id)),
      sessionId: record.sessionId
    }
  }

  if (record.name === 'clarify.request') {
    // The question itself, which the agent has already written out and which
    // the banner was throwing away.
    const question = str(payload?.question) || str(payload?.prompt) || coerceText(payload?.text)

    return {
      kind: 'clarify',
      data: 'approval',
      title: `${agent.displayName} has a question`,
      body: previewOf(question || record.detail) || 'The agent is waiting on your answer.',
      key: notificationKey('clarify', str(payload?.request_id)),
      sessionId: record.sessionId
    }
  }

  // A finished turn. `background.complete` is the host telling us one landed
  // while we were detached; `message.complete` is the ordinary end of a turn,
  // which is what a turn started before you looked away actually ends on and
  // which nothing used to report.
  if (record.name === 'background.complete' || record.name === 'message.complete') {
    const digest = record.sessionId ? digests.get(record.sessionId) : undefined

    // Already announced, and nothing has happened on this session since. The
    // host sends both events for one turn often enough that this is the normal
    // case rather than an edge.
    if (digest?.announced) return null

    const said = previewOf(digest?.text ?? '') || previewOf(str(payload?.summary) || str(payload?.text)) || record.detail

    return {
      kind: 'complete',
      data: 'complete',
      title: `${agent.displayName} finished`,
      body: said || 'A turn completed while you were away.',
      key: notificationKey('complete', record.sessionId),
      sessionId: record.sessionId
    }
  }

  if (record.name.startsWith('cron.') && record.status === 'error') {
    return {
      kind: 'cron_failure',
      data: 'complete',
      title: `${agent.displayName}: a cron job failed`,
      body: previewOf(str(payload?.error) || record.detail) || 'A scheduled job did not finish.',
      key: notificationKey('cron_failure', str(payload?.job_id) || record.detail || record.sessionId),
      sessionId: record.sessionId
    }
  }

  return null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * A line of prose fit for a lock screen.
 *
 * A banner gets two or three lines and no markdown renderer, so the fenced code
 * and heading marks an agent writes freely are noise there — worse than noise,
 * because they crowd out the sentence that would have told you what happened.
 * Cut at a word so the preview does not end mid-token.
 */
export function previewOf(text: string): string {
  const flat = text
    // A fenced block reads as a wall of backticks in a banner. Say what it was
    // instead; the chat is one tap away for the rest.
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (flat.length <= PREVIEW_LIMIT) return flat

  const cut = flat.slice(0, PREVIEW_LIMIT)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > PREVIEW_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
