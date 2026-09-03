import { Redirect, router } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { useBackend, useConnectionState } from '@/state/ConnectionProvider'
import { useSelectedAgent, useSelectedAgentOrNull } from '@/state/agents'
import { useChatInbox } from '@/state/chat-inbox'
import { useCreateSession } from '@/state/queries'
import { useSidebar } from '@/state/sidebar'
import { Composer } from '@/ui/components/Composer'
import { AgentGlyph } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { KeyboardInset } from '@/ui/keyboard'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * New session — the app's home.
 *
 * The session is created by the **first message**, not by arriving here. Opening
 * the app is not intent to start anything, and a session created on launch is a
 * session you then have to clean up on the host.
 *
 * Once created, the message is handed to chat rather than sent from here (see
 * `chat-inbox`): chat owns the one send path, so the first message gets the same
 * optimistic bubble and offline outbox as every message after it.
 */
export default function NewSessionScreen() {
  const theme = useTheme()
  // Home is the gate: with no agents there is nothing to message, and every
  // other screen assumes one exists. Hooks all run first — an early return
  // above them would change the hook order between renders.
  const maybeAgent = useSelectedAgentOrNull()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const state = useConnectionState()
  const openSidebar = useSidebar(store => store.show)
  const submitMessage = useChatInbox(inbox => inbox.submit)

  const createSession = useCreateSession(maybeAgent?.id ?? '', backend)

  if (!maybeAgent) return <Redirect href="/welcome" />

  const start = (text: string) => {
    if (createSession.isPending) return

    createSession.mutate(undefined, {
      onSuccess: id => {
        // Addressed to the session just created, so no other chat screen can
        // take it — the message is handed over before its screen exists, and
        // an unaddressed one went to whichever chat was already mounted and
        // loaded (see `chat-inbox`).
        submitMessage(id, text)

        // Pushed, not replaced. Home is the stack's root and the drawer
        // returns to it with `navigate` (§7.17), which can only *return* to a
        // screen that is still on the stack: replacing home took it off, so
        // "New session" pushed a second copy of home on top of the session it
        // had just started, leaving that chat mounted underneath.
        router.push(`/chat/${id}`)
      }
    })
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="New session" onMenu={openSidebar} />

      <KeyboardInset style={styles.flex}>
        <View style={styles.body}>
          <View style={styles.empty}>
            <View style={[styles.ring, { borderColor: theme.color.secondaryMuted }]}>
              <AgentGlyph name={agent.icon} size={34} color={theme.color.info700} />
            </View>
            <Text variant="sheetTitle">{`Message ${agent.displayName}`}</Text>
            <Text variant="secondary" style={styles.emptyBody}>
              The session starts when you send. It then appears in the sidebar and on Sessions.
            </Text>

            {createSession.error ? (
              <Text variant="secondary" color={theme.color.error700} style={styles.emptyBody}>
                {String((createSession.error as Error).message)}
              </Text>
            ) : null}
          </View>
        </View>

        <Composer
          streaming={false}
          offline={state !== 'open'}
          queued={0}
          onSend={start}
          onStop={() => undefined}
          // No mic: dictation records into a session, and there isn't one yet.
        />
      </KeyboardInset>

    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 40 },
  ring: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  emptyBody: { textAlign: 'center', maxWidth: 280 }
})
