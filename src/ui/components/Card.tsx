import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'

import { useTheme } from '../ThemeProvider'

/** A 12px content card: white, hairline border, diffuse shadow with no y-offset. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.card,
        theme.shadow.card,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border, borderRadius: theme.radius.card },
        style
      ]}
    >
      {children}
    </View>
  )
}

/** The `#eef1f5` hairline between rows inside a card. */
export function Divider() {
  const theme = useTheme()

  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider }} />
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }
})
