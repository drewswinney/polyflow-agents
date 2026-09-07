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
  open: (request: SheetRequest) => void
  close: () => void
}

export const useSheet = create<SheetState>(set => ({
  request: null,
  open: request => set({ request }),
  close: () => set({ request: null })
}))
