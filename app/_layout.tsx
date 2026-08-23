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
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider, useBackend } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgentOrNull, useSelectedServerOrNull } from '@/state/agents'
import { useNotificationRouting } from '@/state/notification-routing'
import { useNotificationTap } from '@/state/notification-tap'
import { useSessions } from '@/state/queries'
import { useSidebar } from '@/state/sidebar'
import { Sidebar } from '@/ui/components/Sidebar'
import { ThemeProvider } from '@/ui/ThemeProvider'
import { NEUTRAL } from '@/ui/theme'

void SplashScreen.preventAutoHideAsync()

// How long the fonts get before the app opens without them.
//
// `useFonts` never resolves its `loaded` flag on failure — it only sets the
// error — so waiting on `loaded` alone is a wait that can never end. Under
// Metro the fonts always arrived and that was invisible; served from an EAS
// Update's asset manifest, one that does not arrive held the splash screen
// open forever. The app degrades to system fonts; it does not refuse to open.
const FONT_TIMEOUT_MS = 4_000

// The ceiling on the whole gate, whatever is still outstanding.
//
// The font timeout only ever bounded the fonts. `hydrated` was left unbounded
// on the reasoning that it always resolves — which is true of a read that
// *fails*, and not true of one that never comes back. `hydrate()` awaits
// AsyncStorage, so a native read that hangs instead of rejecting never reaches
// its own catch, never sets `hydrated`, and holds the splash screen for good.
//
// No single dependency gets to be the exception. Past this deadline the app
// renders with whatever it has: an empty agent registry reads as a fresh
// install and lands on onboarding, which is recoverable and on screen. A
// splash screen is neither.
const STARTUP_DEADLINE_MS = 8_000

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
  const [fontsLoaded, fontError] = useFonts({
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
  const server = useSelectedServerOrNull()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const [fontsTimedOut, setFontsTimedOut] = useState(false)
  const [deadlinePassed, setDeadlinePassed] = useState(false)

  useEffect(() => {
    const fonts = setTimeout(() => setFontsTimedOut(true), FONT_TIMEOUT_MS)
    const deadline = setTimeout(() => setDeadlinePassed(true), STARTUP_DEADLINE_MS)

    return () => {
      clearTimeout(fonts)
      clearTimeout(deadline)
    }
  }, [])

  // Settled, not loaded: a font that failed and a font that is still missing
  // after the timeout both count as answered.
  const fontsSettled = fontsLoaded || fontError !== null || fontsTimedOut
  // The deadline is an override, not another term: it opens the gate even when
  // something upstream never answered at all.
  const ready = (fontsSettled && hydrated) || deadlinePassed

  /**
   * Keep asking for a frame until the app is ready to be seen.
   *
   * Everything this gate waits on lands off a promise or a timer, and all of
   * them resolve while the app is idle behind a static splash screen. Nothing
   * is animating, so nothing is producing frames, and a React update with no
   * frame to commit into flips `ready` in state without ever reaching the
   * screen. The app then sits on the splash until something produces a frame —
   * which is why tapping the screen loaded it, and why it occasionally came up
   * on its own. Whether anything happened to request a frame was a race, and
   * mostly it lost.
   *
   * `requestAnimationFrame` does not wait for a frame; it *asks* for one. This
   * pumps it until the gate opens, which makes the commit land on the first
   * frame after it rather than the first touch. It cancels itself the moment
   * `ready` is true, so it costs a handful of frames at launch and nothing
   * after — and `STARTUP_DEADLINE_MS` guarantees `ready` arrives.
   */
  useEffect(() => {
    if (ready) return

    let frame = requestAnimationFrame(function pump() {
      frame = requestAnimationFrame(pump)
    })

    return () => cancelAnimationFrame(frame)
  }, [ready])

  // Tied to a real layout pass rather than fired from the effect alone: the
  // native splash is torn down on the UI thread, so handing it a commit that
  // has actually been laid out is what makes it go away. Best-effort — it
  // rejects when already hidden, and an unhandled rejection on the launch path
  // is a crash on the way in.
  const hideSplash = useCallback(() => {
    if (!ready) return

    void SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  useEffect(() => {
    hideSplash()
  }, [hideSplash])

  useEffect(() => {
    if (fontError) console.warn('[fonts] failed to load, falling back to system fonts:', fontError)
  }, [fontError])

  // Says which dependency was still outstanding when the deadline fired, so the
  // next report of a slow start names a cause instead of a symptom.
  useEffect(() => {
    if (!deadlinePassed || (fontsSettled && hydrated)) return

    console.warn(
      `[startup] opened on the ${STARTUP_DEADLINE_MS}ms deadline — fonts settled: ${fontsSettled}, registry hydrated: ${hydrated}`
    )
  }, [deadlinePassed, fontsSettled, hydrated])

  if (!ready) return <View style={{ flex: 1, backgroundColor: NEUTRAL.bg }} />

  return (
    <SafeAreaProvider onLayout={hideSplash}>
      <QueryClientProvider client={queryClient}>
        {/* Accent follows the selected agent, so a glance says which one you are in. */}
        <ThemeProvider accent={agent?.accent}>
          <ConnectionProvider server={server} agent={agent}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: NEUTRAL.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="welcome" />
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
              <Stack.Screen name="servers/new" options={{ presentation: 'modal' }} />
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
  const backend = useBackend()
  const open = useSidebar(state => state.open)
  const hide = useSidebar(state => state.hide)
  const pathname = usePathname()

  const sessions = useSessions(agent?.scope ?? '', backend)

  return (
    <Sidebar
      visible={open}
      sessions={sessions.data ?? []}
      loading={sessions.isLoading}
      activePath={pathname}
      paired={Boolean(agent)}
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
  const agent = useSelectedAgentOrNull()
  const backend = useBackend()
  
  // Route notification taps to the right session
  useNotificationRouting()
  
  // Listen for agent events and show local notifications when app is backgrounded
  useNotificationTap(backend, agent)

  return null
}
