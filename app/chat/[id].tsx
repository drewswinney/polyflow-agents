import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { ActivityIndicator, Keyboard, Platform, StyleSheet, View } from 'react-native'

import type { TranscriptEntry } from '@/domain'
import { useActiveConnection } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { useSidebar } from '@/state/sidebar'
import { useSessionStream } from '@/state/session-stream'
import { useIsStreaming } from '@/state/stream-tail'
import { useChatInbox } from '@/state/chat-inbox'
import { ApprovalCard, ApprovalNudge } from '@/ui/components/ApprovalCard'
import { ClarifyCard } from '@/ui/components/ClarifyCard'
import { Composer } from '@/ui/components/Composer'
import { IconButton } from '@/ui/components/IconButton'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { StreamingTail } from '@/ui/components/StreamingTail'
import { Text } from '@/ui/components/Text'
import { TranscriptEntryView } from '@/ui/components/TranscriptEntryView'
import { compactTokens, usd } from '@/ui/format'
import { KeyboardInset } from '@/ui/keyboard'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Chat (§7.2) — the screen that earns the app.
 *
 * The transcript is a FlashList of settled, memoised entries with the streaming
 * tail as its footer. Tokens land in the tail's own store, so a delta repaints
 * one bubble rather than the list (§7.3).
 *
 * No agent pill here: the agent is established by how you got into the session.
 */
export default function ChatScreen() {
  const theme = useTheme()
  const agent = useSelectedAgent()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { backend, state } = useActiveConnection()
  const openSidebar = useSidebar(store => store.show)
  const listRef = useRef<FlashListRef<TranscriptEntry>>(null)

  const stream = useSessionStream(backend, id, state)
  const streaming = useIsStreaming(stream.tail)
  // The composer offers Stop for the whole turn, not just while tokens land: a
  // tool can run for minutes with nothing streaming, and that is precisely when
  // someone reaches for cancel.
  const running = streaming || stream.turnActive

  /**
   * Whether the transcript is parked at the bottom.
   *
   * Following the tail is FlashList's job now (`maintainVisibleContentPosition`
   * below); this only decides whether a *pending approval* is worth yanking the
   * view to. A ref, not state, because it changes on every scroll frame and
   * nothing should re-render for it.
   */
  const atBottom = useRef(true)

  /**
   * Mirrors `atBottom` as state, but only crossing the threshold re-renders —
   * this drives the pending-approval bar, and nothing else may pay per frame.
   */
  const [scrolledAway, setScrolledAway] = useState(false)

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    atBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80
    setScrolledAway(current => (current === !atBottom.current ? current : !atBottom.current))
  }, [])

  // The keyboard coming up shrinks the list by its height, which slides the
  // newest message up behind it. Following it keeps the last thing said in view
  // — animated, so it rises alongside the keyboard rather than after it. The
  // second pass corrects for the frame still shrinking under the first.
  useEffect(() => {
    const follow = () => {
      if (atBottom.current) listRef.current?.scrollToEnd({ animated: true })
    }

    const willShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', follow)
    const didShow = Keyboard.addListener('keyboardDidShow', follow)

    return () => {
      willShow.remove()
      didShow.remove()
    }
  }, [])

  // An approval should be on screen, not appended below the fold. Keyed by id so
  // being asked a second time scrolls again.
  const approvalId = stream.approval?.id ?? stream.clarify?.id
  // One restored from the transcript is the reason this screen was opened at
  // all — you tapped a notification about it — so it scrolls whether or not you
  // were parked at the tail. A live one only follows the tail if you are
  // already there, and the bar above the composer covers the rest.
  const restoredApprovalId = stream.transcript?.pendingApproval?.id ?? stream.transcript?.pendingClarify?.id

  useEffect(() => {
    if (!approvalId || stream.loading) return
    if (approvalId !== restoredApprovalId && !atBottom.current) return

    // The footer holding the card is only measured a frame after mount, so an
    // immediate scrollToEnd lands short of it. One frame is enough.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)

    return () => clearTimeout(timer)
  }, [approvalId, restoredApprovalId, stream.loading])

  const pendingMessage = useChatInbox(inbox => inbox.pending)
  const takeMessage = useChatInbox(inbox => inbox.take)

  // A dictated message, or the first message of a session started from home,
  // goes out through chat's own send path rather than the producing screen's, so
  // it gets the optimistic bubble and the offline outbox like anything typed.
  //
  // Not until the transcript has loaded: the load overwrites `entries`, so a
  // send that beats it in would have its own bubble wiped off the screen.
  useEffect(() => {
    if (!pendingMessage || stream.loading) return

    const text = takeMessage()

    if (text) stream.send(text)
  }, [pendingMessage, takeMessage, stream])

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
        onMenu={openSidebar}
        titleVariant="sub"
        subtitle={
          state === 'open' ? (
            meta ? <Text variant="monoSmall">{meta}</Text> : null
          ) : (
            <Text variant="monoSmall" color={theme.color.warning700}>
              {stream.approval || stream.clarify ? 'blocked on you' : 'reconnecting…'}
            </Text>
          )
        }
        right={<IconButton name="ellipsis" accessibilityLabel="Session options" edge="right" />}
      />

      <KeyboardInset style={styles.flex}>
        {stream.loading ? (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        ) : (
          <FlashList
            ref={listRef}
            data={stream.entries}
            keyExtractor={entry => entry.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            // Only when there is something to say. An always-mounted header
            // that grows and shrinks with the connection is a height change at
            // the top of the list, which the bottom anchoring then has to
            // absorb — that is the flicker.
            ListHeaderComponent={
              stream.loadError ? (
                <View style={styles.header}>
                  <Text variant="secondary" color={theme.color.error700}>
                    {stream.loadError}
                  </Text>
                </View>
              ) : undefined
            }
            ListFooterComponent={
              <View style={styles.entry}>
                <StreamingTail tail={stream.tail} />

                {/* In the transcript, not over it: the turn is halted, but only
                    this session's, so nothing else needs to be blocked (§7.6). */}
                {stream.approval ? (
                  <View style={styles.approval}>
                    <ApprovalCard
                      request={stream.approval}
                      hostName={agent.host}
                      onRespond={stream.respondToApproval}
                    />
                  </View>
                ) : null}

                {/* A question halts the turn exactly as an approval does, so it
                    belongs in the same place, in the same shape. */}
                {stream.clarify ? (
                  <View style={styles.approval}>
                    <ClarifyCard request={stream.clarify} onRespond={stream.respondToClarify} />
                  </View>
                ) : null}
              </View>
            }
            onScroll={onScroll}
            scrollEventThrottle={16}
            // The list's own bottom-anchoring, in place of the hand-rolled
            // scrollToEnd effects this replaces: it opens already at the last
            // message rather than animating down to it, and follows anything
            // that grows below — tokens, a new card — while you are parked
            // there. The threshold is a fraction of the viewport, so ~10% of
            // the screen is the "still following" band.
            maintainVisibleContentPosition={{
              startRenderingFromBottom: true,
              autoscrollToBottomThreshold: 0.1
            }}
            // Dragging the transcript down takes the keyboard with it, the way
            // it does in Messages. Android has no interactive mode, so the
            // keyboard leaves on the drag instead of tracking the finger.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // With the keyboard up, the first tap on an approval button should
            // answer it, not just close the keyboard.
            keyboardShouldPersistTaps="handled"
          />
        )}

        {(stream.approval || stream.clarify) && scrolledAway ? (
          <ApprovalNudge onPress={() => listRef.current?.scrollToEnd({ animated: true })} />
        ) : null}

        <Composer
          streaming={running}
          offline={state !== 'open'}
          queued={stream.outbox.length}
          onSend={stream.send}
          onStop={stream.cancel}
          onVoice={backend?.capabilities.media.audioIn ? () => router.push(`/voice/${id}`) : undefined}
        />
      </KeyboardInset>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 32 },
  list: { paddingHorizontal: 16, paddingVertical: 16 },
  header: { gap: 10, paddingBottom: 6 },
  entry: { paddingVertical: 7 },
  approval: { paddingTop: 7 }
})
