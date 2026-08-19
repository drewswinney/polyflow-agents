/**
 * M0, minus the host.
 *
 * The live spike (`m0-spike.ts`) needs `hermes serve` running. This proves the
 * same two things without one, so it can run in CI:
 *
 * 1. the **vendored, unmodified** `JsonRpcGatewayClient` connects, dispatches
 *    events and round-trips a request — driven through its `socketFactory` seam
 *    with a fake socket instead of a network
 * 2. real-shaped Hermes frames map onto the normalised `SessionUpdate` union,
 *    so nothing Hermes-shaped can leak above the domain layer
 *
 *   npm run check:m0
 */

import assert from 'node:assert/strict'

import type { SessionUpdate } from '../src/domain/backend.ts'
import { JsonRpcGatewayClient } from '../vendor/hermes/shared/json-rpc-gateway.ts'
import { mapGatewayEvent } from '../src/backends/hermes/event-map.ts'

/** Assert an update's kind and narrow to it, so the checks below read as data. */
function expect<K extends SessionUpdate['kind']>(
  update: SessionUpdate | undefined,
  kind: K
): Extract<SessionUpdate, { kind: K }> {
  assert.ok(update, `expected a ${kind} update, got nothing`)
  assert.equal(update.kind, kind)

  return update as Extract<SessionUpdate, { kind: K }>
}

// --- A socket the client is happy to drive ---------------------------------

type Listener = (event: any) => void

class FakeSocket {
  static readonly OPEN = 1
  readyState = 1
  sent: string[] = []

  private listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }) {
    const wrapped = options?.once
      ? (event: any) => {
          this.removeEventListener(type, wrapped)
          listener(event)
        }
      : listener

    const set = this.listeners.get(type) ?? new Set()
    set.add(wrapped)
    this.listeners.set(type, set)

    if (type === 'open') setTimeout(() => this.fire('open', {}), 0)
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.fire('close', { code: 1000 })
  }

  fire(type: string, event: any) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  deliver(frame: unknown) {
    this.fire('message', { data: JSON.stringify(frame) })
  }
}

// The client reads `WebSocket.OPEN` off the global.
;(globalThis as any).WebSocket ??= FakeSocket

// --- 1. The vendored client -------------------------------------------------

const socket = new FakeSocket()
const client = new JsonRpcGatewayClient({ socketFactory: () => socket as never, requestIdPrefix: 'check' })

const states: string[] = []
client.onState(state => states.push(state))

const events: string[] = []
client.onAny(event => events.push(event.type))

await client.connect('ws://127.0.0.1:9119/api/ws?token=test')
assert.deepEqual(states, ['idle', 'connecting', 'open'], 'connect should walk idle → connecting → open')

const pending = client.request('prompt.submit', { session_id: 'ses-1', text: 'hello' })
const sent = JSON.parse(socket.sent[0])
assert.equal(sent.method, 'prompt.submit', 'request should send the method verbatim')
assert.deepEqual(sent.params, { session_id: 'ses-1', text: 'hello' })
assert.equal(sent.jsonrpc, '2.0')

socket.deliver({ jsonrpc: '2.0', id: sent.id, result: { ok: true } })
assert.deepEqual(await pending, { ok: true }, 'a matching id should resolve the call')

socket.deliver({ method: 'event', params: { type: 'message.delta', session_id: 'ses-1', payload: { text: 'hi' } } })
assert.deepEqual(events, ['message.delta'], 'notifications should dispatch by type')

// --- 2. The event mapping ---------------------------------------------------

const ctx = { now: 1_000, toolStartedAt: new Map<string, number>() }
const map = (type: string, payload: unknown) =>
  mapGatewayEvent({ type, session_id: 'ses-1', payload } as never, ctx)

assert.deepEqual(map('message.delta', { text: 'tok' })[0], { kind: 'agent_message_chunk', text: 'tok' })
assert.deepEqual(map('thinking.delta', { text: 'hmm' })[0], { kind: 'agent_thought_chunk', text: 'hmm' })

// Content-block arrays are a legitimate provider shape, not just plain strings.
assert.deepEqual(map('message.delta', { text: [{ text: 'a' }, { text: 'b' }] })[0], {
  kind: 'agent_message_chunk',
  text: 'ab'
})

const started = expect(map('tool.start', { tool_id: 't1', name: 'shell', context: 'zpool status' })[0], 'tool_call')
assert.equal(started.call.status, 'running')
assert.equal(started.call.summary, 'zpool status')

ctx.now = 1_450
const settled = map('tool.complete', { tool_id: 't1', name: 'shell', result: 'ONLINE' })
assert.deepEqual(settled[0], { kind: 'tool_call_update', id: 't1', status: 'ok', output: 'ONLINE' })
assert.equal(settled[1].kind, 'event', 'a completed tool should also reach the event log')

const failed = expect(map('tool.complete', { tool_id: 't2', name: 'shell', error: 'ECONNREFUSED' })[0], 'tool_call_update')
assert.equal(failed.status, 'error', 'an error payload must settle the card as error, not ok')

const approval = expect(
  map('approval.request', {
    request_id: 'req-1',
    command: 'sudo zfs destroy tank/x',
    description: 'destroys a dataset'
  })[0],
  'permission_request'
)
assert.equal(approval.req.sudo, true, 'a sudo command should be recognised as one')
assert.equal(approval.req.allowPermanent, true, 'allow_permanent is opt-out, not opt-in')
assert.equal(approval.req.expiresAt, null, 'approvals carry no TTL in the API today')

const usage = expect(map('session.usage', { usage: { input: 10, output: 4, total: 14 } })[0], 'usage')
assert.deepEqual(usage, {
  kind: 'usage',
  usage: { inputTokens: 10, outputTokens: 4, contextTokens: 14, costUsd: undefined }
})

// Anything with no chat meaning still has to reach Logs & events.
expect(map('gateway.ready', {})[0], 'event')

console.log('M0 offline check passed: vendored gateway client runs, and Hermes events normalise.')
