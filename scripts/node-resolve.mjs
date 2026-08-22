/**
 * Make the app's modules importable from a check script.
 *
 * The checks in this directory run under plain Node so they can sit in CI, but
 * the code they exercise is written for Metro: it imports through the `@/` and
 * `@hermes/` aliases from `tsconfig.json`, and it imports Expo packages whose
 * entry points expect a React Native runtime.
 *
 * Rather than reshape the app to be checkable — the tail wagging the dog, and
 * the one thing that would make a check stop resembling what ships — this
 * teaches Node the same two things Metro already knows: what the aliases mean,
 * and that a native module can be stood in for.
 *
 * The stubs are deliberately tiny and deliberately loud. A check that reaches a
 * native call has left the ground it can honestly cover, and should say so
 * rather than quietly returning a plausible value.
 *
 *   node --import ./scripts/node-resolve.mjs …
 */

import { register } from 'node:module'

register('./node-resolve-hooks.mjs', import.meta.url)
