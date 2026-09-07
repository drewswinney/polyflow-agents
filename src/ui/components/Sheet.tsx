import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Keyboard, Modal, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { Text } from './Text'

/** How long the panel takes to arrive, and to leave. Matches the sidebar. */
const SLIDE_MS = 200
/** Drag far enough, or flick hard enough, and the release dismisses. */
const DISMISS_DISTANCE = 90
const DISMISS_VELOCITY = 0.6

/**
 * A card that swipes up from the bottom.
 *
 * The same shape as the sidebar on the other axis — RN `Modal` so it escapes
 * every parent's clipping, an `Animated` scrim, and a `mounted` flag trailing
 * `visible` so the panel can animate out before the Modal is torn down.
 *
 * Purely presentational: it knows how to arrive, be dragged and leave, and
 * nothing about what it holds. What goes in it is `children`.
 *
 * Dragging uses `PanResponder` rather than `react-native-gesture-handler`.
 * Inside an RN `Modal` the gesture handler needs its own root view to receive
 * touches on Android, and a second gesture system inside a modal is a lot of
 * machinery to buy one downward drag.
 */
export function Sheet({
  visible,
  title,
  onDismiss,
  onHidden,
  children
}: {
  visible: boolean
  /** Named for the screen reader, and drawn as the card's heading. */
  title: string
  onDismiss: () => void
  /**
   * The sheet has left the screen: its exit animation is done and the Modal
   * is out of the tree. Later than `visible` dropping, by the length of the
   * animation — and that gap is the point. Whoever closed the sheet may be
   * about to present a native screen of their own, and iOS puts that on the
   * topmost view controller, which until this fires is the Modal's — so it
   * would be dismissed along with the Modal. See `useSheet.close`.
   */
  onHidden?: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  const [mounted, setMounted] = useState(visible)

  /**
   * How much of the sheet the keyboard is covering.
   *
   * Tracked here rather than borrowing `KeyboardInset`: that leans on Android
   * resizing the window, and a `Modal` has a window of its own that the
   * activity's `adjustResize` never touches — so a sheet with a text input in
   * it would sit under the keyboard on exactly the platform this is tested on.
   */
  const [keyboard, setKeyboard] = useState(0)

  useEffect(() => {
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      event => setKeyboard(event.endCoordinates.height)
    )
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboard(0)
    )

    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current
  // The live drag, in pixels below resting. Kept separate from `progress` so a
  // release can animate the slide-out without fighting the drag's own value.
  const drag = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      setMounted(true)
      drag.setValue(0)
    }

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      useNativeDriver: true
    })

    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })

    return () => animation.stop()
  }, [visible, progress, drag])

  // Reported from an effect rather than from the animation's completion, so
  // it runs after the commit that removed the Modal. The Modal's native
  // dismissal is queued to the main thread by that commit, ahead of anything
  // the callback asks the OS to present, so by the time it presents, the
  // app's own controller is topmost again.
  const wasMounted = useRef(mounted)

  useEffect(() => {
    if (wasMounted.current && !mounted) onHidden?.()

    wasMounted.current = mounted
  }, [mounted, onHidden])

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed on movement, not on touch: a tap belongs to whatever is
        // under it, and only a deliberate downward drag is the sheet's.
        onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          // Down only. Dragging up would lift the card off its own bottom edge.
          drag.setValue(Math.max(0, gesture.dy))
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onDismiss()

            return
          }

          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
        }
      }),
    [drag, onDismiss]
  )

  if (!mounted) return null

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] })

  return (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View style={[styles.scrim, { backgroundColor: theme.color.scrim, opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          theme.shadow.sheet,
          {
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            // Both transforms compose: the entrance slide, and whatever the
            // finger has added to it since.
            transform: [{ translateY: Animated.add(slide, drag) }],
            // The home indicator's room, or the keyboard's — never both, since
            // the indicator is underneath the keyboard when one is up.
            paddingBottom: keyboard > 0 ? keyboard + 12 : insets.bottom + 12,
            maxHeight: height * 0.8
          }
        ]}
      >
        {/* The whole header is the drag handle, not just the grabber: a 4px
            bar is a hard thing to catch, and there is nothing else up here
            that a downward drag could mean. */}
        <View {...pan.panHandlers} style={styles.header}>
          <View style={[styles.grabber, { backgroundColor: theme.color.border }]} />
          <Text variant="sheetTitle">{title}</Text>
        </View>

        {children}
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  header: { alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 16 },
  grabber: { width: 36, height: 4, borderRadius: 2 }
})
