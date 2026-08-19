import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

import { useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { useChatInbox } from '@/state/chat-inbox'
import { useCreateSession } from '@/state/queries'
import { useSidebar } from '@/state/sidebar'
import { AgentPill } from '@/ui/components/AgentPill'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { Composer } from '@/ui/components/Composer'
import { ConnectionBanner } from '@/ui/components/ConnectionBanner'
import { AgentGlyph } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
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
  const agent = useSelectedAgent()
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const { backend, state, attempt, error } = useActiveConnection()
  const openSidebar = useSidebar(store => store.show)
  const submitMessage = useChatInbox(inbox => inbox.submit)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const createSession = useCreateSession(agent.id, backend)

  const start = (text: string) => {
    if (createSession.isPending) return

    createSession.mutate(undefined, {
      onSuccess: id => {
        submitMessage(text)
        // Replaced, not pushed: going back from the session you just started
        // should leave you here, not at a second copy of this screen.
        router.replace(`/chat/${id}`)
      }
    })
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="New session"
        onMenu={openSidebar}
        center={<AgentPill agent={agent} open={switcherOpen} onPress={() => setSwitcherOpen(true)} />}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.body}>
          <ConnectionBanner state={state} attempt={attempt} error={error} />

          <View style={styles.empty}>
            <View style={[styles.ring, { borderColor: theme.color.secondaryMuted }]}>
              <AgentGlyph name={agent.icon} size={34} color="#a78bfa" />
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
      </KeyboardAvoidingView>

      <AgentSwitcher
        agents={agents}
        selectedId={agent.id}
        visible={switcherOpen}
        onSelect={select}
        onAddAgent={() => router.push('/agents/new')}
        onDismiss={() => setSwitcherOpen(false)}
      />
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
