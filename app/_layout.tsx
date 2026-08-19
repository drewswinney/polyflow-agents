// Must come first: the vendored gateway client needs a real `URL` and a
// `DOMException`, neither of which React Native ships (see the file's comment).
import '@/platform/polyfills'

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { Outfit_500Medium } from '@expo-google-fonts/outfit'
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { router, Stack, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider, useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgentOrNull } from '@/state/agents'
import { useNotificationRouting } from '@/state/notification-routing'
import { useSessions } from '@/state/queries'
import { useSidebar } from '@/state/sidebar'
import { Sidebar } from '@/ui/components/Sidebar'
import { ThemeProvider } from '@/ui/ThemeProvider'
import { NEUTRAL } from '@/ui/theme'

void SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The host is a phone hop away over a tailnet; a stale-while-revalidate
      // window this short keeps lists fresh without hammering the socket's host.
      staleTime: 15_000,
      retry: 1
    }
  }
})

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Outfit_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceMono_400Regular,
    SpaceMono_700Bold
  })

  const hydrate = useAgents(state => state.hydrate)
  const hydrated = useAgents(state => state.hydrated)
  // Nullable here and only here: with no fixture agent, a fresh install has an
  // empty registry until onboarding runs.
  const agent = useSelectedAgentOrNull()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (fontsLoaded && hydrated) void SplashScreen.hideAsync()
  }, [fontsLoaded, hydrated])

  if (!fontsLoaded || !hydrated) return <View style={{ flex: 1, backgroundColor: NEUTRAL.bg }} />

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* Accent follows the selected agent, so a glance says which one you are in. */}
        <ThemeProvider accent={agent?.accent}>
          <ConnectionProvider agent={agent}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: NEUTRAL.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="sessions" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="logs" />
              <Stack.Screen name="tools" />
              <Stack.Screen name="model" />
              <Stack.Screen name="cron" />
              <Stack.Screen name="config" />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="voice/[id]" />
              <Stack.Screen name="agents/new" options={{ presentation: 'modal' }} />
            </Stack>

            {/* Mounted beside the router, not inside a screen, so the same
                sidebar serves every screen that shows the hamburger. */}
            <AppSidebar />
            <NotificationRouting />
          </ConnectionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

/**
 * The sidebar's wiring. Screens own their own state; this one is app-wide, so
 * its container sits here with the providers it reads from.
 */
function AppSidebar() {
  const agent = useSelectedAgentOrNull()
  const { backend } = useActiveConnection()
  const open = useSidebar(state => state.open)
  const hide = useSidebar(state => state.hide)
  const pathname = usePathname()

  const sessions = useSessions(agent?.id ?? '', backend)

  return (
    <Sidebar
      visible={open}
      sessions={sessions.data ?? []}
      loading={sessions.isLoading}
      activePath={pathname}
      onOpenSession={id => router.push(`/chat/${id}`)}
      // `navigate` returns to a top-level destination already on the stack
      // instead of stacking a second copy of it behind the drawer.
      onNavigate={path => router.navigate(path)}
      onDismiss={hide}
    />
  )
}

/**
 * Notification taps, mounted for the life of the app.
 *
 * A component rather than a call in `RootLayout` so it sits inside the agent
 * providers: routing a tap can re-scope the app, and doing that above the
 * provider would change the agent under a tree that is not listening.
 */
function NotificationRouting() {
  useNotificationRouting()

  return null
}
