// Must come first: the vendored gateway client needs a real `URL` and a
// `DOMException`, neither of which React Native ships (see the file's comment).
import '@/platform/polyfills'

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { Outfit_500Medium } from '@expo-google-fonts/outfit'
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
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
  const agent = useSelectedAgent()

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
        <ThemeProvider accent={agent.accent}>
          <ConnectionProvider agent={agent}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: NEUTRAL.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="agents/new" options={{ presentation: 'modal' }} />
            </Stack>
          </ConnectionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
