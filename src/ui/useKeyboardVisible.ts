import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Whether the software keyboard is on screen.
 *
 * Used to drop bottom safe-area padding while it is: the home indicator sits
 * *under* the keyboard, so reserving space for it there leaves a visible gap
 * between the keyboard and whatever is above it.
 *
 * iOS gets the `Will` events so the padding changes with the keyboard's
 * animation rather than a frame after it; Android only fires the `Did` pair.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const show = Keyboard.addListener(showEvent, () => setVisible(true))
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false))

    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return visible
}
