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
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'artifact'
}

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, ROOT)
}

/**
 * One directory per id and version, and inside it the file under its *own*
 * name. The share sheet and every app it hands the file to show the filename,
 * so a flat `<id>-v<n>.md` would have put a hash in front of the recipient
 * where "report.md" belonged. The directory carries the identity; the file
 * carries the name.
 */
/**
 * Which rendering of an artifact: the bytes themselves, or the host's
 * first-page thumbnail. Both live in the artifact's directory, and the
 * thumbnail is always a PNG whatever the file is.
 */
export type ArtifactVariant = 'file' | 'thumbnail'

type ArtifactRef = Pick<Artifact, 'id' | 'version' | 'name'>

function cacheFile(artifact: ArtifactRef, variant: ArtifactVariant = 'file'): File {
  const directory = `${safeSegment(artifact.id)}-v${artifact.version}`

  return new File(cacheDirectory(), directory, variant === 'thumbnail' ? 'thumbnail.png' : safeSegment(artifact.name))
}

/** The local copy, if this device still has one. Cheap: a stat. */
export function cachedArtifactUri(artifact: ArtifactRef, variant: ArtifactVariant = 'file'): string | undefined {
  try {
    const file = cacheFile(artifact, variant)

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
  artifact: ArtifactRef,
  read: () => Promise<ArtifactBytes>,
  variant: ArtifactVariant = 'file'
): Promise<string> {
  const cached = cachedArtifactUri(artifact, variant)

  if (cached) return Promise.resolve(cached)

  const key = `${artifact.id}:${artifact.version}:${variant}`
  const pending = inflight.get(key)

  if (pending) return pending

  const download = (async () => {
    const { bytes } = await read()
    const file = cacheFile(artifact, variant)
    const directory = file.parentDirectory

    if (!directory.exists) directory.create({ intermediates: true, idempotent: true })

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

/**
 * The host's first-page thumbnail for an artifact, fetched on first use.
 *
 * A miss is final for this version — the host has no renderer for that kind
 * of file — so there is no retry, and the error is the signal a tile reads
 * to fall back to the full picture or a glyph. Kept as long as the file
 * itself.
 */
export function useArtifactThumbnail(backend: AgentBackend | null, artifact: Artifact | null | undefined) {
  return useQuery<string>({
    queryKey: ['artifact-thumbnail', artifact?.id ?? '', artifact?.version ?? 0],
    enabled: Boolean(backend && artifact),
    queryFn: () => ensureArtifactFile(artifact!, () => backend!.readArtifactThumbnail(artifact!.id), 'thumbnail'),
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false
  })
}
