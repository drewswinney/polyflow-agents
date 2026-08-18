import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useRef } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native'

import type { TranscriptEntry } from '@/domain'
import { useActiveConnection } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { useSessionStream } from '@/state/session-stream'
import { useIsStreaming } from '@/state/stream-tail'
import { ApprovalSheet } from '@/ui/components/ApprovalSheet'
import { Composer } from '@/ui/components/Composer'
import { ConnectionBanner } from '@/ui/components/ConnectionBanner'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { StreamingTail } from '@/ui/components/StreamingTail'
import { Text } from '@/ui/components/Text'
import { TranscriptEntryView } from '@/ui/components/TranscriptEntryView'
import { compactTokens, usd } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Chat (§7.2) — the screen that earns the app.
 *
 * The transcript is a FlashList of settled, memoised entries with the streaming
 * tail as its footer. Tokens land in the tail's own store, so a delta repaints
 * one bubble rather than the list (§7.3).
 *
 * No agent pill here: sub-screens are reached by a back chevron and the agent is
 * established by how you got here (design §Global chrome).
 */
export default function ChatScreen() {
  const theme = useTheme()
  const agent = useSelectedAgent()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { backend, state, attempt } = useActiveConnection()
  const listRef = useRef<FlashListRef<TranscriptEntry>>(null)

  const stream = useSessionStream(backend, id, state)
  const streaming = useIsStreaming(stream.tail)

  const renderItem = useCallback(
    ({ item }: { item: TranscriptEntry }) => (
      <View style={styles.entry}>
        <TranscriptEntryView entry={item} />
      </View>
    ),
    []
  )

  const meta = [
    stream.transcript?.model,
    stream.usage?.contextTokens ? `${compactTokens(stream.usage.contextTokens)} ctx` : null,
    stream.usage?.costUsd !== undefined ? usd(stream.usage.costUsd) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title={stream.transcript?.title ?? 'Session'}
        onBack={() => router.back()}
        subtitle={
          state === 'open' ? (
            meta ? <Text variant="monoSmall">{meta}</Text> : null
          ) : (
            <Text variant="monoSmall" color={theme.color.warning700}>
              {stream.approval ? 'blocked on you' : 'reconnecting…'}
            </Text>
          )
        }
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Session options">
            <Icon name="ellipsis" />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {stream.loading ? (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        ) : (
          <FlashList
            ref={listRef}
            data={stream.entries}
            keyExtractor={entry => entry.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.header}>
                <ConnectionBanner state={state} attempt={attempt} />
                {stream.loadError ? (
                  <Text variant="secondary" color={theme.color.error700}>
                    {stream.loadError}
                  </Text>
                ) : null}
              </View>
            }
            ListFooterComponent={
              <View style={styles.entry}>
                <StreamingTail tail={stream.tail} />
              </View>
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        <Composer
          streaming={streaming}
          offline={state !== 'open'}
          queued={stream.outbox.length}
          onSend={stream.send}
          onStop={stream.cancel}
        />
      </KeyboardAvoidingView>

      {/* Blocking: the turn is halted on the host until this is answered. */}
      <ApprovalSheet request={stream.approval} hostName={agent.host} onRespond={stream.respondToApproval} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 32 },
  list: { paddingHorizontal: 16, paddingVertical: 16 },
  header: { gap: 10, paddingBottom: 6 },
  entry: { paddingVertical: 7 }
})
