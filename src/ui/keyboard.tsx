import type { ReactNode } from 'react'
import { Platform, type ViewStyle } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useKeyboardVisible } from './useKeyboardVisible'

/**
 * Holding the composer on top of the keyboard.
 *
 * `KeyboardAvoidingView` only ever hears `keyboardWillShow`/`WillHide`, so it
 * plays a fixed animation *towards* where the keyboard is going. That is fine
 * for tapping in and out of the field, and wrong for an interactive dismissal:
 * while your finger drags the keyboard down, no notification fires, and the
 * composer hangs above it until you let go.
 *
 * Reanimated watches the keyboard view itself — a display link during the
 * system animation, key-value observation on its centre during a drag — and
 * publishes the height as a shared value, so the composer is laid out from the
 * keyboard's real position on the UI thread rather than a JS-side guess.
 *
 * Android has no interactive dismissal and resizes the window itself, so it
 * keeps the cheaper path: nothing to track, and the same two positions.
 */
const tracksKeyboard = Platform.OS === 'ios'

/** The safe-area padding a bar pinned to the bottom keeps for the home indicator. */
function useSafeBottom(): number {
  const insets = useSafeAreaInsets()

  return Math.max(insets.bottom, 12)
}

/**
 * Lifts its children clear of the keyboard. Wraps the transcript *and* the
 * composer, so the list shrinks by exactly what the keyboard covers.
 */
export function KeyboardInset({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  return tracksKeyboard ? (
    <TrackingInset style={style}>{children}</TrackingInset>
  ) : (
    <Animated.View style={style}>{children}</Animated.View>
  )
}

function TrackingInset({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  const keyboard = useAnimatedKeyboard()
  const inset = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }))

  return <Animated.View style={[style, inset]}>{children}</Animated.View>
}

/**
 * Bottom padding for a bar sitting inside a {@link KeyboardInset}: the home
 * indicator's space while the keyboard is away, and none of it once the
 * keyboard covers that space — the indicator is *under* the keyboard, so
 * holding room for it there just floats the bar.
 *
 * `extra` is the bar's own padding, which it keeps either way.
 */
export const useBottomBarPadding = tracksKeyboard ? useTrackingBottomBarPadding : useStaticBottomBarPadding

function useTrackingBottomBarPadding(extra: number) {
  const keyboard = useAnimatedKeyboard()
  const safeBottom = useSafeBottom()

  // Handed over gradually rather than at a threshold: mid-drag the keyboard
  // covers part of the indicator, and the bar makes up the rest, so the two
  // together stay the same height while the keyboard is on its way out.
  return useAnimatedStyle(() => ({ paddingBottom: extra + Math.max(safeBottom - keyboard.height.value, 0) }))
}

function useStaticBottomBarPadding(extra: number) {
  const safeBottom = useSafeBottom()
  const keyboardVisible = useKeyboardVisible()

  return { paddingBottom: keyboardVisible ? extra : extra + safeBottom }
}
