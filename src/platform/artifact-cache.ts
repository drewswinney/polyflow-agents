/**
 * This device's copy of an artifact's bytes.
 *
 * Under the *cache* directory, not documents: the host is the store of record
 * (`docs/artifacts.md`), and a copy the OS reclaims under pressure costs one
 * download. That is the opposite trade from `attachment-cache.ts`, whose copies
 * were the only ones anywhere until the host started keeping them too.
 *
 * Keyed by id and version. Ids are 96 random bits minted on the host, so they
 * do not need a server prefix to stay apart; the version is what turns a
 * rewrite into a fresh download rather than a stale picture.
 *
 * Fetched through the backend, never by handing an `<Image>` the URL: the
 * bytes route sits behind the host's auth, and the image pipeline on Android
 * carries neither the bearer header nor the cookie jar `fetch` does.
 */

import { useQuery } from '@tanstack/react-query'
import { Directory, File, Paths } from 'expo-file-system'

import type { AgentBackend, Artifact, ArtifactBytes } from '@/domain'

const ROOT = 'artifacts'

/** One path segment, and nothing that could climb out of the cache directory. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'artifact'
}

/** The extension the OS share sheet and image decoder key on, kept from the name. */
function extensionOf(name: string): string {
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(name)

  return match ? match[0].toLowerCase() : ''
}

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, ROOT)
}

function cacheFile(artifact: Pick<Artifact, 'id' | 'version' | 'name'>): File {
  return new File(cacheDirectory(), `${safeSegment(artifact.id)}-v${artifact.version}${extensionOf(artifact.name)}`)
}

/** The local copy, if this device still has one. Cheap: a stat. */
export function cachedArtifactUri(artifact: Pick<Artifact, 'id' | 'version' | 'name'>): string | undefined {
  try {
    const file = cacheFile(artifact)

    return file.exists ? file.uri : undefined
  } catch {
    return undefined
  }
}

/** Downloads in flight, so two tiles for one picture share a fetch. */
const inflight = new Map<string, Promise<string>>()

/**
 * The local copy, downloading it first if there is none.
 *
 * Resolves to a `file://` URI an `<Image>` or the share sheet can take. Throws
 * when the download or the write fails; the caller decides what a missing
 * picture looks like.
 */
export function ensureArtifactFile(
  artifact: Pick<Artifact, 'id' | 'version' | 'name'>,
  read: () => Promise<ArtifactBytes>
): Promise<string> {
  const cached = cachedArtifactUri(artifact)

  if (cached) return Promise.resolve(cached)

  const key = `${artifact.id}:${artifact.version}`
  const pending = inflight.get(key)

  if (pending) return pending

  const download = (async () => {
    const { bytes } = await read()
    const directory = cacheDirectory()

    if (!directory.exists) directory.create({ intermediates: true, idempotent: true })

    const file = cacheFile(artifact)

    file.write(bytes)

    return file.uri
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, download)

  return download
}

/**
 * The local URI for an artifact, fetching on first use.
 *
 * A query rather than an effect so that every tile asking for the same picture
 * shares one answer, and so a screen that comes back paints from memory. Held
 * indefinitely once known: the bytes for an id and version never change, and
 * the file itself is what could vanish, which the next `ensure` notices.
 */
export function useArtifactFile(backend: AgentBackend | null, artifact: Artifact | null | undefined) {
  return useQuery<string>({
    // Deliberately not under `['agent', …]`: this is a fact about this
    // device's disk, not server state, and it must not be persisted with the
    // server cache — a restored path to a file the OS has since evicted would
    // draw as a broken image until the next launch.
    queryKey: ['artifact-file', artifact?.id ?? '', artifact?.version ?? 0],
    enabled: Boolean(backend && artifact),
    queryFn: () => ensureArtifactFile(artifact!, () => backend!.readArtifact(artifact!.id)),
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: 1
  })
}
