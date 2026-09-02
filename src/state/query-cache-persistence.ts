/**
 * The query cache, kept across launches so a cold start opens onto a chat.
 *
 * The in-memory cache already means reopening a conversation *within* a
 * sitting paints before the network is asked anything (`useTranscript`). This
 * extends that across app launches, which is the case it could not reach: a
 * kill-and-reopen, or a tap on a notification hours later, started from
 * nothing and put a spinner over a conversation the app had rendered before.
 *
 * **It never satisfies a read.** `staleTime: 0` and `refetchOnMount: 'always'`
 * on the transcript query are what make this safe, and they are not knobs to
 * turn down — see `query-cache-policy`, and the comment they carry in
 * `queries.ts`. What is restored here is what is on screen *while* the fetch
 * runs. Nothing more is claimed for it.
 *
 * Written to the **cache** directory rather than documents, unlike the
 * attachment cache next door. The distinction is whether the host can give it
 * back: an image the app sent exists nowhere else and must not be evicted, and
 * every row in here can be refetched. So the OS is welcome to reclaim it, and
 * it stays out of device backups.
 */

import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { Directory, File, Paths } from 'expo-file-system'

import {
  CACHE_SCHEMA,
  isUsableCache,
  type PersistedCache,
  shouldPersistQuery,
  trimForPersistence
} from './query-cache-policy'

const ROOT = 'query-cache'
const FILE_NAME = 'client.json'

/**
 * How long the restore may hold the splash screen.
 *
 * `_layout` learned this the hard way with `hydrate()`: a read that hangs
 * instead of rejecting never reaches its own catch, and the gate waits for
 * something that is never coming. This resolves either way, so the term it
 * contributes to the gate always settles — the app's own deadline stays a
 * backstop rather than the thing everyone relies on.
 */
const RESTORE_TIMEOUT_MS = 1_500

/**
 * How often the store may be rewritten.
 *
 * The cache changes on every fetch and the file is written whole, so this is
 * what keeps a burst of queries from turning into a burst of disk writes. The
 * trailing write is the one that matters: it is the last state that gets kept.
 */
const WRITE_THROTTLE_MS = 2_000

function cacheFile(): File {
  return new File(new Directory(Paths.cache, ROOT), FILE_NAME)
}

/**
 * The key a persisted store has to match to be used.
 *
 * The app version is in here so a release busts the cache without anyone
 * remembering to, which matters because the thing most likely to change the
 * shape of a transcript is shipping a new version of the app.
 */
export function cacheBuster(appVersion: string): string {
  return `${CACHE_SCHEMA}:${appVersion}`
}

/**
 * Paint from the last run, if there is anything worth painting.
 *
 * Best-effort throughout, and deliberately silent: every failure mode here —
 * no file, unreadable file, half-written JSON, a shape from two versions ago —
 * has the same correct answer, which is to start empty and let the fetch fill
 * it in. A cache that cannot be read is a cache that was never there.
 */
export async function restoreQueryCache(client: QueryClient, appVersion: string): Promise<void> {
  const read = async () => {
    const file = cacheFile()

    if (!file.exists) return

    const cache = JSON.parse(file.textSync()) as PersistedCache

    if (!isUsableCache(cache, cacheBuster(appVersion), Date.now())) {
      file.delete()

      return
    }

    hydrate(client, cache.state)
  }

  try {
    await Promise.race([
      read(),
      new Promise<void>(resolve => setTimeout(resolve, RESTORE_TIMEOUT_MS))
    ])
  } catch {
    // Nothing to recover: the app simply starts with an empty cache.
  }
}

/**
 * Keep the store in step with the cache for the rest of the session.
 *
 * Returns the unsubscribe, though nothing calls it today — the subscription is
 * for the life of the process. It is handed back rather than swallowed so this
 * stays something a test or a future teardown can turn off.
 */
export function startPersistingQueryCache(client: QueryClient, appVersion: string): () => void {
  const buster = cacheBuster(appVersion)
  let timer: ReturnType<typeof setTimeout> | null = null

  const write = () => {
    timer = null

    try {
      const state = trimForPersistence(dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }))
      const directory = new Directory(Paths.cache, ROOT)

      if (!directory.exists) directory.create({ intermediates: true, idempotent: true })

      const payload: PersistedCache = { buster, savedAt: Date.now(), state }

      cacheFile().write(JSON.stringify(payload))
    } catch {
      // A full disk must cost the next cold start a spinner, never the session
      // that is running now.
    }
  }

  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer === null) timer = setTimeout(write, WRITE_THROTTLE_MS)
  })

  return () => {
    if (timer !== null) {
      clearTimeout(timer)
      // Whatever the session ended holding is worth more than the last write
      // the throttle happened to allow.
      write()
    }

    unsubscribe()
  }
}
