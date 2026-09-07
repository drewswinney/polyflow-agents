/**
 * Which bottom sheet is open (§7.2).
 *
 * Mounted once above the router like the sidebar, for the same reason: a sheet
 * has to cover the composer and the keyboard, and a sheet rendered *inside*
 * the composer is trapped in the keyboard inset that positions it.
 *
 * The request carries its own data rather than the host reaching for it. A
 * callback is allowed — `onPick` below — because it is set at the moment of
 * opening and dropped on close, so it cannot go stale the way a handler
 * registered once and kept would.
 */

import { create } from 'zustand'

import type { PickSource } from '@/platform/image-attachments'

export type SheetRequest =
  | {
      kind: 'model'
      /**
       * The session being re-pointed, or null on home — where the session does
       * not exist yet and the pick rides on `session.create` instead. Never the
       * profile default either way (§7.11).
       */
      sessionId: string | null
      /** Marks the current pick — the session's model, not the host's. */
      currentModel: string | null
      /** Told the choice instead of the host, when there is no session. */
      onPick?: (model: string) => void
    }
  | { kind: 'add-to-chat'; onPick: (source: PickSource) => void }
  /**
   * Which agent the app is pointed at (§7.13).
   *
   * Carries nothing: the switcher reads the registry itself, and a snapshot
   * taken at open time would go stale the moment discovery reconciled.
   */
  | { kind: 'agent' }

interface SheetState {
  request: SheetRequest | null
  /**
   * Work waiting for the sheet to leave the screen. Set by `close(after)`,
   * run once by `settle()`.
   */
  afterClose: (() => void) | null
  open: (request: SheetRequest) => void
  /**
   * Close the sheet. `after` runs once the sheet has *left the screen*, which
   * is later than this returning: the sheet is a native `Modal` that stays
   * mounted through its exit animation, and iOS presents whatever comes next
   * — the camera, the photo picker — on the topmost view controller, which
   * for that window is the Modal's own. The picker then goes down with the
   * Modal, which is how "Take photo" opened a camera that closed itself.
   * Anything that opens a native screen of its own goes through `after`.
   *
   * Only meaningful from an open sheet: the host reports the leaving, and a
   * sheet that is already gone will not report it again.
   */
  close: (after?: () => void) => void
  /** Called by the host when the sheet is off screen: runs what was waiting. */
  settle: () => void
}

export const useSheet = create<SheetState>((set, get) => ({
  request: null,
  afterClose: null,
  // Reopening abandons anything still waiting: a callback that presents a
  // native screen over a sheet that has just come back is exactly the
  // stacking this exists to avoid.
  open: request => set({ request, afterClose: null }),
  // `close` is handed straight to `onPress` and `onRequestClose` in places,
  // so what arrives may be a press event rather than a callback. Only a
  // function is worth waiting for.
  close: after => set({ request: null, afterClose: typeof after === 'function' ? after : null }),
  settle: () => {
    const { afterClose } = get()

    if (!afterClose) return

    set({ afterClose: null })
    afterClose()
  }
}))
