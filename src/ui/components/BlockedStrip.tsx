import { StyleSheet, View } from 'react-native'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The "waiting on your answer" strip on a blocked session card.
 *
 * The design pairs this with a countdown, and one is now shown — but on the
 * approval card itself (§7.6), which is the only place that knows when the
 * request arrived. A session summary carries no expiry, so a timer here would
 * have to be guessed from a list row. The strip says *that* it is waiting; the
 * card says how long you have.
 */
export function BlockedStrip() {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.strip,
        {
          backgroundColor: theme.color.warning50,
          borderColor: theme.color.warning200,
          borderRadius: theme.radius.control
        }
      ]}
    >
      <Icon name="hand" size={13} color={theme.color.warning700} />
      <Text variant="secondary" color={theme.color.warningText}>
        Waiting on your answer
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    borderWidth: StyleSheet.hairlineWidth
  }
})
