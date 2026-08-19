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
  PermissionOutcome,
  PermissionRequest,
  SessionId,
  SessionTranscript,
  SessionUpdate,
  ToolCall,
  TranscriptEntry,
  Usage
} from '@/domain'

import { createStreamTail, type StreamTail } from './stream-tail'

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
  /** Messages typed while disconnected; they send on reconnect. */
  outbox: string[]
  send: (text: string) => void
  cancel: () => void
  respondToApproval: (outcome: PermissionOutcome) => void
  respondToClarify: (answer: string) => void
  reload: () => void
}

export function useSessionStream(
  backend: AgentBackend | null,
  sessionId: SessionId,
  connectionState: ConnectionState
): SessionStream {
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [approval, setApproval] = useState<PermissionRequest | null>(null)
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null)
  const [outbox, setOutbox] = useState<string[]>([])
  const [reloadNonce, setReloadNonce] = useState(0)

  const tail = useMemo(() => createStreamTail(), [sessionId])
  const wasStreaming = useRef(false)

  useEffect(() => () => tail.dispose(), [tail])

  // --- Transcript load ----------------------------------------------------
  // Re-fetched on every reconnect too: the delta stream is not resumable, so
  // the transcript is the only thing that closes a gap (§5.4).
  useEffect(() => {
    if (!backend) return

    let cancelled = false
    setLoading(true)

    backend
      .loadSession(sessionId)
      .then(loaded => {
        if (cancelled) return

        setTranscript(loaded)
        setEntries(loaded.entries)
        setUsage(loaded.usage)
        setLoadError(null)

        // An approval raised while the app was closed has no live event left to
        // deliver it — the notification is the only reason you are here, and the
        // snapshot is the only place it still exists. Never clobber a live one:
        // the socket is more current than the load it raced.
        if (loaded.pendingApproval) setApproval(current => current ?? loaded.pendingApproval)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [backend, sessionId, reloadNonce])

  /** Seal the streaming tail into a settled entry. */
  const sealTail = useCallback(() => {
    const settled = tail.finish()

    if (settled.text.trim() || settled.thinking.trim()) {
      const at = Date.now()

      setEntries(current => [
        ...current,
        ...(settled.thinking.trim()
          ? [{ kind: 'thinking' as const, id: `think-${at}`, text: settled.thinking, at }]
          : []),
        ...(settled.text.trim()
          ? [{ kind: 'message' as const, id: `agent-${at}`, role: 'agent' as const, text: settled.text, at }]
          : [])
      ])
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
          tail.appendText(update.text)
          break

        case 'agent_thought_chunk':
          wasStreaming.current = true
          tail.appendThinking(update.text)
          break

        case 'tool_call':
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
          break

        case 'error':
          sealTail()
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

  // --- Outbox drain -------------------------------------------------------
  useEffect(() => {
    if (connectionState !== 'open' || !backend || outbox.length === 0) return

    const queued = outbox
    setOutbox([])

    for (const text of queued) {
      void backend.prompt(sessionId, [{ kind: 'text', text }])
    }
  }, [connectionState, backend, sessionId, outbox])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()

      if (!trimmed) return

      const at = Date.now()
      setEntries(current => [
        ...current,
        { kind: 'message', id: `user-${at}`, role: 'user', text: trimmed, at }
      ])

      if (!backend || connectionState !== 'open') {
        setOutbox(current => [...current, trimmed])

        return
      }

      void backend.prompt(sessionId, [{ kind: 'text', text: trimmed }])
    },
    [backend, connectionState, sessionId]
  )

  const cancel = useCallback(() => {
    void backend?.cancel(sessionId)
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

  const reload = useCallback(() => setReloadNonce(value => value + 1), [])

  return {
    entries,
    tail,
    transcript,
    loading,
    loadError,
    usage,
    approval,
    clarify,
    outbox,
    send,
    cancel,
    respondToApproval,
    respondToClarify,
    reload
  }
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
