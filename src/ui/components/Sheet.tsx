import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Keyboard, Modal, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { IconButton } from './IconButton'
import { Text } from './Text'

/** How long the panel takes to arrive, and to leave. Matches the sidebar. */
const SLIDE_MS = 200
/** Drag far enough, or flick hard enough, and the release dismisses. */
const DISMISS_DISTANCE = 90
const DISMISS_VELOCITY = 0.6
/** Drag (or flick) this far in the other direction to flip a sheet between its resting height and the full screen. */
const FLIP_DISTANCE = 100
const FLIP_VELOCITY = 1.2

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
 * `restFraction` is how much of the screen the sheet may occupy at rest —
 * pickers are the tall default, a preview can rest at half. Without
 * `expandable` nothing else changes: the panel is as tall as its children
 * allow, up to the fraction, and a down-drag dismisses it.
 *
 * `expandable` adds the other direction: from rest the header still drags the
 * sheet down to dismiss, and it also drags *up*, flipping the panel to the
 * full screen; from the full screen a down-drag folds it back to rest and
 * the close button in the header is the way out. The same surface previews
 * and then takes over, which is what a page that is interesting at half the
 * screen and better at all of it asks for.
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
  restFraction = 0.8,
  expandable = false,
  onClose,
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
  /** The panel's resting height, as a fraction of the screen (0–1). */
  restFraction?: number
  /** The header also drags the sheet up to the full screen, and back down to rest. */
  expandable?: boolean
  /**
   * The close button's handler, drawn in the header when `expandable`: the
   * way out once the panel is the whole screen, where a down-drag on content
   * is the page's own scroll. Defaults to `onDismiss`.
   */
  onClose?: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  const [mounted, setMounted] = useState(visible)
  const [expanded, setExpanded] = useState(false)

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
  // The live drag, in pixels from resting: down is positive, up is negative
  // (that is the only direction an `expandable` sheet claims it).
  const drag = useRef(new Animated.Value(0)).current
  // The panel's own height, so an expandable panel animates between rest and
  // the full screen rather than jumping.
  const panelHeight = useRef(new Animated.Value(restFraction * height)).current

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setExpanded(false)
      drag.setValue(0)
      // The snap happens while the panel is off screen, so the next arrival
      // is always from rest.
      panelHeight.setValue(restFraction * height)
    }

    const animation = Animated.timing(progress, { toValue: visible ? 1 : 0, duration: SLIDE_MS, useNativeDriver: true })

    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })

    return () => animation.stop()
    // `height` is read through `panelHeight`'s reset above, and a rotation
    // mid-flight is not a case the original sheet handled either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress, drag, panelHeight])

  // The flip itself: the panel's height between rest and the full screen.
  // Driven without the native driver because height is not one of the
  // transform/opacity properties it may animate.
  useEffect(() => {
    if (!expandable || !visible) return

    const animation = Animated.timing(panelHeight, {
      toValue: expanded ? height : restFraction * height,
      duration: SLIDE_MS,
      useNativeDriver: false
    })

    animation.start()

    return () => animation.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, visible, expandable, panelHeight])

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
        // under it, and only a deliberate vertical drag is the sheet's.
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          // A resting sheet only goes down — dragging up would lift the card
          // off its own bottom edge. An expandable one takes both directions
          // at rest (up is rubber-banded; the panel is already as high as it
          // goes), and only down once it is the full screen.
          const value = expandable
            ? expanded
              ? Math.max(0, gesture.dy)
              : gesture.dy > 0
                ? gesture.dy
                : -Math.min(-gesture.dy, height * 0.25)
            : Math.max(0, gesture.dy)

          drag.setValue(value)
        },
        onPanResponderRelease: (_event, gesture) => {
          if (expandable && expanded) {
            // From the full screen a down-drag folds the panel back to rest;
            // the close button is the only thing that closes it, since the
            // content below is scrolling and the sheet's own dismissal
            // gesture would fight the page's.
            if (gesture.dy > FLIP_DISTANCE || (gesture.dy > 24 && gesture.vy > FLIP_VELOCITY)) setExpanded(false)

            Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()

            return
          }

          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onDismiss()

            return
          }

          if (expandable && (gesture.dy < -FLIP_DISTANCE || (gesture.dy < -24 && gesture.vy < -FLIP_VELOCITY))) setExpanded(true)

          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
        }
      }),
    [drag, onDismiss, expandable, expanded, height]
  )

  if (!mounted) return null

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] })
  const close = onClose ?? onDismiss

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
            // The content decides the height at rest, up to the fraction; an
            // expandable sheet carries its own animated height between rest
            // and the full screen.
            ...(expandable ? { height: panelHeight } : { maxHeight: restFraction * height }),
            borderTopLeftRadius: expandable && expanded ? 0 : 24,
            borderTopRightRadius: expandable && expanded ? 0 : 24,
            borderTopWidth: expandable && expanded ? 0 : StyleSheet.hairlineWidth,
            // The entrance slide and the finger's live drag, composed.
            transform: [{ translateY: Animated.add(slide, drag) }],
            // The home indicator's room, or the keyboard's — never both, since
            // the indicator is underneath the keyboard when one is up.
            paddingBottom: keyboard > 0 ? keyboard + 12 : insets.bottom + 12,
            overflow: 'hidden'
          }
        ]}
      >
        {/* The whole header is the drag handle, not just the grabber: a 4px
            bar is a hard thing to catch, and there is nothing else up here
            that a vertical drag could mean. */}
        <View {...pan.panHandlers} style={[styles.header, expandable && expanded && { paddingTop: insets.top + 8 }]}>
          <View style={[styles.grabber, { backgroundColor: theme.color.border }]} />
          <Text variant="sheetTitle" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {expandable ? <IconButton name="xmark" accessibilityLabel={`Close ${title}`} outlined onPress={close} /> : null}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 16 },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  title: { flex: 1, minWidth: 0 }
})
