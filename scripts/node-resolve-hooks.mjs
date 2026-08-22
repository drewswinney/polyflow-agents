/**
 * The resolver half of `node-resolve.mjs`. See that file for why.
 */

import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

/** The `paths` block of `tsconfig.json`, as Node can act on it. */
const ALIASES = [
  ['@hermes/shared', 'src/backends/hermes/adapters/shared.ts'],
  ['@hermes/types', 'vendor/hermes/types/hermes.ts'],
  ['@/', 'src/']
]

/**
 * Expo packages a check must not load, and what it gets instead.
 *
 * AsyncStorage is here because the agent registry persists through it, and a
 * check that migrates a stored `agents/v1` registry needs to *seed* one — so
 * the stub is a real in-memory map rather than a thrower, and exports it.
 *
 * `expo-file-system` is here because the Hermes backend reads an image off disk
 * with it. A check drives that path with `data:` URLs, which never reach the
 * file system — so the stub exists to satisfy the import, and throws if it is
 * ever actually called, rather than pretending to have read a file.
 */
const STUBS = {
  '@react-native-async-storage/async-storage': `
    /** Exported so a check can seed a registry before hydrating one. */
    export const __store = new Map()

    export default {
      getItem: key => Promise.resolve(__store.has(key) ? __store.get(key) : null),
      setItem: (key, value) => { __store.set(key, value); return Promise.resolve() },
      removeItem: key => { __store.delete(key); return Promise.resolve() }
    }
  `,
  'expo-file-system': `
    export class File {
      constructor(uri) { this.uri = uri }
      base64() {
        throw new Error(
          'expo-file-system is stubbed under Node: a check must pass image bytes as a data: URL'
        )
      }
    }
  `
}

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile()
  } catch {
    return false
  }
}

function resolveAlias(specifier) {
  for (const [prefix, target] of ALIASES) {
    if (specifier === prefix) return new URL(target, ROOT)

    if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length)
      const base = new URL(`${target}${rest}`, ROOT)

      // The aliases are written without extensions, the way a bundler takes
      // them; try what a bundler would try. A directory is not an answer —
      // `@/domain` means `src/domain/index.ts`.
      for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(`${base.pathname}${suffix}`, base)

        if (isFile(candidate)) return candidate
      }

      return base
    }
  }

  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier in STUBS) return { url: `stub:${specifier}`, format: 'module', shortCircuit: true }

  const aliased = resolveAlias(specifier)

  if (aliased) return { url: aliased.href, shortCircuit: true }

  // App code imports its siblings extensionless, as a bundler allows. Only
  // reached when Node's own resolution has already declined.
  if (specifier.startsWith('.')) {
    try {
      return await nextResolve(specifier, context)
    } catch (error) {
      const base = new URL(specifier, context.parentURL)

      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(`${base.pathname}${suffix}`, base)

        if (isFile(candidate)) return { url: candidate.href, shortCircuit: true }
      }

      throw error
    }
  }

  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  if (url.startsWith('stub:')) {
    return { format: 'module', source: STUBS[url.slice('stub:'.length)], shortCircuit: true }
  }

  return nextLoad(url, context)
}
