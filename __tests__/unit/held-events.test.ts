/**
 * Events held across the resume a reconnect has to do first.
 *
 * A reconnect clears the stored↔runtime session id maps and re-mints them with
 * a `session.resume` that `subscribe` does not await. Events arriving in that
 * window name an id the client cannot translate and match no sink — and being
 * dropped there is why a turn already running when the socket came back
 * streamed to nobody until its next chunk, leaving the chat looking idle while
 * the agent worked.
 *
 * Each case below is one way that window can end: the mapping lands, it never
 * does, or the host keeps talking throughout.
 */

import { describe, it, expect } from '@jest/globals'

import { createHeldEvents, HELD_EVENT_TTL_MS } from '@/backends/hermes/held-events'

/** A stand-in for a gateway event; the queue never reads one. */
interface Chunk {
  id: string
}

/** Routes only the ids a resume has taught the client about. */
function routerFor(known: string[]): (event: Chunk) => boolean {
  return event => known.includes(event.id)
}

describe('createHeldEvents', () => {
  it('replays what was waiting once the mapping lands', () => {
    // The whole point: the thinking chunks that arrived mid-resume reach the
    // chat rather than the floor.
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'a' }, 1_000)
    held.hold({ id: 'a' }, 1_010)

    expect(held.size).toBe(2)

    const delivered: Chunk[] = []
    const flushed = held.flush(
      event => {
        delivered.push(event)

        return true
      },
      1_020,
      true
    )

    expect(flushed).toBe(2)
    expect(delivered).toHaveLength(2)
    expect(held.size).toBe(0)
  })

  it('replays oldest first, so a reply reads in the order it was written', () => {
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'first' }, 1_000)
    held.hold({ id: 'second' }, 1_001)
    held.hold({ id: 'third' }, 1_002)

    const seen: string[] = []

    held.flush(
      event => {
        seen.push(event.id)

        return true
      },
      1_003,
      true
    )

    expect(seen).toEqual(['first', 'second', 'third'])
  })

  it('keeps an event no resume has explained yet', () => {
    // Two sessions resuming at once: one mapping landing must not throw away
    // what the other is still waiting for.
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'known' }, 1_000)
    held.hold({ id: 'other' }, 1_000)

    expect(held.flush(routerFor(['known']), 1_010, true)).toBe(1)
    expect(held.size).toBe(1)
  })

  it('drops what is waiting once no resume could still explain it', () => {
    // The resume settled without minting the id. Nothing further is coming, so
    // holding these only risks replaying them into a later turn.
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'orphan' }, 1_000)

    expect(held.flush(routerFor([]), 1_010, false)).toBe(0)
    expect(held.size).toBe(0)
  })

  it('drops what has aged past the TTL even mid-resume', () => {
    // A resume that never answers must not let the queue accumulate a turn's
    // worth of chunks that the reconnect's transcript refetch has since
    // covered anyway (§5.4).
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'stale' }, 1_000)

    expect(held.flush(routerFor([]), 1_000 + HELD_EVENT_TTL_MS + 1, true)).toBe(0)
    expect(held.size).toBe(0)
  })

  it('keeps an event that is exactly at the TTL edge', () => {
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'edge' }, 1_000)

    held.flush(routerFor([]), 1_000 + HELD_EVENT_TTL_MS, true)

    expect(held.size).toBe(1)
  })

  it('evicts the oldest past the limit, keeping the newest chunks', () => {
    // A host streaming hard into a resume that never comes back. The tail of a
    // reply is what is worth having.
    const held = createHeldEvents<Chunk>(3)

    for (const id of ['a', 'b', 'c', 'd', 'e']) held.hold({ id }, 1_000)

    expect(held.size).toBe(3)

    const seen: string[] = []

    held.flush(
      event => {
        seen.push(event.id)

        return true
      },
      1_010,
      true
    )

    expect(seen).toEqual(['c', 'd', 'e'])
  })

  it('does not eat an event queued by the sink it is feeding', () => {
    // `flush` swaps the array rather than splicing it, so a re-entrant hold —
    // a sink that causes another event to arrive — survives the replay it
    // happened during.
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'known' }, 1_000)

    held.flush(
      event => {
        if (event.id === 'known') held.hold({ id: 'arrived-during' }, 1_005)

        return true
      },
      1_010,
      true
    )

    expect(held.size).toBe(1)
  })

  it('costs nothing when nothing is waiting', () => {
    // The overwhelmingly common case: no reconnect in progress.
    const held = createHeldEvents<Chunk>()
    let asked = false

    expect(
      held.flush(() => {
        asked = true

        return true
      }, 1_000, true)
    ).toBe(0)
    expect(asked).toBe(false)
  })

  it('hands the router the time the event arrived, not the replay time', () => {
    // `mapGatewayEvent` measures tool durations and approval deadlines off
    // this clock. Replaying against `now` would charge them for the resume.
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'a' }, 1_000)
    held.hold({ id: 'b' }, 1_400)

    const clocks: number[] = []

    held.flush(
      (_event, at) => {
        clocks.push(at)

        return true
      },
      9_999,
      true
    )

    expect(clocks).toEqual([1_000, 1_400])
  })

  it('drops everything when the connection that fed it goes', () => {
    const held = createHeldEvents<Chunk>()

    held.hold({ id: 'a' }, 1_000)
    held.clear()

    expect(held.size).toBe(0)
  })
})
