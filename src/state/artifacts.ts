/**
 * Artifacts, as server state (`docs/artifacts.md` §6).
 *
 * Keyed by agent scope like every other query in `queries.ts`, and for the
 * same reason: an artifact id is only meaningful against the host that minted
 * it, so a cache shared across agents would answer one agent's screen with
 * another's files.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AgentBackend, Artifact, ArtifactKind, ArtifactPage, ArtifactShare, ArtifactVersion, SessionId } from '@/domain'

/** Every artifact query for one agent — what a mutation invalidates. */
export const artifactsRootKey = (scope: string) => ['agent', scope, 'artifacts'] as const
export const artifactsKey = (scope: string, sessionId = '', kind = '') => ['agent', scope, 'artifacts', 'list', sessionId, kind] as const
export const artifactKey = (scope: string, id: string) => ['agent', scope, 'artifacts', 'one', id] as const
export const artifactVersionsKey = (scope: string, id: string) => ['agent', scope, 'artifacts', 'versions', id] as const

/** Whether this backend keeps artifacts at all — the screen and the sidebar row hang off it. */
export function supportsArtifacts(backend: AgentBackend | null): boolean {
  return backend?.capabilities.artifacts.store === true
}

/**
 * A REST status carried on a thrown error, read structurally.
 *
 * `HermesRestError` is a backend type and this file sits above the seam; the
 * status is the only field wanted, so it is read the way `push-registration`
 * reads it.
 */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null

  const status = (error as { status?: unknown }).status

  return typeof status === 'number' ? status : null
}

/**
 * The host answered, and has no artifact routes.
 *
 * A Hermes without the plugin is a host that has not been set up, not a broken
 * one — the same distinction registration draws. The screen says "not set up
 * on this host" for this and "could not reach" for everything else.
 */
export function artifactsNotInstalled(error: unknown): boolean {
  return statusOf(error) === 404
}

export interface ArtifactListQuery {
  sessionId?: SessionId
  kind?: ArtifactKind
}

export function useArtifacts(scope: string, backend: AgentBackend | null, query: ArtifactListQuery = {}) {
  return useQuery<ArtifactPage>({
    queryKey: artifactsKey(scope, query.sessionId ?? '', query.kind ?? ''),
    enabled: supportsArtifacts(backend),
    queryFn: () => backend!.listArtifacts({ ...query, limit: 200 }),
    // A missing plugin is a stable fact about the host, not something a retry
    // will change; everything else gets the default one retry.
    retry: (count, error) => !artifactsNotInstalled(error) && count < 1
  })
}

/**
 * One artifact, painted from whichever list already holds it while the row
 * itself is fetched — the detail screen opens from a list, so the answer is
 * nearly always already in memory.
 */
export function useArtifact(scope: string, backend: AgentBackend | null, id: string) {
  const queryClient = useQueryClient()

  return useQuery<Artifact>({
    queryKey: artifactKey(scope, id),
    enabled: supportsArtifacts(backend) && id.length > 0,
    queryFn: () => backend!.getArtifact(id),
    placeholderData: () => {
      for (const [, page] of queryClient.getQueriesData<ArtifactPage>({ queryKey: [...artifactsRootKey(scope), 'list'] })) {
        const hit = page?.artifacts.find(artifact => artifact.id === id)

        if (hit) return hit
      }

      return undefined
    }
  })
}

/**
 * The earlier versions the host kept of one artifact, newest first.
 *
 * Only asked for when there could be any — `enabled` is the caller's
 * `artifact.version > 1` — since an artifact never rewritten has nothing to
 * list and the detail screen should not cost a request to learn that. Under
 * the agent's artifact root, so a delete or a rewrite refreshes it with the
 * rest.
 */
export function useArtifactVersions(scope: string, backend: AgentBackend | null, id: string, enabled: boolean) {
  return useQuery<ArtifactVersion[]>({
    queryKey: artifactVersionsKey(scope, id),
    enabled: supportsArtifacts(backend) && id.length > 0 && enabled,
    queryFn: () => backend!.listArtifactVersions(id)
  })
}

/**
 * Rename, delete, share, unshare — each invalidating every artifact query
 * for the agent, because a title or a share shows on the list row as well
 * as the detail.
 */
export function useArtifactActions(scope: string, backend: AgentBackend | null) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: artifactsRootKey(scope) })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!backend) throw new Error('Not connected')

      await backend.deleteArtifact(id)
    },
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: artifactKey(scope, id) })
      void invalidate()
    }
  })

  // The host answers with the row: a cleared name comes back as whatever the
  // file says, which only the host can read. Written into the one-artifact
  // query at once, so the heading changes under the finger rather than after
  // the refetch.
  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string | null }): Promise<Artifact> => {
      if (!backend) throw new Error('Not connected')

      return backend.renameArtifact(id, title)
    },
    onSuccess: artifact => {
      queryClient.setQueryData<Artifact>(artifactKey(scope, artifact.id), artifact)
      void invalidate()
    }
  })

  const share = useMutation({
    mutationFn: async ({ id, expiresInHours }: { id: string; expiresInHours?: number }): Promise<ArtifactShare> => {
      if (!backend) throw new Error('Not connected')

      return backend.shareArtifact(id, expiresInHours ? { expiresInHours } : {})
    },
    onSuccess: () => void invalidate()
  })

  const unshare = useMutation({
    mutationFn: async (id: string) => {
      if (!backend) throw new Error('Not connected')

      await backend.unshareArtifact(id)
    },
    onSuccess: () => void invalidate()
  })

  return { rename, remove, share, unshare }
}
