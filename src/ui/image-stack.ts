/**
 * How a message's pictures fan out into a hand of cards.
 *
 * Several pictures on one message used to tile into a grid, which read as a
 * gallery — a thing to browse — when what they are is *one* attachment to one
 * message. A hand of cards says that: one object, with more behind it, and
 * the full set a tap away. The geometry lives here rather than in the view so
 * the rules — how many show, which is in front, how the rest peek out — can
 * be pinned without rendering anything.
 */

export interface StackCard {
  /** Which picture. 0 is the first sent, and the front of the hand. */
  index: number
  /** Degrees. Positive is clockwise, as `rotate` reads it. */
  rotate: number
  /** Offset from the front card, in points. */
  dx: number
  dy: number
}

/** The most cards a hand shows. The badge carries the true count. */
export const STACK_VISIBLE = 3

/**
 * The cards to draw for `count` pictures, back to front — so that rendering
 * them in order puts the front card on top.
 *
 * The first picture leads: it is the one the person chose first, and the one
 * a single-picture message would have shown. The others peek out to either
 * side, turned a little, the way a hand is held.
 */
export function fanFor(count: number): StackCard[] {
  const visible = Math.min(Math.max(count, 0), STACK_VISIBLE)

  if (visible <= 1) return [{ index: 0, rotate: 0, dx: 0, dy: 0 }]

  if (visible === 2) {
    return [
      { index: 1, rotate: -8, dx: -14, dy: 4 },
      { index: 0, rotate: 0, dx: 0, dy: 0 }
    ]
  }

  return [
    { index: 2, rotate: -10, dx: -22, dy: 6 },
    { index: 1, rotate: 8, dx: 20, dy: 3 },
    { index: 0, rotate: 0, dx: 0, dy: 0 }
  ]
}

/** What the screen reader says for the whole hand. */
export function stackLabel(count: number): string {
  return `${count} photos, opens full screen`
}
