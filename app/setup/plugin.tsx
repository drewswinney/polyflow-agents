import * as Clipboard from 'expo-clipboard'
import { useQuery } from '@tanstack/react-query'
import { Redirect, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useBackend, useConnectionState } from '@/state/ConnectionProvider'
import { useSelectedAgentOrNull, useSelectedServerOrNull } from '@/state/agents'
import { artifactsNotInstalled } from '@/state/artifacts'
import { useChatInbox } from '@/state/chat-inbox'
import { useCreateSession } from '@/state/queries'
import { Card } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { SetupButton, SetupFooter, SetupLink } from '@/ui/components/SetupChrome'
import { Text } from '@/ui/components/Text'
import { pluginInstallPrompt } from '@/ui/setup'
import { useTheme } from '@/ui/ThemeProvider'

/** How long "Copied" stays on the button before it reads "Copy prompt" again. */
const COPIED_FOR_MS = 1_800
/** How often the host is asked again whether the plugin is there, while it is not. */
const RECHECK_MS = 8_000
/** How much of the prompt shows before "show the whole prompt". */
const PROMPT_PREVIEW_LINES = 4

/**
 * Setup, page three of three (§7.8): the host plugin.
 *
 * Talking to the agent works from page two. What does not, until the
 * `polyflow_agents_push` plugin is on the host, is everything that comes
 * *from* the host — notifications, the files the agent makes, approvals
 * answered from a phone. Installing it is the agent's job, not the
 * person's: this page holds the prompt that asks it to, to copy or to send
 * straight into a session, and asks the host every few seconds whether the
 * plugin's routes answer yet, so the tick appears on its own once the agent
 * is done.
 *
 * Reached from setup, where "Done" goes home, and from adding a server in
 * Settings, where it goes back to where that started.
 */
export default function PluginScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()
  const agent = useSelectedAgentOrNull()
  const server = useSelectedServerOrNull()
  const backend = useBackend()
  const connection = useConnectionState()
  const submitMessage = useChatInbox(inbox => inbox.submit)
  const createSession = useCreateSession(agent?.id ?? '', backend)

  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Folded by default: the prompt is for the agent, and the person only needs
  // to see enough of it to know what they are sending.
  const [unfolded, setUnfolded] = useState(false)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)

    return () => clearTimeout(timer)
  }, [copied])

  /**
   * Whether the plugin answers. The artifact list is the probe: it is the
   * plugin's own route, a 404 from a host that is otherwise fine is exactly
   * "not installed", and it costs one small request.
   */
  const check = useQuery({
    queryKey: ['agent', agent?.id ?? '', 'plugin-check'] as const,
    enabled: Boolean(backend) && connection === 'open',
    queryFn: async () => {
      try {
        await backend!.listArtifacts({ limit: 1 })

        return 'installed' as const
      } catch (cause) {
        if (artifactsNotInstalled(cause)) return 'missing' as const

        throw cause
      }
    },
    retry: false,
    refetchInterval: result => (result.state.data === 'installed' ? false : RECHECK_MS)
  })

  // Nothing to set up a plugin for. The connect page is where an agent comes from.
  if (!agent) return <Redirect href="/setup/welcome" />

  const prompt = pluginInstallPrompt(agent.scope)
  const installed = check.data === 'installed'

  const copy = async () => {
    setNotice(null)

    try {
      await Clipboard.setStringAsync(prompt)
      setCopied(true)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const send = () => {
    if (createSession.isPending) return

    setNotice(null)
    createSession.mutate(undefined, {
      onSuccess: id => {
        // Addressed to the session just created, the way home does it, so the
        // message is handed over before its screen exists.
        submitMessage(id, prompt)
        router.push(`/chat/${id}` as never)
      },
      onError: cause => setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const done = () => {
    // From Settings there is a screen to go back to; from setup there is not,
    // and home becomes the root.
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Set up the host plugin" />

      <ScrollView contentContainerStyle={[styles.body, { paddingTop: headerInset }]}>
        <Text variant="secondary">
          {`You can talk to ${agent.displayName} now. Notifications, the files it makes and approvals from this phone need a small plugin on ${server?.displayName ?? 'the host'} — and the agent can install it itself.`}
        </Text>

        <Card style={styles.statusCard}>
          <View style={styles.statusHead}>
            {check.isPending && connection !== 'error' ? (
              <ActivityIndicator size="small" color={theme.color.secondary} />
            ) : (
              <Icon
                name={installed ? 'circle-check' : check.isError || connection === 'error' ? 'circle-exclamation' : 'circle'}
                size={15}
                color={installed ? theme.color.success700 : check.isError || connection === 'error' ? theme.color.warning700 : theme.color.gray400}
              />
            )}
            <Text variant="rowLabelStrong" style={styles.statusText}>
              {installed
                ? 'The plugin is installed and answering'
                : check.data === 'missing'
                  ? 'The plugin is not on this host yet'
                  : check.isError
                    ? 'Could not check the host'
                    : connection === 'error'
                      ? 'Not connected to the host'
                      : 'Checking the host…'}
            </Text>
          </View>
          {installed ? (
            <Text variant="secondary">Notifications, the files it makes, and approvals from this phone are all on.</Text>
          ) : check.isError ? (
            <Text variant="secondary" color={theme.color.error700}>
              {String((check.error as Error).message)}
            </Text>
          ) : check.data === 'missing' ? (
            <Text variant="secondary">This page checks again every few seconds, so the tick appears once the agent is done.</Text>
          ) : null}
        </Card>

        {!installed ? (
          <>
            <Text variant="sectionHeader">The prompt to give it</Text>
            <Card style={styles.promptCard}>
              <Text variant="mono" selectable numberOfLines={unfolded ? undefined : PROMPT_PREVIEW_LINES}>
                {prompt}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setUnfolded(value => !value)} style={styles.fold}>
                <Text variant="rowLabelStrong" color={theme.color.secondaryDeep}>
                  {unfolded ? 'Show less' : 'Show the whole prompt'}
                </Text>
              </Pressable>
            </Card>

            <View style={styles.actions}>
              <SetupButton label={createSession.isPending ? 'Starting…' : 'Send it to the agent'} busy={createSession.isPending} disabled={!backend} onPress={send} />
              <SetupLink label={copied ? 'Copied' : 'Copy the prompt instead'} onPress={() => void copy()} />
            </View>

            <Text variant="secondary">
              The agent will run commands on its own host, so it may stop and ask you first. Paste the prompt into the dashboard instead if you would rather watch it there.
            </Text>
          </>
        ) : null}

        {notice ? (
          <Text variant="secondary" color={theme.color.error700}>
            {notice}
          </Text>
        ) : null}
      </ScrollView>

      <SetupFooter step="plugin" bottomInset={insets.bottom}>
        {installed ? <SetupButton label="Done" onPress={done} /> : <SetupLink label="Skip for now" onPress={done} />}
      </SetupFooter>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 13 },
  statusCard: { padding: 14, gap: 6 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusText: { flex: 1, minWidth: 0 },
  promptCard: { padding: 14, gap: 8 },
  fold: { alignSelf: 'flex-start', paddingVertical: 2 },
  actions: { gap: 4 }
})
