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
  PromptResult,
  SessionId,
  SessionTranscript,
  SessionUpdate,
  ToolCall,
  TranscriptEntry,
  Usage
} from '@/domain'
import type { PickedImage } from '@/platform/image-attachments'

import { ensureArtifactFile } from '@/platform/artifact-cache'

import { cacheSentImage, cachedImageUri } from './attachment-cache'
import {
  alreadyLanded,
  pendingAfterSubmit,
  pendingAfterUpdate,
  pendingLooksStale,
  type PendingTurn,
  shouldRequeue
} from './pending-turn'
import { useTranscript } from './queries'
import { createStreamTail, type StreamTail } from './stream-tail'
import { turnLooksSettled } from './turn-settled'

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
  /**
   * The model this session is on *now*.
   *
   * Not `transcript.model`, which is a snapshot from whenever the transcript
   * last loaded: a switch — from this app, the TUI or the desktop — changes
   * the session without reloading it, and the composer's chip has to follow.
   * Falls back to the loaded value until the host says otherwise.
   */
  model: string | null
  loading: boolean
  loadError: string | null
  usage: Usage | null
  approval: PermissionRequest | null
  clarify: ClarifyRequest | null
  /** Messages composed while disconnected; they send on reconnect. */
  outbox: Outgoing[]
  /**
   * A message sent and not yet answered with anything visible.
   *
   * The composer's Stop and the work section both wait on content; this is
   * what fills the gap before it — the send itself, the host's acknowledgement,
   * and whatever the host said it did with a message that landed mid-turn.
   */
  pending: PendingTurn | null
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
  /** `turnActive` as the stream callback sees it, which must not close over a render. */
  const turnActiveRef = useRef(false)
  turnActiveRef.current = turnActive
  const [pending, setPendingState] = useState<PendingTurn | null>(null)
  /**
   * The pending state as of the last write, not the last render.
   *
   * The submit's acknowledgement lands in a promise callback, which has to
   * know whether content already overtook it — a fast turn can stream and
   * complete before `prompt.submit` returns — and a render may not have
   * happened in between. Written inside the updater so the two never disagree.
   */
  const pendingRef = useRef<PendingTurn | null>(null)

  const setPending = useCallback((next: PendingTurn | null | ((current: PendingTurn | null) => PendingTurn | null)) => {
    setPendingState(current => {
      const value = typeof next === 'function' ? next(current) : next

      pendingRef.current = value

      return value
    })
  }, [])

  const tail = useMemo(() => createStreamTail(), [sessionId])
  const wasStreaming = useRef(false)

  /**
   * The rows, readable from an effect that must not re-run when they change.
   *
   * The transcript sync below asks whether a tool is still running before it
   * settles `turnActive`. Depending on `entries` for that would re-run the
   * whole sync on every token that seals, which is both wasteful and wrong —
   * the sync exists to fold in a *fetch*, not to react to the stream.
   */
  const entriesRef = useRef<TranscriptEntry[]>(entries)
  entriesRef.current = entries

  useEffect(() => () => tail.dispose(), [tail])

  /**
   * Pictures this device never kept, fetched back from the host.
   *
   * A reloaded turn names its images and nothing else, and `withCachedImages`
   * can only answer from this phone's own copies — so a picture sent from
   * another device, or before a reinstall, came back as a name-only chip. The
   * host's artifact store now keeps every sent picture (`docs/artifacts.md`
   * §6), so a chip is looked up there by the name the host stored it under
   * and, when found, filed into the local cache so the next open is free.
   *
   * Tried once per name per session. A name the host does not have stays a
   * chip; asking again on every token that seals would be a list call per
   * reply for a picture that is not coming.
   */
  const askedHostFor = useRef(new Set<string>())

  useEffect(() => {
    if (!backend?.capabilities.artifacts.store) return

    const missing = new Set<string>()

    for (const entry of entries) {
      if (entry.kind !== 'message' || !entry.images) continue

      for (const image of entry.images) {
        const key = `${sessionId}:${image.name}`

        if (!image.uri && !askedHostFor.current.has(key)) {
          askedHostFor.current.add(key)
          missing.add(image.name)
        }
      }
    }

    if (missing.size === 0) return

    let cancelled = false

    void resolveHostImages(backend, sessionId, missing).then(resolved => {
      if (cancelled || resolved.size === 0) return

      setEntries(current =>
        current.map(entry =>
          entry.kind === 'message' && entry.images?.some(image => !image.uri && resolved.has(image.name))
            ? { ...entry, images: entry.images.map(image => (image.uri ? image : { ...image, uri: resolved.get(image.name) ?? image.uri })) }
            : entry
        )
      )
    })

    return () => {
      cancelled = true
    }
  }, [backend, sessionId, entries])

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
  // Cleared on the session id rather than on transcript load: a reload that
  // races a switch would otherwise reinstate the model the switch replaced.
  const [liveModel, setLiveModel] = useState<string | null>(null)

  useEffect(() => {
    setLiveModel(null)
    setPending(null)
  }, [sessionId, setPending])

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

    /**
     * A turn that ended while the socket was down never reported it.
     *
     * `turnActive` is cleared by `turn_complete`, which arrives on the stream —
     * so a turn that finished while the app was backgrounded, or during any
     * other drop, cleared nothing. The transcript refetch brought the reply
     * back, the composer went on offering Stop for a turn that was long over,
     * and nothing ever took it away: the next `turn_complete` belongs to the
     * *next* turn, so the button sat there until you started one.
     *
     * The refetch is the right place to settle it, because the refetch is what
     * closes the gap the drop left. What it may not do is contradict the live
     * stream, so this only speaks when the stream has nothing to say:
     *
     * - **Connected**, so events can reach us again. Mid-drop the honest answer
     *   is still "a turn was running", and Stop is unusable anyway — cancelling
     *   needs the socket.
     * - **Nothing streaming**, so a reply arriving right now is not cut off.
     * - **Nothing halted on you** — an approval or a question means the turn is
     *   stopped but very much alive, waiting on an answer.
     * - **No tool still running.** This is the one that matters: a tool can run
     *   for minutes with no tokens, and that is exactly when Stop earns its
     *   place. A drop marks in-flight tools `unknown` (§7.16), so a card left
     *   `running` means the live stream still believes in it.
     *
     * Being wrong in this direction is cheap and self-correcting: if the turn
     * really is still going, its next chunk or tool call sets this true again.
     * Being wrong in the other direction is the stuck button.
     */
    if (
      turnLooksSettled({
        connectionState,
        streaming: wasStreaming.current || tail.getSnapshot().streaming,
        entries: entriesRef.current,
        transcript
      })
    ) {
      setTurnActive(false)

      // The pending row is held to a higher bar than Stop: nothing running is
      // not the same as answered, and a message the host is still starting on
      // must keep saying so. The reply being in the transcript is what ends
      // it — or the row having been there too long to believe.
      const waiting = pendingRef.current

      if (waiting && pendingLooksStale(waiting, restored, Date.now())) setPending(null)
    }
  }, [transcript, sessionId, connectionState, tail, setPending])

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
  /**
   * The rows the reconnect's refetch came back with, once it has.
   *
   * The outbox drain waits on this before sending, because a message whose
   * acknowledgement died with the socket may have reached the host all the
   * same — and the refetched transcript is the only thing that can say so.
   * Resolves to null when there was no reconnect to wait on, or the fetch
   * failed, which the drain reads as "cannot know" and sends.
   */
  const gapClosed = useRef<Promise<TranscriptEntry[] | null>>(Promise.resolve(null))

  useEffect(() => {
    if (!backend) return

    const reconnected = dialledWith.current !== null && dialledWith.current !== backend

    dialledWith.current = backend

    if (reconnected) {
      gapClosed.current = refetch().then(
        result => result.data?.entries ?? null,
        () => null
      )
    }
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
      // Every update is news for a message waiting on one. Returns the same
      // object when it is not, so this is free per token.
      setPending(current => pendingAfterUpdate(current, update))

      switch (update.kind) {
        // The host has taken the turn up. Stop is offered from here, not from
        // the first token: a rebuilt runtime or a slow model can keep the first
        // token away for a long time, and that is exactly when cancelling is
        // wanted.
        case 'turn_started':
          setTurnActive(true)
          break

        // Consumed above, into the pending row, when there is one. With no
        // row and a turn running it is the host compacting between steps —
        // the same silent wait, only mid-turn — so it starts one. The next
        // content clears it, as for any other start.
        case 'notice':
          if (turnActiveRef.current) {
            const text = update.text

            setPending(current => current ?? { phase: 'starting', since: Date.now(), notice: text })
          }
          break

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

        case 'model_changed':
          setLiveModel(update.model)
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
  }, [backend, sessionId, tail, sealTail, setPending])

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
  /**
   * How many times each message has been handed to the backend.
   *
   * A send that fails on the socket goes back to the outbox, and the outbox
   * drains on `open` — so without a ceiling, a socket that reports open and
   * refuses every send would bounce one message between the two forever.
   */
  const attempts = useRef(new Map<string, number>())

  /**
   * Send one message, and own what happens to it.
   *
   * This used to be a bare `void dispatch(...)`, which meant a `prompt.submit`
   * rejected by a closing socket was marked sent, never retried, never
   * reported — and the reconnect's transcript refetch then wiped the bubble.
   * The message was gone and nothing had said so. Now:
   *
   * - the row shows *Sending…* from the tap, through the resume and any
   *   image upload, until the host answers;
   * - the answer becomes the pending row — *Working…*, or what the host did
   *   with a message that landed mid-turn — and offers Stop once the host has
   *   actually started;
   * - a failure that is the socket puts the message back in the outbox, where
   *   the next reconnect sends it, deduplicated against the refetched
   *   transcript by the drain below;
   * - any other failure is said, in the transcript, where the bubble is.
   */
  const deliver = useCallback(
    (backend: AgentBackend, message: Outgoing) => {
      sent.current.add(message.id)
      attempts.current.set(message.id, (attempts.current.get(message.id) ?? 0) + 1)
      setPending({ phase: 'sending', since: Date.now() })

      dispatch(backend, sessionId, message, setEntries).then(
        result => {
          const status = result.status ?? 'started'

          // A message the host folded into a running turn, or queued behind
          // it, is news whatever has streamed since: that content was the
          // other turn's. A plain start only speaks if nothing has overtaken
          // it — a fast turn can stream and complete before the ack lands,
          // and re-raising Stop for it would strand the button.
          if (status !== 'started') {
            setPending(pendingAfterSubmit(status, Date.now()))
          } else if (pendingRef.current?.phase === 'sending') {
            setPending(current => pendingAfterSubmit(status, Date.now(), current?.phase === 'sending' ? current.notice : undefined))
            setTurnActive(true)
          }
        },
        cause => {
          setPending(current => (current?.phase === 'sending' ? null : current))

          if (shouldRequeue(cause) && (attempts.current.get(message.id) ?? 1) < MAX_SEND_ATTEMPTS) {
            sent.current.delete(message.id)
            setOutbox(current => [...current, message])

            return
          }

          setEntries(current => [
            ...current,
            {
              kind: 'message',
              id: `err-${Date.now()}`,
              role: 'system',
              text: `Could not send: ${cause instanceof Error ? cause.message : String(cause)}`,
              at: Date.now()
            }
          ])
        }
      )
    },
    [sessionId, setPending]
  )

  // --- Outbox drain -------------------------------------------------------
  useEffect(() => {
    if (connectionState !== 'open' || !backend || outbox.length === 0) return

    const queued = outbox.filter(message => !sent.current.has(message.id))

    setOutbox([])

    if (queued.length === 0) return

    for (const message of queued) sent.current.add(message.id)

    // After the reconnect's refetch, when there is one: a message whose ack
    // died with the socket may already be the host's, and the refetched rows
    // are how it says so. Sending it again would run the turn twice — or, on
    // this host's default, interrupt the very turn it started.
    //
    // Not cancelled on cleanup. Clearing the outbox above re-runs this effect
    // at once, and a cleanup that abandoned the wait would abandon the send.
    // The `sent` set is what keeps a re-run from claiming these twice.
    void gapClosed.current.then(landed => {
      const unsent = queued.filter(message => !alreadyLanded(landed, message.text))

      // Put back any bubble the reconnect's transcript refetch took with it,
      // so the message is on screen while it goes out rather than
      // reappearing a reload later. Appended at the end, which is where it
      // belongs: it is the newest thing said. A message the host already has
      // is in the refetched rows under the host's own id, so it needs none.
      setEntries(current => {
        const known = new Set(current.map(entry => entry.id))
        const missing = unsent.filter(message => !known.has(message.id))

        return missing.length === 0 ? current : [...current, ...missing.map(bubbleFor)]
      })

      for (const message of unsent) deliver(backend, message)
    })
  }, [connectionState, backend, outbox, deliver])

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

      deliver(backend, message)
    },
    [backend, connectionState, deliver]
  )

  const cancel = useCallback(() => {
    void backend?.cancel(sessionId)
    setTurnActive(false)
    setPending(null)
    sealTail()
  }, [backend, sessionId, sealTail, setPending])

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
    model: liveModel ?? transcript?.model ?? null,
    loading,
    loadError,
    usage,
    approval,
    turnActive,
    pending,
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

/** Sends per message before a socket failure is reported instead of retried. */
const MAX_SEND_ATTEMPTS = 3

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
): Promise<PromptResult> {
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

  if (!result.images.length) return result

  // Keyed by where the image came from, because that is the one field both
  // sides of the round trip agree on.
  const filed = new Map(
    result.images.map(stored => [
      stored.sourceUri,
      { name: stored.name, uri: cacheSentImage(sessionId, stored.name, stored.sourceUri) ?? stored.sourceUri }
    ])
  )

  // File each picture with the host as well, under the name it just gave it.
  //
  // The local copy above is what this phone shows; this is what every other
  // device shows, and what this one shows after its cache is gone. Not awaited
  // and not fatal: the message is already away, and a picture that fails to
  // file is a chip on some later device, not a turn that did not happen.
  if (backend.capabilities.artifacts.store) {
    for (const stored of result.images) {
      const picked = message.images.find(image => image.uri === stored.sourceUri)

      void backend
        .uploadArtifact({ name: stored.name, mimeType: picked?.mimeType ?? 'image/jpeg', sessionId, uri: stored.sourceUri })
        .catch(error => console.warn('[artifacts] could not file a sent picture with the host:', error))
    }
  }

  setEntries(current =>
    current.map(entry =>
      entry.kind === 'message' && entry.images?.length
        ? { ...entry, images: entry.images.map(image => (image.uri ? (filed.get(image.uri) ?? image) : image)) }
        : entry
    )
  )

  return result
}

/**
 * Find sent pictures on the host by the names the transcript carries.
 *
 * Only pictures this app sent (`origin: 'upload'`) are matched: an agent-made
 * image that happens to share a name is a different thing. Each hit is pulled
 * into the artifact cache and then copied into the attachment cache under the
 * host's name, so `withCachedImages` finds it synchronously next time.
 *
 * Never throws. A host without the plugin answers 404 to the list, and a
 * download that fails leaves that one chip standing.
 */
async function resolveHostImages(backend: AgentBackend, sessionId: SessionId, names: Set<string>): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  try {
    const page = await backend.listArtifacts({ sessionId, kind: 'image', limit: 200 })

    for (const artifact of page.artifacts) {
      if (artifact.origin !== 'upload' || !names.has(artifact.name) || resolved.has(artifact.name)) continue

      try {
        const uri = await ensureArtifactFile(artifact, () => backend.readArtifact(artifact.id, artifact.version))

        resolved.set(artifact.name, cacheSentImage(sessionId, artifact.name, uri) ?? uri)
      } catch {
        // This one stays a chip.
      }
    }
  } catch {
    // No store on this host, or none reachable now. Chips it is.
  }

  return resolved
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
