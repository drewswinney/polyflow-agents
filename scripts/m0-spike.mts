/**
 * M0 — the gate (§13).
 *
 * Connects to a live `hermes serve` using the *vendored, unmodified* upstream
 * gateway client and prints every event it receives. If this passes, the whole
 * TypeScript thesis holds: upstream client code runs outside Electron.
 *
 * Node 22+ ships a global `WebSocket`, so this runs with type stripping and no
 * dependencies:
 *
 *   HERMES_HOST=127.0.0.1:9119 HERMES_TOKEN=… npm run spike:m0
 *
 * Note what this does and does not prove. It proves the protocol and the
 * vendored client. It does not prove React Native — RN's `URL` and missing
 * `DOMException` are separate gaps, shimmed in `src/platform/polyfills.ts`, and
 * only running the app proves those.
 */

import { JsonRpcGatewayClient } from '../vendor/hermes/shared/json-rpc-gateway.ts'
import { buildHermesWebSocketUrl } from '../vendor/hermes/shared/websocket-url.ts'

const host = process.env.HERMES_HOST
const token = process.env.HERMES_TOKEN
const secure = process.env.HERMES_SECURE === '1'

if (!host || !token) {
  console.error('Set HERMES_HOST (host:port) and HERMES_TOKEN.')
  process.exit(1)
}

const wsUrl = buildHermesWebSocketUrl({
  path: '/api/ws',
  host,
  protocol: secure ? 'https:' : 'http:',
  authParam: ['token', token]
})

const client = new JsonRpcGatewayClient({ requestIdPrefix: 'm0' })

client.onState(state => console.log(`[state] ${state}`))
client.onAny(event => {
  console.log(`[event] ${event.type}${event.session_id ? ` session=${event.session_id}` : ''}`)

  if (event.payload) console.log('        ', JSON.stringify(event.payload).slice(0, 240))
})

console.log(`Dialling ${wsUrl.replace(token, '***')}`)

await client.connect(wsUrl)
console.log('Connected. Listening for events — Ctrl-C to stop.')

process.on('SIGINT', () => {
  client.close()
  process.exit(0)
})
