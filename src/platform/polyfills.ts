/**
 * Globals the vendored upstream client assumes and React Native does not ship.
 *
 * Both gaps were found by reading the vendored code against RN's runtime, and
 * both are M0 findings (see `vendor/hermes/UPSTREAM.md`):
 *
 * - `JsonRpcGatewayClient.connect()` validates its argument with `new URL(...)`
 *   and reads `url.protocol`. RN's built-in `URL` is a stub that does not
 *   populate `protocol`, so every connect would throw "requires a ws:// or
 *   wss:// URL string" against a perfectly good URL.
 * - `JsonRpcGatewayClient.request()` rejects an aborted call with
 *   `new DOMException('Aborted', 'AbortError')`. `DOMException` is not a global
 *   in Hermes (the JS engine), so aborting would throw a ReferenceError
 *   *instead of* the intended rejection.
 * - `buildHermesWebSocketUrl()` guards on `typeof window === 'undefined'` and
 *   otherwise reads `window.location.host`. On RN that guard is the wrong
 *   question: `window` exists, `window.location` does not — so every dial threw
 *   *"Cannot read property 'host' of undefined"* before a socket was opened.
 *   The values do not matter (the app always passes host and protocol
 *   explicitly); the property merely has to exist to be read.
 *
 * Imported for side effects from `app/_layout.tsx`, before anything touches the
 * gateway.
 */

import 'react-native-url-polyfill/auto'

if (typeof globalThis.DOMException === 'undefined') {
  class DOMExceptionShim extends Error {
    constructor(message?: string, name = 'Error') {
      super(message)
      this.name = name
    }
  }

  Object.defineProperty(globalThis, 'DOMException', {
    value: DOMExceptionShim,
    writable: true,
    configurable: true
  })
}

// A browser-shaped `location` the vendored URL builder can read past. Only the
// two fields it touches, and only when RN has not provided one.
//
// Guarded, because this runs before anything else in the app: if the property
// were already defined and non-configurable, `defineProperty` throws, and a
// throw here is not a failed polyfill — it is an app that will not open at all.
// A missing shim costs one broken feature; a throw costs everything.
if (typeof window !== 'undefined' && (window as { location?: unknown }).location === undefined) {
  try {
    Object.defineProperty(window, 'location', {
      value: { host: '', protocol: 'http:' },
      writable: true,
      configurable: true
    })
  } catch {
    try {
      ;(window as { location?: unknown }).location = { host: '', protocol: 'http:' }
    } catch {
      // Nothing more to try. The gateway URL builder will throw on dial, which
      // surfaces in the connection banner rather than on the splash screen.
    }
  }
}

export {}
