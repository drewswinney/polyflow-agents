/**
 * Sidebar visibility (§7.17).
 *
 * The sidebar is mounted once, above the router, so it opens from any screen
 * without every screen having to host it. That makes "is it open" app state
 * rather than screen state, which is why it lives here and not in a component.
 */

import { create } from 'zustand'

interface SidebarState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useSidebar = create<SidebarState>(set => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))
