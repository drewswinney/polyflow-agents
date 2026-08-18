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

export {}
