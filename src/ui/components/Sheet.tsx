import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Keyboard, Modal, PanResponder, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
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
  titleLines = 1,
  onRename,
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
  /**
   * How many lines the title may take before it is cut. One for a picker,
   * whose title is a label; more for a sheet about a thing with a name of
   * its own — a ticket, say — where reading the whole name is the point.
   */
  titleLines?: number
  /**
   * Makes the title editable: a long press on it opens a field in its place,
   * and tapping anywhere else — or return — puts the text back and reports
   * the new name here if it changed. Absent, the title is just a heading.
   */
  onRename?: (title: string) => void
  children: ReactNode
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  const [mounted, setMounted] = useState(visible)
  const [expanded, setExpanded] = useState(false)
  // The title being edited in place, and where the header ends — the tap-off
  // surface starts there, so it never covers the field itself.
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [headerHeight, setHeaderHeight] = useState(0)

  const startRename = () => {
    setDraft(title)
    setRenaming(true)
  }

  // Leaves the field however it is left — blur, return, a tap elsewhere — and
  // only speaks up for an actual change; an empty name is not one.
  const commitRename = () => {
    setRenaming(false)

    const next = draft.trim()

    if (next && next !== title) onRename?.(next)
  }

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
  // The live drag towards dismissal, in pixels down from resting. Only ever
  // positive: the other direction is not a drag of the panel but a change of
  // its height (below), so the bottom edge never leaves the bottom of the
  // screen.
  const drag = useRef(new Animated.Value(0)).current
  // The panel's own height. An expandable panel is flipped between rest and
  // the full screen by this alone — the finger sets it live, the release
  // finishes the motion — so there is one value in motion, not a translate
  // and a height settling on different curves.
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

    // Eased out, not in-and-out: it usually picks up from wherever a finger
    // let go, and an ease-in from there reads as a hitch.
    const animation = Animated.timing(panelHeight, {
      toValue: expanded ? height : restFraction * height,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
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

  // What the gesture handlers read, kept current on every render. The
  // responder itself is created once: `PanResponder.create` keeps the
  // gesture's origin inside the object it returns, so a responder recreated
  // mid-drag — because a parent re-rendered and handed down a new `onDismiss`
  // — never saw the touch start, reads every move as a distance from zero,
  // and releases into a dismissal or a half-flip. That is exactly what a
  // list ticking its relative times behind an open sheet was doing.
  const latest = useRef({ expandable, expanded, height, restFraction, onDismiss })

  latest.current = { expandable, expanded, height, restFraction, onDismiss }

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed on touch, not on movement. RN's Modal answers yes to every
        // touch start on its container so nothing bubbles out of it, and once
        // an ancestor holds the responder the move-phase negotiation never
        // reaches its descendants — a header that only asked on move would
        // never be asked at all. Claiming at start costs nothing: the close
        // button is a child, so it still takes its own taps first, and a tap
        // on the grabber or title releases with no movement and does nothing.
        onStartShouldSetPanResponder: () => true,
        // Asked on move as well, for the one case start does not cover: a
        // touch that began on a pressable child of the header — the title,
        // when it can be renamed — which claimed it first. Once that child
        // holds the responder the header is its ancestor, so it *is* asked on
        // move, and a vertical drag takes over from a long press in progress.
        onMoveShouldSetPanResponder: (_event, gesture) => {
          // Upward drags are only the sheet's business when it can go up.
          if (!latest.current.expandable && gesture.dy <= 0) return false

          return Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        },
        onPanResponderMove: (_event, gesture) => {
          const { expandable, expanded, height, restFraction } = latest.current
          const rest = restFraction * height

          // From the full screen, a down-drag shrinks the panel towards rest.
          // It stays anchored to the bottom, so nothing shows beneath it.
          if (expandable && expanded) {
            panelHeight.setValue(Math.max(rest, height - Math.max(0, gesture.dy)))

            return
          }

          // From rest, an up-drag grows it towards the full screen — again a
          // height, not a lift, which is what kept the floor visible before.
          if (expandable && gesture.dy < 0) {
            drag.setValue(0)
            panelHeight.setValue(Math.min(height, rest - gesture.dy))

            return
          }

          // Down from rest: the whole panel follows the finger, towards
          // dismissal. A resting sheet that is not expandable only ever does
          // this — dragging it up would lift the card off its own edge.
          if (expandable) panelHeight.setValue(rest)

          drag.setValue(Math.max(0, gesture.dy))
        },
        onPanResponderRelease: (_event, gesture) => {
          const { expandable, expanded, height, restFraction, onDismiss } = latest.current
          const rest = restFraction * height
          // Finishes a flip the finger did not commit to: back to the extent
          // it started from, on the same curve the flip effect uses.
          const settle = (to: number) =>
            Animated.timing(panelHeight, { toValue: to, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()

          if (expandable && expanded) {
            // From the full screen a down-drag folds the panel back to rest;
            // the close button is the only thing that closes it, since the
            // content below is scrolling and the sheet's own dismissal
            // gesture would fight the page's.
            if (gesture.dy > FLIP_DISTANCE || (gesture.dy > 24 && gesture.vy > FLIP_VELOCITY)) setExpanded(false)
            else settle(height)

            return
          }

          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onDismiss()

            return
          }

          if (expandable && gesture.dy < 0) {
            if (gesture.dy < -FLIP_DISTANCE || (gesture.dy < -24 && gesture.vy < -FLIP_VELOCITY)) setExpanded(true)
            else settle(rest)

            return
          }

          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
        }
      }),
    [drag, panelHeight]
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

      {/* Two views, not one, because they are driven from different sides:
          the outer carries the natively driven slide and drag (transforms
          only), the inner carries the JS-driven height. Once a native value
          is attached to a view, every animated style on that view has to be
          native, and height is not one the native driver supports. */}
      <Animated.View
        style={[
          styles.mover,
          {
            // The entrance slide and the finger's live drag, composed.
            transform: [{ translateY: Animated.add(slide, drag) }]
          }
        ]}
      >
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
          <View
            {...pan.panHandlers}
            onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
            style={[styles.header, expandable && expanded && { paddingTop: insets.top + 8 }]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.color.border }]} />
            {/* The grabber stays centred above the title, as on every sheet;
                the close button sits at the edge of the same row rather than
                pushing the pair off centre. */}
            <View style={styles.titleRow}>
              {renaming ? (
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onBlur={commitRename}
                  onSubmitEditing={commitRename}
                  returnKeyType="done"
                  blurOnSubmit
                  autoFocus
                  selectTextOnFocus
                  multiline={titleLines > 1}
                  accessibilityLabel="Rename"
                  style={[
                    styles.title,
                    styles.titleInput,
                    expandable && styles.titleBesideClose,
                    { fontFamily: theme.font.display, color: theme.color.gray900, borderColor: theme.color.primary }
                  ]}
                />
              ) : onRename ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${title}. Long press to rename`}
                  accessibilityHint="Long press to rename"
                  onLongPress={startRename}
                  delayLongPress={400}
                  style={styles.titlePress}
                >
                  <Text variant="sheetTitle" numberOfLines={titleLines} style={[styles.title, expandable && styles.titleBesideClose]}>
                    {title}
                  </Text>
                </Pressable>
              ) : (
                <Text variant="sheetTitle" numberOfLines={titleLines} style={[styles.title, expandable && styles.titleBesideClose]}>
                  {title}
                </Text>
              )}
              {expandable ? (
                <View style={styles.close}>
                  <IconButton name="xmark" accessibilityLabel={`Close ${title}`} outlined onPress={close} />
                </View>
              ) : null}
            </View>
          </View>

          {children}

          {/* Tapping off the title field ends the rename: the field's own blur
              does the committing, so this only has to take the tap — and the
              focus — away from it. Starts under the header so the field, the
              grabber and the close button stay reachable. */}
          {renaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish renaming"
              onPress={() => Keyboard.dismiss()}
              style={[styles.renameCatch, { top: headerHeight }]}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
  mover: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  header: { alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 16 },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  titleRow: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  title: { textAlign: 'center', maxWidth: '100%' },
  titlePress: { alignSelf: 'stretch', alignItems: 'center' },
  // The heading's own type, with a rule under it to say it is now a field.
  titleInput: { alignSelf: 'stretch', fontSize: 18, lineHeight: 22, paddingVertical: 4, paddingHorizontal: 0, borderBottomWidth: 1.5 },
  renameCatch: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /* Room for the close button on both sides, so the title stays centred. */
  titleBesideClose: { paddingHorizontal: 52 },
  close: { position: 'absolute', right: 0 }
})
