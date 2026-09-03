import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useThemePrefs } from '@/state/theme-prefs'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string; description: string }[] = [
  { value: 'system', label: 'System', icon: 'monitor', description: 'Follow device settings' },
  { value: 'light', label: 'Light', icon: 'sun', description: 'Always use light theme' },
  { value: 'dark', label: 'Dark', icon: 'moon', description: 'Always use dark theme' }
]

export default function ThemeSettingsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const mode = useThemePrefs(state => state.mode)
  const setMode = useThemePrefs(state => state.set)
  const [pressed, setPressed] = useState<string | null>(null)

  const handlePress = (value: ThemeMode) => {
    setMode('mode', value)
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Theme" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card>
          {THEME_OPTIONS.map((option, index) => (
            <View key={option.value}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => handlePress(option.value)}
                onPressIn={() => setPressed(option.value)}
                onPressOut={() => setPressed(null)}
                style={[
                  styles.row,
                  pressed === option.value && { backgroundColor: theme.color.bgSubtle }
                ]}
              >
                <View
                  style={[
                    styles.tile,
                    { backgroundColor: mode === option.value ? theme.color.primaryTint : theme.color.bgSubtle }
                  ]}
                >
                  <Icon
                    name={option.icon}
                    size={14}
                    color={mode === option.value ? theme.color.primary : theme.color.gray500}
                  />
                </View>
                <View style={styles.textContainer}>
                  <Text variant="rowLabel" style={styles.label}>
                    {option.label}
                  </Text>
                  <Text variant="secondary" color={theme.color.gray400}>
                    {option.description}
                  </Text>
                </View>
                {mode === option.value ? (
                  <View style={[styles.indicator, { backgroundColor: theme.color.primary }]} />
                ) : (
                  <Icon name="chevron-right" size={11} color={theme.color.gray400} />
                )}
              </Pressable>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14 },
  row: { height: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  tile: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  textContainer: { flex: 1, minWidth: 0, gap: 2 },
  label: { flexShrink: 1 },
  indicator: { width: 8, height: 8, borderRadius: 4 }
})
