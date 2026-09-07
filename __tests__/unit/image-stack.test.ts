/**
 * The hand of cards a message's pictures fan into.
 *
 * What matters is order and identity: the front card must be the first
 * picture and must come *last*, because the view paints siblings in order
 * and a hand drawn front-first would show its back card on top.
 */

import { describe, expect, it } from '@jest/globals'

import { fanFor, STACK_VISIBLE, stackLabel } from '@/ui/image-stack'

describe('fanFor', () => {
  it('holds a single picture flat and unturned', () => {
    expect(fanFor(1)).toEqual([{ index: 0, rotate: 0, dx: 0, dy: 0 }])
  })

  it('puts the first picture in front, drawn last, for every hand size', () => {
    for (const count of [2, 3, 4, 9]) {
      const cards = fanFor(count)
      const front = cards[cards.length - 1]

      expect(front).toEqual({ index: 0, rotate: 0, dx: 0, dy: 0 })
    }
  })

  it('shows at most the visible limit, and the badge carries the rest', () => {
    expect(fanFor(2)).toHaveLength(2)
    expect(fanFor(3)).toHaveLength(STACK_VISIBLE)
    expect(fanFor(9)).toHaveLength(STACK_VISIBLE)
    expect(fanFor(9).map(card => card.index)).toEqual([2, 1, 0])
  })

  it('turns the back cards, and to different sides', () => {
    const [back, middle] = fanFor(3)

    expect(back?.rotate).toBeLessThan(0)
    expect(middle?.rotate).toBeGreaterThan(0)
    expect(Math.sign(back?.dx ?? 0)).not.toBe(Math.sign(middle?.dx ?? 0))
  })

  it('never returns an empty hand', () => {
    expect(fanFor(0)).toHaveLength(1)
  })
})

describe('stackLabel', () => {
  it('names the count and the affordance', () => {
    expect(stackLabel(4)).toBe('4 photos, opens full screen')
  })
})
