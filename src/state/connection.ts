/**
 * Owns the single live backend and the mobile-specific reconnect triggers.
 *
 * The upstream gateway client already handles the socket lifecycle and brings a
 * 15s connect timeout chosen so a sleep/wake reconnect cannot hang the composer
 * (§5.4). What it cannot know about is a phone: this adds foreground and
 * network-transition triggers on top, and never treats a dropped socket in
 * background as an error the user has to see (§10.3).
 */

import NetInfo from '@react-native-community/netinfo'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { probeScheme } from '@/backends/hermes'
import { activateBackend, MOCK_HOST, releaseBackend } from '@/backends/registry'
import type { Agent, AgentBackend, ConnectionState } from '@/domain'
import { type AgentCredential, readAgentCredential } from '@/platform/secure-store'

import { useAgents } from './agents'

export interface Connection {
  backend: AgentBackend | null
  state: ConnectionState
  /** Non-null when the last connect attempt failed. */
  error: string | null
  /** Consecutive failed attempts, for the retry line in the offline banner (§7.16). */
  attempt: number
  reconnect: () => void
}

/**
 * Connect lazily on agent switch, and hold exactly one socket (§5.2).
 *
 * Mounted once, at the root, so the socket survives navigation between tabs and
 * into a chat rather than being torn down and re-dialled per screen.
 */
export function useConnection(agent: Agent | null): Connection {
  const patchAgent = useAgents(state => state.patch)
  const [backend, setBackend] = useState<AgentBackend | null>(null)
  const [state, setState] = useState<ConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [nonce, setNonce] = useState(0)
  const wasBackgrounded = useRef(false)

  /**
   * A floor under how often this can dial, and a widening gap after failures.
   *
   * Every connect authenticates, and the host rate-limits logins — so a trigger
   * that fires repeatedly does not merely reconnect repeatedly, it gets the app
   * locked out with a 429 and turns a transient fault into a stuck one. Refs,
   * not state: this must not itself cause a render, and it must survive the
   * effect re-running.
   */
  const lastDialAt = useRef(0)
  const failures = useRef(0)

  /**
   * The live socket state, and whether this hook is mid-dial.
   *
   * Both are read by the triggers below, which must not re-subscribe every time
   * the state they are watching changes — hence refs beside the state rather
   * than the state itself.
   */
  const stateRef = useRef<ConnectionState>('idle')
  const dialing = useRef(false)

  stateRef.current = state

  /**
   * What a redial actually depends on.
   *
   * Not the agent object: its identity changes whenever *anything* on the
   * record is written, including the connection status this very effect
   * causes to be written. Depending on the object therefore means every
   * connect triggers a disconnect and another connect, forever. Only these
   * fields change where or how the socket is dialled.
   */
  const dialKey = agent
    ? [agent.id, agent.host, agent.authMode, String(agent.secure ?? ''), agent.profile ?? ''].join('|')
    : ''

  // Read inside the effect so a status write does not re-run it.
  const agentRef = useRef(agent)
  agentRef.current = agent

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function open() {
      setError(null)
      dialing.current = true

      const agent = agentRef.current

      // 1s floor between automatic dials, doubling per consecutive failure up
      // to 30s. An explicit Reconnect resets the count, because a person asking
      // is new information — the app guessing again is not.
      const cooldown = failures.current === 0 ? 1_000 : Math.min(30_000, 1_000 * 2 ** failures.current)
      const wait = Math.max(0, cooldown - (Date.now() - lastDialAt.current))

      if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait))

        if (cancelled) return
      }

      lastDialAt.current = Date.now()

      // Nothing to dial before onboarding has run. Idle, not error: an empty
      // registry is a first run, not a failure.
      if (!agent) {
        setState('idle')

        return
      }

      // An explicit reconnect must actually redial. The gateway client
      // short-circuits connect() on an already-open socket, so without tearing
      // the previous one down first, "Reconnect" would be a no-op exactly when
      // the socket is half-dead and the user is asking for help.
      if (nonce > 0) releaseBackend()

      // The mock needs no credential; a real host without one is a pairing
      // problem, surfaced rather than retried forever.
      const credential: AgentCredential | null =
        agent.host === MOCK_HOST ? { kind: 'token', token: 'mock' } : await readAgentCredential(agent.id)

      if (cancelled) return

      if (!credential) {
        setState('error')
        setError('No credentials stored for this agent. Add it again to re-pair.')

        return
      }

      // An agent added while the host was unreachable has no scheme on record,
      // and guessing one is how you get a socket that never opens. Probe once,
      // remember the answer.
      //
      // **Never fatal.** The probe is an optimisation, not a gate: it gives up
      // after 5s per scheme where the real connect gets 15s, so letting it veto
      // the attempt means a slow hop refuses a connection that would have
      // worked. On failure the agent is used exactly as it was and the connect
      // below reports what actually went wrong.
      let resolved = agent

      if (agent.secure === undefined && agent.host !== MOCK_HOST) {
        try {
          const secure = await probeScheme(agent.host)

          if (cancelled) return

          resolved = { ...agent, secure }
          patchAgent(agent.id, { secure })
        } catch {
          if (cancelled) return
        }
      }

      const next = activateBackend(resolved, credential)

      if (cancelled) return

      setBackend(next)
      const unsubscribe = next.connectionState.subscribe(value => {
        if (!cancelled) setState(value)
      })

      try {
        await next.connect(controller.signal)

        if (!cancelled) {
          failures.current = 0
          setAttempt(0)
        }
      } catch (cause) {
        if (!cancelled) {
          failures.current += 1

          // The gateway client can be left mid-dial, and a banner that says
          // "connecting" forever is worse than one that says what went wrong:
          // it looks like progress and hides the reason.
          setState('error')
          setError(cause instanceof Error ? cause.message : String(cause))
          setAttempt(count => count + 1)
        }
      }

      return unsubscribe
    }

    const pending = open().finally(() => {
      dialing.current = false
    })

    return () => {
      cancelled = true
      controller.abort()
      void pending.then(unsubscribe => unsubscribe?.())
    }
  }, [dialKey, nonce, patchAgent])

  // Switching agents re-scopes the whole app; the previous socket goes with it.
  useEffect(() => releaseBackend, [])

  // Stable across renders: it is handed out through a context whose whole point
  // is that its identity does not change when the socket's state does.
  const reconnect = useCallback(() => {
    failures.current = 0
    setNonce(value => value + 1)
  }, [])

  // Foreground → check the socket, rather than replace it on principle.
  //
  // This used to redial on every return to the app. Neither OS keeps a
  // WebSocket alive in background indefinitely — but plenty of trips out of the
  // app are seconds long and the socket is untouched when you come back, and a
  // redial is not free: it releases the backend, and a new backend makes every
  // open chat refetch its transcript and lose where you were reading. A socket
  // that did not survive says so — see the watcher below, which redials on the
  // close itself instead of on the timing of your return.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && wasBackgrounded.current) {
        wasBackgrounded.current = false

        if (stateRef.current !== 'open') setNonce(value => value + 1)
      } else if (next !== 'active') {
        wasBackgrounded.current = true
      }
    })

    return () => subscription.remove()
  }, [])

  /**
   * A socket that drops while the app is open gets redialled on its own.
   *
   * This is what makes the foreground check above safe to skip: the recovery
   * no longer hangs off returning to the app, so it also covers the socket that
   * dies with the app in front of you, which nothing used to redial at all.
   *
   * Only from `closed` — a socket that was up and went away. A failed dial ends
   * in `error`, and redialling on that is a loop with a network outage as its
   * exit condition. The delay and the `dialing` guard keep this off our own
   * teardown, which closes the previous socket on the way to opening the next.
   */
  useEffect(() => {
    if (state !== 'closed' || dialing.current) return

    const timer = setTimeout(() => {
      if (dialing.current || stateRef.current !== 'closed') return
      if (AppState.currentState !== 'active') return

      setNonce(value => value + 1)
    }, 1_200)

    return () => clearTimeout(timer)
  }, [state])

  // A cell ↔ wifi ↔ tailnet transition invalidates the socket's path even when
  // the socket itself has not noticed yet; force a redial.
  useEffect(() => {
    let previous: string | null = null

    return NetInfo.addEventListener(info => {
      // Transport only. `isInternetReachable` is tri-state and flaps — null
      // while probing, then true, then null again — and it was part of this
      // key, so every flap redialled. Each redial replaced the backend, which
      // reloaded the transcript, which reset the list to the top: a chat that
      // scrolled itself away from what you were reading, repeatedly. The path
      // changing is what invalidates a socket; reachability saying "not sure
      // yet" is not.
      const current = info.type

      if (previous !== null && previous !== current && info.isConnected) {
        setNonce(value => value + 1)
      }

      previous = current
    })
  }, [])

  return { backend, state, error, attempt, reconnect }
}
