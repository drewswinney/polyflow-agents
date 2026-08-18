import FontAwesome6 from '@expo/vector-icons/FontAwesome6'
import { Tabs } from 'expo-router'

import { useTheme } from '@/ui/ThemeProvider'

/** Three tabs — Sessions · Activity · Settings. Everything else is a sub-screen. */
export default function TabsLayout() {
  const theme = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.secondary,
        tabBarInactiveTintColor: theme.color.gray400,
        tabBarStyle: { backgroundColor: theme.color.surface, borderTopColor: theme.color.border },
        tabBarLabelStyle: { fontFamily: theme.font.bodyMedium, fontSize: 10.5 },
        tabBarItemStyle: { minHeight: 48 }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <FontAwesome6 name="comments" size={18} color={color} solid />
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <FontAwesome6 name="wave-square" size={18} color={color} solid />
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <FontAwesome6 name="sliders" size={18} color={color} solid />
        }}
      />
    </Tabs>
  )
}
