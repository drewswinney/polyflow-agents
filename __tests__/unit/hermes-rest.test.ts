import { HermesRest } from '@/backends/hermes/rest'

/**
 * A fetch that records the URL it was given and answers with a small body.
 * Only the URL matters here: the host's bytes routes are cached by the
 * platform for a day per URL, so the shape of the URL is the behaviour.
 */
function recordingFetch(): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input))

    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }) as typeof fetch

  return { fetchImpl, urls }
}

describe('HermesRest artifact bytes', () => {
  it('names the version in the content URL, so a rewrite is a new URL to the HTTP cache', async () => {
    const { fetchImpl, urls } = recordingFetch()
    const rest = new HermesRest({ host: 'hermes.test:9119', fetchImpl })

    const result = await rest.artifactBytes('7ea032778455c71a60a773d3', 3)

    expect(urls).toEqual(['http://hermes.test:9119/api/plugins/polyflow_agents_push/artifacts/7ea032778455c71a60a773d3/content?v=3'])
    expect(result.mimeType).toBe('text/html')
    expect(Array.from(result.bytes)).toEqual([1, 2, 3])
  })

  it('names the version in the thumbnail URL too', async () => {
    const { fetchImpl, urls } = recordingFetch()
    const rest = new HermesRest({ host: 'hermes.test:9119', fetchImpl })

    await rest.artifactThumbnail('7ea032778455c71a60a773d3', 2)

    expect(urls).toEqual(['http://hermes.test:9119/api/plugins/polyflow_agents_push/artifacts/7ea032778455c71a60a773d3/thumbnail?v=2'])
  })

  it('keeps the profile query alongside the version', async () => {
    const { fetchImpl, urls } = recordingFetch()
    const rest = new HermesRest({ host: 'hermes.test:9119', profile: 'greg', fetchImpl })

    await rest.artifactBytes('7ea032778455c71a60a773d3', 3)

    expect(urls).toEqual(['http://hermes.test:9119/api/plugins/polyflow_agents_push/artifacts/7ea032778455c71a60a773d3/content?v=3&profile=greg'])
  })

  it('gives two versions of one artifact two different URLs', async () => {
    const { fetchImpl, urls } = recordingFetch()
    const rest = new HermesRest({ host: 'hermes.test:9119', fetchImpl })

    await rest.artifactBytes('7ea032778455c71a60a773d3', 1)
    await rest.artifactBytes('7ea032778455c71a60a773d3', 3)

    expect(new Set(urls).size).toBe(2)
  })
})
