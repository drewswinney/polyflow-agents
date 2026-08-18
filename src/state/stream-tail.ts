/**
 * The streaming tail, kept outside React state on purpose (§7.3 step 2).
 *
 * Deltas arrive per token. If the tail lived in the screen's state, every token
 * would re-render the whole transcript. Instead the tail is an external store
 * that only the last bubble subscribes to via `useSyncExternalStore`; settled
 * entries above it are memoised and never re-render while text streams in.
 *
 * Step 1 of the same ladder lives here too: deltas accumulate in a buffer and
 * flush on a ~60ms timer, so a fast provider cannot drive one render per token.
 */

const FLUSH_INTERVAL_MS = 60

export interface TailSnapshot {
  text: string
  thinking: string
  /** True between the first delta and `turn_complete`. */
  streaming: boolean
}

const EMPTY: TailSnapshot = { text: '', thinking: '', streaming: false }

export interface StreamTail {
  subscribe(listener: () => void): () => void
  getSnapshot(): TailSnapshot
  appendText(chunk: string): void
  appendThinking(chunk: string): void
  /** Flush anything buffered and stop streaming; returns the settled text. */
  finish(): TailSnapshot
  reset(): void
  dispose(): void
}

export function createStreamTail(): StreamTail {
  let snapshot: TailSnapshot = EMPTY
  let pendingText = ''
  let pendingThinking = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const flush = () => {
    timer = null

    if (!pendingText && !pendingThinking) return

    snapshot = {
      text: snapshot.text + pendingText,
      thinking: snapshot.thinking + pendingThinking,
      streaming: true
    }
    pendingText = ''
    pendingThinking = ''
    emit()
  }

  const schedule = () => {
    if (timer === null) timer = setTimeout(flush, FLUSH_INTERVAL_MS)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    appendText(chunk) {
      pendingText += chunk

      if (!snapshot.streaming) {
        // Mark streaming immediately so the composer flips to Stop on the first
        // token rather than up to 60ms later.
        snapshot = { ...snapshot, streaming: true }
        emit()
      }

      schedule()
    },
    appendThinking(chunk) {
      pendingThinking += chunk
      schedule()
    },
    finish() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }

      flush()
      snapshot = { ...snapshot, streaming: false }
      emit()

      return snapshot
    },
    reset() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }

      pendingText = ''
      pendingThinking = ''
      snapshot = EMPTY
      emit()
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)

      listeners.clear()
    }
  }
}
