/**
 * `close(after)` waits for `settle()`.
 *
 * The sheet is a native Modal that stays mounted through its exit animation,
 * and a picker launched during that animation is presented on the Modal and
 * dismissed with it — which is how "Take photo" opened a camera that closed
 * itself. The wait lives in the store, so this pins its contract: nothing runs
 * on close, the callback runs exactly once on settle, and a press event handed
 * to `close` in place of a callback is not mistaken for one.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { useSheet } from '@/state/sheet'

beforeEach(() => {
  useSheet.setState({ request: null, afterClose: null })
})

describe('useSheet close → settle', () => {
  it('runs the callback on settle, not on close, and only once', () => {
    const after = jest.fn()

    useSheet.getState().open({ kind: 'add-to-chat', onPick: () => undefined })
    useSheet.getState().close(after)

    expect(useSheet.getState().request).toBeNull()
    expect(after).not.toHaveBeenCalled()

    useSheet.getState().settle()
    expect(after).toHaveBeenCalledTimes(1)

    useSheet.getState().settle()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('settles quietly when nothing is waiting', () => {
    useSheet.getState().close()

    expect(() => useSheet.getState().settle()).not.toThrow()
  })

  it('does not treat a press event as a callback', () => {
    useSheet.getState().open({ kind: 'agent' })
    useSheet.getState().close({ nativeEvent: {} } as never)

    expect(useSheet.getState().afterClose).toBeNull()
    expect(() => useSheet.getState().settle()).not.toThrow()
  })

  it('abandons a pending callback when the sheet reopens', () => {
    const after = jest.fn()

    useSheet.getState().open({ kind: 'agent' })
    useSheet.getState().close(after)
    useSheet.getState().open({ kind: 'agent' })
    useSheet.getState().close()
    useSheet.getState().settle()

    expect(after).not.toHaveBeenCalled()
  })
})
