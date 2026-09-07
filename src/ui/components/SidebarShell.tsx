import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, View } from 'react-native'

import { useSidebar } from '@/state/sidebar'

import { useTheme } from '../ThemeProvider'
import { useSidebarWidth } from './Sidebar'

/** How long the page takes to slide off the drawer, and back over it. */
const SLIDE_MS = 220

/**
 * The drawer as a floor the page is lifted off, rather than a panel laid over it.
 *
 * The sidebar used to be a `Modal`: it slid in from the left, over the screen,
 * behind a scrim. This inverts that — the drawer is always there, underneath,
 * and opening it translates the *page* to the right to reveal what was already
 * beneath. The page keeps its own background and takes a shadow on its left
 * edge, so it reads as a sheet lifted aside rather than as a hole in the screen.
 *
 * A `Modal` cannot do this, which is why the sidebar stopped being one: a modal
 * is by definition above everything, and the whole effect depends on the drawer
 * being below.
 *
 * The sheet and the agent switcher stay modals and stay above, which is right —
 * they are asked for from the page and answer over it.
 */
export function SidebarShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const theme = useTheme()
  const open = useSidebar(store => store.open)
  const hide = useSidebar(store => store.hide)
  const width = useSidebarWidth()

  const progress = useRef(new Animated.Value(open ? 1 : 0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: SLIDE_MS,
      useNativeDriver: true
    })

    animation.start()

    return () => animation.stop()
  }, [open, progress])

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, width] })

  return (
    <View style={styles.root}>
      {/* Behind, and only as wide as it needs to be. Hidden from screen readers
          while closed: it is on screen the whole time, and a reader that walked
          into it would be reading a drawer the user has not opened. */}
      <View
        style={[styles.drawer, { width }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        {sidebar}
      </View>

      <Animated.View
        style={[
          styles.page,
          theme.shadow.sheet,
          { backgroundColor: theme.color.bg, transform: [{ translateX }] }
        ]}
      >
        {children}

        {/* Over the page, not over the drawer: while the drawer is open the
            page is a target for closing it and nothing else. Rendered only
            when open so it never intercepts a tap meant for the screen. */}
        {open ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={hide}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  drawer: { ...StyleSheet.absoluteFillObject, right: undefined },
  page: { flex: 1 }
})
