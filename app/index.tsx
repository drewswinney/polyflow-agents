import { LinearGradient } from 'expo-linear-gradient'
import { useQuery } from '@tanstack/react-query'
import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useBackend, useConnectionState } from '@/state/ConnectionProvider'
import { useSelectedAgent, useSelectedAgentOrNull } from '@/state/agents'
import type { PickedImage } from '@/platform/image-attachments'
import { useChatInbox } from '@/state/chat-inbox'
import { useCreateSession } from '@/state/queries'
import { useSheet } from '@/state/sheet'
import { useSidebar } from '@/state/sidebar'
import { Composer } from '@/ui/components/Composer'
import { AgentGlyph } from '@/ui/components/Icon'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { KeyboardInset } from '@/ui/keyboard'
import { useGradient, useTheme } from '@/ui/ThemeProvider'

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
  const headerInset = useHeaderInset()
  const gradient = useGradient()
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
  const openSheet = useSheet(store => store.open)

  /**
   * The model the session will be *born* on.
   *
   * Null until you pick one, and the chip then falls back to whatever the host
   * reports as its default — so it always names the model the next message
   * will actually run on rather than going blank until you choose.
   */
  const [model, setModel] = useState<string | null>(null)

  /**
   * The agent's own default, straight from the host.
   *
   * Asked for rather than inferred from the model list's `selected` flag: this
   * agent reaches its model through a proxy, so the id it runs on
   * (`openrouter/qwen/qwen3.8-27b`) is not one of the rows any provider group
   * offers, and nothing would ever have been ticked to read it off.
   */
  const agentModel = useQuery({
    queryKey: ['agent', maybeAgent?.id ?? '', 'model'] as const,
    enabled: Boolean(backend) && (backend?.capabilities.settings.model ?? false),
    queryFn: () => backend!.getModel()
  })

  const chosen = model ?? agentModel.data ?? null

  if (!maybeAgent) return <Redirect href="/welcome" />

  const start = (text: string, images: PickedImage[] = []) => {
    if (createSession.isPending) return

    createSession.mutate(model ?? undefined, {
      onSuccess: id => {
        // Addressed to the session just created, so no other chat screen can
        // take it — the message is handed over before its screen exists, and
        // an unaddressed one went to whichever chat was already mounted and
        // loaded (see `chat-inbox`).
        submitMessage(id, text, images)

        // Pushed, not replaced. Home is the stack's root and the drawer
        // returns to it with `navigate` (§7.17), which can only *return* to a
        // screen that is still on the stack: replacing home took it off, so
        // "New session" pushed a second copy of home on top of the session it
        // had just started, leaving that chat mounted underneath.
        router.push(`/chat/${id}`)
      }
    })
  }

  /**
   * Talking from home creates the session first.
   *
   * Voice records *into* a session — it transcribes and hands the text to
   * chat's send path through the inbox — so there has to be one before the
   * screen opens. That is the same order home already uses for a typed first
   * message; only the screen it lands on differs.
   */
  const talk = () => {
    if (createSession.isPending) return

    createSession.mutate(model ?? undefined, {
      onSuccess: id => router.push(`/voice/${id}`)
    })
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="New session" onMenu={openSidebar} />

      <KeyboardInset style={styles.flex}>
        <View style={[styles.body, { paddingTop: headerInset }]}>
          <View style={styles.empty}>
            <LinearGradient
              colors={gradient.colors}
              start={gradient.start}
              end={gradient.end}
              style={styles.ring}
            >
              <AgentGlyph name={agent.icon} size={34} color={theme.color.onAccent} />
            </LinearGradient>
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
          canAttach={backend?.capabilities.media.images ?? false}
          {...(backend?.capabilities.media.audioIn ? { onVoice: talk } : {})}
          model={chosen}
          {...(backend?.capabilities.settings.model
            ? {
                onPressModel: () =>
                  openSheet({
                    kind: 'model',
                    // No session to re-point — the pick rides on the one this
                    // screen is about to create.
                    sessionId: null,
                    currentModel: chosen,
                    onPick: setModel
                  })
              }
            : {})}
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
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  emptyBody: { textAlign: 'center', maxWidth: 280 }
})
