/**
 * The live turn: transcript, streaming tail, tool cards, approvals, outbox.
 *
 * Session state is authoritative on the agent; this is a reconnecting client
 * that replays from the last event it saw (§5.4). Three consequences are
 * implemented here rather than left to the screen:
 *
 * - outgoing messages queue in an outbox and send on reconnect
 * - a drop mid-turn leaves the truncated sentence in place and marks a
 *   stream-cut point rather than deleting it
 * - in-flight tool calls become `unknown` — the app does not guess (§7.16)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AgentBackend,
  ClarifyRequest,
  ConnectionState,
  ContentBlock,
  MessageImage,
  PermissionOutcome,
  PermissionRequest,
  SessionId,
  SessionTranscript,
  SessionUpdate,
  ToolCall,
  TranscriptEntry,
  Usage
} from '@/domain'
import type { PickedImage } from '@/platform/image-attachments'

import { cacheSentImage, cachedImageUri } from './attachment-cache'
import { useTranscript } from './queries'
import { createStreamTail, type StreamTail } from './stream-tail'

/**
 * A message waiting on a reconnect, images and all.
 *
 * Carries the id of the bubble it is drawn in. The reconnect that drains the
 * outbox also refetches the transcript (§5.4), and that refetch replaces
 * `entries` wholesale with rows the host knows about — which cannot include a
 * message that has not been sent yet. The bubble was therefore wiped off the
 * screen at the exact moment it was finally going out, and stayed gone until
 * the *next* reload. Knowing its id lets the drain put it back.
 */
interface Outgoing {
  id: string
  at: number
  text: string
  images: PickedImage[]
}

export interface SessionStream {
  /** Settled entries only. The streaming tail renders separately (§7.3). */
  entries: TranscriptEntry[]
  tail: StreamTail
  transcript: SessionTranscript | null
  loading: boolean
  loadError: string | null
  usage: Usage | null
  approval: PermissionRequest | null
  clarify: ClarifyRequest | null
  /** Messages composed while disconnected; they send on reconnect. */
  outbox: Outgoing[]
  /** True from the first token until the turn ends, tool runs included. */
  turnActive: boolean
  send: (text: string, images?: PickedImage[]) => void
  cancel: () => void
  respondToApproval: (outcome: PermissionOutcome) => void
  respondToClarify: (answer: string) => void
  reload: () => void
}

export function useSessionStream(
  backend: AgentBackend | null,
  scope: string,
  sessionId: SessionId,
  connectionState: ConnectionState
): SessionStream {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [approval, setApproval] = useState<PermissionRequest | null>(null)
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null)
  const [outbox, setOutbox] = useState<Outgoing[]>([])
  /**
   * Whether a turn is still running, including while a tool executes and no
   * tokens are arriving.
   *
   * Separate from the tail's own `streaming` flag because sealing the tail at a
   * tool boundary clears that one — and the composer uses it to offer Stop. A
   * long tool run is exactly when cancelling matters most.
   */
  const [turnActive, setTurnActive] = useState(false)

  const tail = useMemo(() => createStreamTail(), [sessionId])
  const wasStreaming = useRef(false)

  useEffect(() => () => tail.dispose(), [tail])

  // --- Transcript load ----------------------------------------------------
  /**
   * Cached across mounts, refetched on every one.
   *
   * Both halves matter and they pull in opposite directions. Reopening a chat
   * used to start from nothing — the fetch lived in an effect here and its
   * result died with the screen — so the back gesture, the sidebar and a
   * notification all led to a spinner over a conversation the app had rendered
   * seconds earlier. The query cache outlives the screen, so what you were
   * reading is on screen before the network is asked anything.
   *
   * And it is still asked, every time. The delta stream is not resumable
   * (§5.4), so refetching is the only thing that closes the gap a disconnect
   * leaves; the cache paints *during* that fetch and never in place of it. See
   * `useTranscript`, where the two options that guarantee it live.
   */
  const query = useTranscript(scope, backend, sessionId)
  const transcript = query.data ?? null

  /**
   * Loading is "nothing to show", not "nothing in flight".
   *
   * A refetch with a cached transcript behind it must not raise the spinner:
   * chat swaps the whole list out while this is true, and a reconnect — which
   * refetches by design — would tear the transcript down and rebuild it at the
   * bottom, losing the read position for a fetch that usually returns the same
   * rows. `isPending` is false the moment there is a cached answer, which is
   * exactly the distinction wanted.
   */
  const loading = query.isPending
  const loadError = query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null

  /**
   * Fold a loaded transcript into what is on screen.
   *
   * Runs when the fetched data changes identity — which, thanks to React
   * Query's structural sharing, a refetch returning the same rows does not do
   * at all.
   */
  useEffect(() => {
    if (!transcript) return

    // Keep the existing array when the content is the same. A reload is
    // routine — every reconnect refetches, because the delta stream is not
    // resumable (§5.4) — and handing the list a new array of identical rows
    // makes it re-key and jump to the top, throwing away wherever you were
    // reading for no gain.
    const restored = withCachedImages(sessionId, transcript.entries)

    setEntries(current => (sameEntries(current, restored) ? current : restored))
    setUsage(transcript.usage)

    // An approval raised while the app was closed has no live event left to
    // deliver it — the notification is the only reason you are here, and the
    // snapshot is the only place it still exists. Never clobber a live one:
    // the socket is more current than the load it raced.
    if (transcript.pendingApproval) setApproval(current => current ?? transcript.pendingApproval)
    if (transcript.pendingClarify) setClarify(current => current ?? transcript.pendingClarify)
  }, [transcript, sessionId])

  /**
   * A new socket means a gap to close, so the transcript is refetched.
   *
   * The backend's identity is the signal: `useConnection` builds a new one per
   * dial, so this fires exactly when a reconnect has happened. It was implicit
   * before — `backend` sat in the load effect's dependencies — and is spelled
   * out here because the fetch no longer lives in an effect of its own, and a
   * reconnect that quietly stopped refetching is a chat missing whatever
   * happened while it was down.
   */
  const refetch = query.refetch
  const dialledWith = useRef<AgentBackend | null>(null)

  useEffect(() => {
    if (!backend) return

    const reconnected = dialledWith.current !== null && dialledWith.current !== backend

    dialledWith.current = backend

    if (reconnected) void refetch()
  }, [backend, refetch])


/** Seal the streaming tail into a settled entry. */
  const sealTail = useCallback(() => {
    const settled = tail.finish()
    const text = settled.text.trim()
    const thinking = settled.thinking.trim()

    if (text || thinking) {
      const at = Date.now()

      setEntries(current => {
        // A transcript reload (every reconnect refetches, §5.4) can race a
        // live turn and land *after* the last chunk but *before*
        // `turn_complete`: the REST snapshot already carries this reply as a
        // settled row, and appending the tail on top of it doubles the
        // bubble. The reload always replaces `entries` wholesale (see
        // `sameEntries` below), so the reply — if it made it in — is the very
        // last message entry; nothing legitimate is ever *undone* by this
        // check, only a redundant append is skipped.
        const lastMessage = [...current].reverse().find(entry => entry.kind === 'message')

        // Compared trimmed on both sides, and stored trimmed below, so the two
        // halves agree. They did not: the guard tested the trimmed tail while
        // the row it had appended a moment earlier held the *untrimmed* one, so
        // a reply ending in the newline a model almost always ends on failed
        // its own check and sealed a second copy of itself.
        if (text && lastMessage?.kind === 'message' && lastMessage.role === 'agent' && lastMessage.text.trim() === text) {
          return current
        }

        return [
          ...current,
          ...(thinking ? [{ kind: 'thinking' as const, id: `think-${at}`, text: thinking, at }] : []),
          ...(text ? [{ kind: 'message' as const, id: `agent-${at}`, role: 'agent' as const, text, at }] : [])
        ]
      })
    }

    tail.reset()
    wasStreaming.current = false
  }, [tail])

  // --- Live updates -------------------------------------------------------
  useEffect(() => {
    if (!backend) return

    return backend.subscribe(sessionId, (update: SessionUpdate) => {
      switch (update.kind) {
        case 'agent_message_chunk':
          wasStreaming.current = true
          setTurnActive(true)
          tail.appendText(update.text)
          break

        // The message so far, restated. Replaces the tail rather than extending
        // it — see `agent_message_snapshot` in the domain union.
        case 'agent_message_snapshot':
          wasStreaming.current = true
          setTurnActive(true)
          tail.setText(update.text)
          break

        case 'agent_thought_chunk':
          wasStreaming.current = true
          setTurnActive(true)
          tail.appendThinking(update.text)
          break

        case 'tool_call':
          // Seal first. Whatever the agent said before reaching for a tool is
          // finished prose: sealing renders it as markdown instead of leaving
          // it as the plain-text tail, and puts it *above* the card rather than
          // below, since the tail is the list's footer. Without this, every
          // turn containing a tool showed unrendered markdown in the wrong
          // order until the turn ended.
          sealTail()
          setTurnActive(true)
          setEntries(current => upsertTool(current, update.call))
          break

        case 'tool_call_update':
          setEntries(current => patchTool(current, update.id, update.status, update.output))
          break

        case 'permission_request':
          setApproval(update.req)
          break

        case 'clarify_request':
          setClarify(update.req)
          break

        case 'usage':
          setUsage(update.usage)
          break

        case 'turn_complete':
          sealTail()
          setTurnActive(false)
          break

        case 'error':
          sealTail()
          setTurnActive(false)
          setEntries(current => [
            ...current,
            {
              kind: 'message',
              id: `err-${Date.now()}`,
              role: 'system',
              text: update.error.message,
              at: Date.now()
            }
          ])
          break

        case 'event':
          // Chat does not render raw events. They reach Activity and Logs
          // through the backend's agent-wide tap (`subscribeEvents`), which
          // sees them whether or not this session is open.
          break
      }
    })
  }, [backend, sessionId, tail, sealTail])

  // --- Disconnect mid-turn (§7.16) ---------------------------------------
  useEffect(() => {
    if (connectionState === 'open' || connectionState === 'connecting' || connectionState === 'idle') return

    // Keep the truncated sentence; mark where the stream was cut; refuse to
    // guess what happened to anything still running.
    if (wasStreaming.current || tail.getSnapshot().streaming) {
      const settled = tail.finish()
      const at = Date.now()

      setEntries(current => [
        ...current,
        ...(settled.text.trim()
          ? [{ kind: 'message' as const, id: `agent-cut-${at}`, role: 'agent' as const, text: settled.text, at }]
          : []),
        { kind: 'stream_cut' as const, id: `cut-${at}`, at }
      ])
      tail.reset()
      wasStreaming.current = false
    }

    setEntries(current =>
      current.map(entry =>
        entry.kind === 'tool' && (entry.call.status === 'running' || entry.call.status === 'pending')
          ? { ...entry, call: { ...entry.call, status: 'unknown' as const } }
          : entry
      )
    )
  }, [connectionState, tail])

  /**
   * Messages already handed to `dispatch`, by id.
   *
   * `setOutbox([])` below does not take effect until the next render, so the
   * drain effect could run a second time — on a re-render, or on React's own
   * double-invocation in development — still holding the array it had just
   * cleared, and send every queued message twice. A ref settles it inside the
   * same tick the send is made in.
   *
   * Never cleared: ids are minted per message from the clock, so this only
   * grows by what the user actually typed while offline.
   */
  const sent = useRef(new Set<string>())

  // --- Outbox drain -------------------------------------------------------
  useEffect(() => {
    if (connectionState !== 'open' || !backend || outbox.length === 0) return

    const queued = outbox.filter(message => !sent.current.has(message.id))

    setOutbox([])

    if (queued.length === 0) return

    for (const message of queued) sent.current.add(message.id)

    // Put back any bubble the reconnect's transcript refetch took with it, so
    // the message is on screen while it goes out rather than reappearing a
    // reload later. Appended at the end, which is where it belongs: it is the
    // newest thing said.
    setEntries(current => {
      const known = new Set(current.map(entry => entry.id))
      const missing = queued.filter(message => !known.has(message.id))

      return missing.length === 0 ? current : [...current, ...missing.map(bubbleFor)]
    })

    for (const message of queued) {
      void dispatch(backend, sessionId, message, setEntries)
    }
  }, [connectionState, backend, sessionId, outbox])

  const send = useCallback(
    (text: string, images: PickedImage[] = []) => {
      const trimmed = text.trim()

      // An image on its own is a message. Only a genuinely empty composer is not.
      if (!trimmed && images.length === 0) return

      const at = Date.now()
      const message: Outgoing = { id: entryIdFor(images, at), at, text: trimmed, images }

      setEntries(current => [...current, bubbleFor(message)])

      if (!backend || connectionState !== 'open') {
        setOutbox(current => [...current, message])

        return
      }

      sent.current.add(message.id)
      void dispatch(backend, sessionId, message, setEntries)
    },
    [backend, connectionState, sessionId]
  )

  const cancel = useCallback(() => {
    void backend?.cancel(sessionId)
    setTurnActive(false)
    sealTail()
  }, [backend, sessionId, sealTail])

  const respondToApproval = useCallback(
    (outcome: PermissionOutcome) => {
      if (!approval) return

      void backend?.respondToPermission(approval.id, outcome, sessionId)
      setEntries(current => patchToolHeld(current, false))
      setApproval(null)
    },
    [approval, backend, sessionId]
  )

  const respondToClarify = useCallback(
    (answer: string) => {
      if (!clarify) return

      void backend?.respondToClarify(clarify.id, answer)
      setClarify(null)
    },
    [backend, clarify]
  )

  const reload = useCallback(() => void refetch(), [refetch])

  return {
    entries,
    tail,
    transcript,
    loading,
    loadError,
    usage,
    approval,
    turnActive,
    clarify,
    outbox,
    send,
    cancel,
    respondToApproval,
    respondToClarify,
    reload
  }
}

/**
 * A stable id for the bubble a message is drawn in, so the reply from `prompt`
 * can find the row it belongs to after an await.
 *
 * Indexing would not do: a turn that lands while this one is in flight shifts
 * every position after it.
 *
 * The counter is what makes it unique. The clock alone is not: two messages can
 * be composed in the same millisecond — an outbox that queued while offline is
 * a normal way to get there — and once the id also decides which messages the
 * drain has already sent, a collision stops being a duplicated React key and
 * starts being a message silently never sent.
 */
let nextEntrySeq = 0

function entryIdFor(images: PickedImage[], at: number): string {
  return `user-${at}-${images.length}-${(nextEntrySeq += 1)}`
}

/** The bubble a queued or just-sent message is drawn in. */
function bubbleFor(message: Outgoing): TranscriptEntry {
  return {
    kind: 'message',
    id: message.id,
    role: 'user',
    text: message.text,
    at: message.at,
    // Shown from the picked file straight away. The names are provisional
    // until the agent answers with what it filed them under — see `dispatch`,
    // which rewrites them in place.
    ...(message.images.length
      ? { images: message.images.map(image => ({ name: image.name, uri: image.uri })) }
      : {})
  }
}

/**
 * Send a message and file its images under the names the agent gave them.
 *
 * The renaming is the reason this is not a bare `prompt()` call. What the phone
 * called an image is not what the transcript will call it on the next load, so
 * the local copy is filed under the *agent's* name — and the bubble already on
 * screen is relabelled to match, so the row survives the reload it is about to
 * be replaced by.
 */
async function dispatch(
  backend: AgentBackend,
  sessionId: SessionId,
  message: Outgoing,
  setEntries: (update: (current: TranscriptEntry[]) => TranscriptEntry[]) => void
): Promise<void> {
  const content: ContentBlock[] = [
    ...(message.text ? [{ kind: 'text' as const, text: message.text }] : []),
    ...message.images.map(image => ({
      kind: 'image' as const,
      uri: image.uri,
      mimeType: image.mimeType,
      name: image.name
    }))
  ]

  const result = await backend.prompt(sessionId, content)

  if (!result.images.length) return

  // Keyed by where the image came from, because that is the one field both
  // sides of the round trip agree on.
  const filed = new Map(
    result.images.map(stored => [
      stored.sourceUri,
      { name: stored.name, uri: cacheSentImage(sessionId, stored.name, stored.sourceUri) ?? stored.sourceUri }
    ])
  )

  setEntries(current =>
    current.map(entry =>
      entry.kind === 'message' && entry.images?.length
        ? { ...entry, images: entry.images.map(image => (image.uri ? (filed.get(image.uri) ?? image) : image)) }
        : entry
    )
  )
}

/**
 * Point a loaded transcript's images at this device's copies.
 *
 * A reloaded turn carries the names the host stored and nothing else — there is
 * no endpoint to fetch the bytes back — so a name that matches a cached file is
 * the only way the picture reappears. One that does not stays name-only, which
 * renders as a chip rather than a broken image.
 */
function withCachedImages(sessionId: SessionId, entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map(entry =>
    entry.kind === 'message' && entry.images?.length
      ? { ...entry, images: entry.images.map(image => ({ ...image, uri: image.uri ?? cachedImageUri(sessionId, image.name) })) }
      : entry
  )
}

/**
 * Whether a reload produced the transcript that is already on screen.
 *
 * Compares what an entry *says*, not the id it says it under. Ids are not
 * shared vocabulary: an entry sealed here from the live stream is keyed
 * `agent-<timestamp>`, and the same sentence coming back from the host is keyed
 * by its stored id. Comparing ids therefore reported "changed" on every reload
 * after a turn — for a transcript whose text was identical — and the list, told
 * every row was new, re-keyed and rebuilt all of them. That is the jump on
 * coming back into the app.
 *
 * When this returns true the caller keeps the array it already had, ids and
 * all, so nothing below it re-keys. The ids stay local, which nothing minds:
 * they key rows, and tool cards are matched by `call.id` rather than by them.
 */
function sameEntries(current: TranscriptEntry[], next: TranscriptEntry[]): boolean {
  if (current.length !== next.length) return false

  return current.every((entry, index) => saysTheSame(entry, next[index]))
}

function saysTheSame(a: TranscriptEntry | undefined, b: TranscriptEntry | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false

  if (a.kind === 'message' && b.kind === 'message') {
    return a.role === b.role && a.text === b.text && sameImages(a.images, b.images)
  }
  if (a.kind === 'thinking' && b.kind === 'thinking') return a.text === b.text
  if (a.kind === 'tool' && b.kind === 'tool') {
    return a.call.id === b.call.id && a.call.status === b.call.status && a.call.output === b.call.output
  }

  // A stream cut is local — the host has no such row — so two of them at the
  // same index is as close to equal as this gets.
  return a.kind === b.kind
}

/**
 * Compared by name and by whether a picture is on hand.
 *
 * The second half matters: a reload that resolved a local copy for a row drawn
 * without one is a real change — the difference between a chip and the image —
 * and reporting it as equal would keep the chip on screen.
 */
function sameImages(a: MessageImage[] | undefined, b: MessageImage[] | undefined): boolean {
  if (!a?.length && !b?.length) return true
  if (a?.length !== b?.length) return false

  return (a ?? []).every((image, index) => image.name === b?.[index].name && !!image.uri === !!b?.[index].uri)
}

function upsertTool(entries: TranscriptEntry[], call: ToolCall): TranscriptEntry[] {
  const index = entries.findIndex(entry => entry.kind === 'tool' && entry.call.id === call.id)

  if (index === -1) return [...entries, { kind: 'tool', id: `tool-${call.id}`, call }]

  const next = [...entries]
  const existing = next[index]

  if (existing.kind === 'tool') {
    next[index] = { ...existing, call: { ...existing.call, ...call } }
  }

  return next
}

function patchTool(
  entries: TranscriptEntry[],
  id: string,
  status: ToolCall['status'],
  output?: string
): TranscriptEntry[] {
  return entries.map(entry => {
    if (entry.kind !== 'tool' || entry.call.id !== id) return entry

    return {
      ...entry,
      call: {
        ...entry.call,
        status,
        held: false,
        output: output ?? entry.call.output,
        durationMs: Date.now() - entry.call.startedAt
      }
    }
  })
}

function patchToolHeld(entries: TranscriptEntry[], held: boolean): TranscriptEntry[] {
  return entries.map(entry =>
    entry.kind === 'tool' && entry.call.held ? { ...entry, call: { ...entry.call, held } } : entry
  )
}
