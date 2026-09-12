/**
 * Earlier versions of an artifact (`docs/artifacts.md` §4.2), as the demo
 * agent keeps them: the same shape as the artifact, readable by `(id,
 * version)`, and gone when the artifact is.
 */

import { describe, expect, it, jest } from '@jest/globals'

// The demo backend reads a sent picture off disk through `expo-file-system`,
// whose native half is not here; nothing below sends one.
jest.mock('expo-file-system', () => ({ File: class {} }))

// eslint-disable-next-line import/first
import { MockBackend } from '@/backends/mock'

describe('MockBackend artifact versions', () => {
  it('lists the drafts behind a rewritten artifact, newest first, as the artifact at that version', async () => {
    const backend = new MockBackend()
    const report = await backend.getArtifact('mock-art-report')
    const versions = await backend.listArtifactVersions(report.id)

    expect(report.version).toBe(3)
    expect(versions.map(kept => kept.version)).toEqual([2, 1])

    for (const kept of versions) {
      expect(kept.id).toBe(report.id)
      expect(kept.name).toBe(report.name)
      expect(kept.share).toBeNull()
      expect(kept.archivedAt).toBeGreaterThanOrEqual(kept.updatedAt)
      expect(kept.updatedAt).toBeLessThan(report.updatedAt)
    }
  })

  it('reads each version by its own number, and the current one with or without it', async () => {
    const backend = new MockBackend()
    const report = await backend.getArtifact('mock-art-report')
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

    const current = decode((await backend.readArtifact(report.id, report.version)).bytes)
    const plain = decode((await backend.readArtifact(report.id)).bytes)
    const first = decode((await backend.readArtifact(report.id, 1)).bytes)
    const second = decode((await backend.readArtifact(report.id, 2)).bytes)

    expect(plain).toBe(current)
    expect(first).not.toBe(current)
    expect(second).not.toBe(current)
    expect(first).not.toBe(second)
    expect(first).toContain('Scrub still running')
    expect(second).toContain('110 stale snapshots')
    expect(current).toContain('412G reclaimable')
  })

  it('has nothing for a version that was never kept, and nothing for an artifact never rewritten', async () => {
    const backend = new MockBackend()

    await expect(backend.readArtifact('mock-art-report', 9)).rejects.toThrow(/not kept/)
    await expect(backend.listArtifactVersions('mock-art-timeline')).resolves.toEqual([])
    await expect(backend.listArtifactVersions('nope')).rejects.toThrow(/No such artifact/)
  })

  it('forgets every version with the artifact', async () => {
    const backend = new MockBackend()

    await backend.listArtifactVersions('mock-art-report')
    await backend.deleteArtifact('mock-art-report')

    await expect(backend.listArtifactVersions('mock-art-report')).rejects.toThrow(/No such artifact/)
    await expect(backend.readArtifact('mock-art-report', 1)).rejects.toThrow()
  })
})
