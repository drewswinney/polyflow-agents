# Vendored Hermes upstream

Pulled from the Hermes source tree on the agent host by `scripts/sync-upstream.sh`.
**Never edit these files in place** (§9). Adaptations wrap them from
`src/backends/hermes/`.

- **Pinned ref:** `c86197e60798801f62986e4e59460b1272d0c687`
- **Synced:** 2026-08-18
- **Source tree:** `hermes:~/.hermes/hermes-agent`

## What is vendored, and why

| Path | Upstream | Compiled? | Why |
|---|---|---|---|
| `shared/` | `apps/shared/src/` | yes | The gateway client, WS-URL resolution and backend scoping. Zero runtime dependencies — its only devDependency is TypeScript — so it drops into React Native as-is. |
| `types/hermes.ts` | `apps/desktop/src/types/hermes.ts` | yes | The complete API type surface, 1,500 lines of it. This is the half of the desktop client that carries real maintenance value. |
| `reference/hermes-desktop-client.ts` | `apps/desktop/src/hermes.ts` | **no** — excluded in `tsconfig.json` | Kept for diffing endpoint shapes on each sync. Not imported. See below. |

## Why the desktop client is reference-only

§9 of the architecture assumed all three paths would be vendored and used. Reading
`apps/desktop/src/hermes.ts` changed that: every REST call in it goes through
`window.hermesDesktop.api(...)` — the Electron IPC bridge — and its connection
descriptor comes from `window.hermesDesktop.getConnection()`. It is the desktop
app's *bridge*, not an HTTP client, so on a phone there is nothing in it to run.

`src/backends/hermes/rest.ts` is our own client instead, typed against the
vendored types. That keeps the expensive half (types, which change with every
API addition) synced, and owns the cheap half (a `fetch` wrapper) locally.

## React Native gaps

All three are real, all are in vendored code, and all are shimmed in
`src/platform/polyfills.ts` rather than by patching the vendor tree:

1. **`URL`** — `JsonRpcGatewayClient.connect()` validates its argument with
   `new URL(wsUrl)` and reads `url.protocol`. RN's built-in `URL` does not
   populate `protocol`, so every connect would throw *"gateway connect()
   requires a ws:// or wss:// URL string"* against a perfectly valid URL.
   Fixed by `react-native-url-polyfill/auto`.
2. **`DOMException`** — `JsonRpcGatewayClient.request()` rejects an aborted call
   with `new DOMException('Aborted', 'AbortError')`. `DOMException` is not a
   global in Hermes, the JS engine RN runs, so an abort would throw a
   `ReferenceError` *instead of* the intended rejection. Fixed by a shim class.

3. **`window.location`** — `buildHermesWebSocketUrl()` guards on
   `typeof window === 'undefined'` and otherwise reads `window.location.host`.
   That guard asks the wrong question on RN, where `window` exists but
   `window.location` does not, so every dial threw *"Cannot read property 'host'
   of undefined"* before a socket was opened. Found on device, not by reading:
   it needs a real dial against a real host, which no bundle check performs.

`WebSocketLike` is typed as the DOM `WebSocket`; RN provides one with
`addEventListener` support, and `WebSocket.OPEN` is present. No shim needed.

## Re-syncing

```
npm run sync:upstream          # defaults to ssh host `hermes`
npm run typecheck              # an upstream break must surface here
```
