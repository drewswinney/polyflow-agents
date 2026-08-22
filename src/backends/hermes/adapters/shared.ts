/**
 * The vendored `@hermes/shared` surface this app actually uses.
 *
 * Upstream's own `index.ts` cannot be the entry point on React Native for two
 * reasons, and §9's rule — wrap vendored code, never patch it — makes this file
 * the place to deal with both:
 *
 * 1. **Extensions.** Several modules behind that barrel import siblings as
 *    `./billing-policy.js`, the NodeNext convention. Metro resolves `.js`
 *    literally and the bundle fails on a file that does not exist.
 * 2. **Surface.** The barrel drags in billing, charge settlement, cron triggers,
 *    skill scaffolding and skins — none of which a phone client touches.
 *
 * The three modules re-exported here have no imports at all, so they cross into
 * React Native untouched. `tsconfig.json` maps `@hermes/shared` to this file, so
 * call sites read as if they import the upstream package — and a sync that adds
 * a new module we want is one line here, not a patch in `vendor/`.
 */

export {
  type ConnectionState,
  type GatewayClientOptions,
  type GatewayEvent,
  type GatewayEventName,
  type GatewayRequestId,
  type JsonRpcErrorPayload,
  type JsonRpcFrame,
  JsonRpcGatewayClient,
  JsonRpcGatewayError,
  type WebSocketLike
} from '../../../../vendor/hermes/shared/json-rpc-gateway'

export {
  buildHermesWebSocketUrl,
  type GatewayAuthMode,
  GatewayReauthRequiredError,
  type GatewayWsConnection,
  type GatewayWsUrlResult,
  type HermesWebSocketUrlOptions,
  isGatewayReauthRequired,
  resolveGatewayWsUrl,
  type ResolveGatewayWsUrlDeps,
  type WebSocketAuthParam
} from '../../../../vendor/hermes/shared/websocket-url'

export {
  backendScopeKey,
  backendScopePrefix,
  LOCAL_CONNECTION_ID,
  registryBackendScopeKey
} from '../../../../vendor/hermes/shared/backend-scope'
