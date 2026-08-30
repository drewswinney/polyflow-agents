/**
 * The streaming tail's two ways of taking text.
 *
 * Both halves of the doubled-reply bug lived here. The tail used to drop any
 * delta identical to the one before it — a guess at the duplication that
 * deleted real tokens instead, because a stream repeats itself constantly —
 * while the actual restatement, `message.interim`, went on being appended as
 * though it were a delta. These pin the corrected shapes: appends are never
 * second-guessed, and a restatement replaces rather than extends.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { createStreamTail } from '@/state/stream-tail'

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

/** Deltas buffer on a ~60ms timer; nothing is visible until it fires. */
function settle(): void {
  jest.advanceTimersByTime(100)
}

describe('appendText', () => {
  it('keeps a token that repeats the one before it', () => {
    const tail = createStreamTail()

    // The case the old dedupe silently ate. Doubled spaces, repeated newlines
    // and a word said twice in a row are all ordinary prose.
    for (const chunk of ['ok', ' ', ' ', 'then', ' ', 'then']) tail.appendText(chunk)
    settle()

    expect(tail.getSnapshot().text).toBe('ok  then then')
  })

  it('preserves a run of identical indent chunks in code', () => {
    const tail = createStreamTail()

    for (const chunk of ['def f():\n', '    ', '    ', 'return 1']) tail.appendText(chunk)
    settle()

    expect(tail.getSnapshot().text).toBe('def f():\n        return 1')
  })

  it('reports streaming on the first token, before the flush', () => {
    const tail = createStreamTail()

    tail.appendText('h')

    expect(tail.getSnapshot().streaming).toBe(true)
  })
})

describe('setText', () => {
  it('replaces the streamed text rather than extending it', () => {
    const tail = createStreamTail()

    tail.appendText('Hello')
    settle()
    // What `message.interim` carries: the whole message so far, including the
    // part the deltas already delivered. Appending it is the doubled bubble.
    tail.setText('Hello there')

    expect(tail.getSnapshot().text).toBe('Hello there')
  })

  it('is idempotent when the deltas already said exactly this', () => {
    const tail = createStreamTail()
    const seen = jest.fn()

    tail.appendText('Hello there')
    settle()
    tail.subscribe(seen)
    tail.setText('Hello there')

    expect(tail.getSnapshot().text).toBe('Hello there')
    expect(seen).not.toHaveBeenCalled()
  })

  it('drops deltas still buffered behind it', () => {
    const tail = createStreamTail()

    tail.appendText('Hel')
    tail.appendText('lo')
    // A snapshot arriving before the buffer flushed already covers both, so
    // letting them land afterwards would append text twice over.
    tail.setText('Hello')
    settle()

    expect(tail.getSnapshot().text).toBe('Hello')
  })

  it('carries into the sealed entry', () => {
    const tail = createStreamTail()

    tail.appendText('Hel')
    tail.setText('Hello, world')

    expect(tail.finish()).toEqual({ text: 'Hello, world', thinking: '', streaming: false })
  })
})

describe('reset', () => {
  it('clears text buffered but not yet flushed', () => {
    const tail = createStreamTail()

    tail.appendText('stale')
    tail.reset()
    settle()

    expect(tail.getSnapshot()).toEqual({ text: '', thinking: '', streaming: false })
  })
})
