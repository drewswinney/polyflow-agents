import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { ActivityIndicator, Keyboard, Platform, StyleSheet, View } from 'react-native'

import type { TranscriptEntry } from '@/domain'
import { useBackend, useConnectionState } from '@/state/ConnectionProvider'
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
import { ScrollToBottomButton } from '@/ui/components/ScrollToBottomButton'
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
  const backend = useBackend()
  const state = useConnectionState()
  const openSidebar = useSidebar(store => store.show)
  const listRef = useRef<FlashListRef<TranscriptEntry>>(null)

  const stream = useSessionStream(backend, id, state)
  const streaming = useIsStreaming(stream.tail)
  // The composer offers Stop for the whole turn, not just while tokens land: a
  // tool can run for minutes with nothing streaming, and that is precisely when
  // someone reaches for cancel.
  const running = streaming || stream.turnActive

  /**
   * The transcript's two states (§7.3).
   *
   * *Following* is the resting state: the view is parked at the end and stays
   * there, so a reply arriving while you watch pushes the view down as it lands
   * and the newest line is always the one on screen.
   *
   * *Manual* is what dragging away from the end buys you — nothing may move the
   * view again until you ask for it back. Arrivals still land, silently, below
   * the fold.
   *
   * A ref, because the decision is read inside scroll and layout callbacks that
   * run every frame; mirrored to state, because the button that hands following
   * back renders off it and only the crossing may cost a render.
   */
  const following = useRef(true)
  const [manual, setManual] = useState(false)

  const setFollowing = useCallback((next: boolean) => {
    following.current = next
    setManual(current => (current === !next ? current : !next))
  }, [])

  /**
   * Whether a finger is on the transcript.
   *
   * Only a drag may break the follow. Pinning the end is itself a scroll, and
   * it reports a frame or two of not being at the end yet — read as a
   * departure, a streaming reply would drop itself into manual on its own first
   * token.
   *
   * Cleared when the finger lifts rather than when momentum settles: the frames
   * that decide have already been read by then, and a flick that coasts back to
   * the end should be allowed to resume following.
   */
  const dragging = useRef(false)

  /**
   * Whether the transcript has found its position yet.
   *
   * A list of markdown, tool cards and thinking blocks has no knowable height
   * until it is measured, and measuring happens over several frames after the
   * rows mount — each one nudging everything below it. Watching that settle is
   * the jumping on opening a chat. It is hidden rather than fixed, because
   * there is nothing to fix: the passes are how the heights become known. The
   * list is laid out, scrolled to the end and only then shown.
   */
  const [placed, setPlaced] = useState(false)

  /**
   * Pinning the end while following.
   *
   * Fires on every token, so the scroll is unanimated: an animation restarted
   * each frame never arrives anywhere, and the distance being covered here is a
   * line of text.
   */
  const onContentSizeChange = useCallback(() => {
    if (following.current) listRef.current?.scrollToEnd({ animated: false })
  }, [])

  const onScrollBeginDrag = useCallback(() => {
    dragging.current = true
  }, [])

  const onScrollEndDrag = useCallback(() => {
    dragging.current = false
  }, [])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const atEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80

      // Parked at the end *is* following: there is nothing below to have
      // scrolled away from, and staying manual there would hide the button that
      // hands following back while arrivals quietly piled up off screen.
      if (atEnd) setFollowing(true)
      else if (dragging.current) setFollowing(false)
    },
    [setFollowing]
  )

  /** Back to the end, and back to following it. The button, and the nudge. */
  const follow = useCallback(() => {
    setFollowing(true)
    listRef.current?.scrollToEnd({ animated: true })
  }, [setFollowing])

  // The keyboard coming up shrinks the list by its height, which slides the
  // newest message up behind it. Following it keeps the last thing said in view
  // — animated, so it rises alongside the keyboard rather than after it. The
  // second pass corrects for the frame still shrinking under the first.
  useEffect(() => {
    const keepEnd = () => {
      if (following.current) listRef.current?.scrollToEnd({ animated: true })
    }

    const willShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', keepEnd)
    const didShow = Keyboard.addListener('keyboardDidShow', keepEnd)

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
    if (!approvalId || stream.loading || !placed) return
    if (approvalId !== restoredApprovalId && !following.current) return

    // The turn is halted on an answer from you, so it outranks reading position
    // — and having been carried to the end, the view follows it again.
    setFollowing(true)

    // The footer holding the card is only measured a frame after mount, so an
    // immediate scrollToEnd lands short of it. One frame is enough.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)

    return () => clearTimeout(timer)
  }, [approvalId, restoredApprovalId, stream.loading, placed, setFollowing])

  const pendingMessage = useChatInbox(inbox => inbox.pending)
  const takeMessage = useChatInbox(inbox => inbox.take)
  const streamLoading = stream.loading
  const streamSend = stream.send

  // A dictated message, or the first message of a session started from home,
  // goes out through chat's own send path rather than the producing screen's, so
  // it gets the optimistic bubble and the offline outbox like anything typed.
  //
  // Only the message addressed to *this* session: more than one chat screen is
  // routinely mounted, and an unaddressed message went to whichever of them was
  // loaded first rather than to the session it was written for (see
  // `chat-inbox`).
  //
  // Not until the transcript has loaded: the load overwrites `entries`, so a
  // send that beats it in would have its own bubble wiped off the screen.
  useEffect(() => {
    if (pendingMessage?.sessionId !== id || streamLoading) return

    const text = takeMessage(id)

    if (text) streamSend(text)
  }, [pendingMessage, takeMessage, streamLoading, streamSend, id])

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
          <View style={[styles.flex, placed ? null : styles.unplaced]}>
            <FlashList
              ref={listRef}
              data={stream.entries}
              keyExtractor={entry => entry.id}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
              // Only when there is something to say. An always-mounted header
              // that grows and shrinks with the connection is a height change at
              // the top of the list, which every scroll position below it then
              // has to absorb — that is the flicker.
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
              // Opens already at the last message rather than rendering from the
              // top and animating down to it. Deliberately *without*
              // `autoscrollToBottomThreshold`: following the end is what
              // `onContentSizeChange` above does, and the two would fight every
              // frame over which of them owns the offset.
              maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
              onContentSizeChange={onContentSizeChange}
              onScrollBeginDrag={onScrollBeginDrag}
              onScrollEndDrag={onScrollEndDrag}
              // Dragging the transcript down takes the keyboard with it, the way
              // it does in Messages. Android has no interactive mode, so the
              // keyboard leaves on the drag instead of tracking the finger.
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              // With the keyboard up, the first tap on an approval button should
              // answer it, not just close the keyboard.
              keyboardShouldPersistTaps="handled"
              // Fired once the first rows are actually laid out. Only then is
              // there an end to scroll to: `startRenderingFromBottom` puts the
              // last *entry* on screen, and the footer holding the streaming
              // tail and any approval card lives below it.
              onLoad={() => {
                listRef.current?.scrollToEnd({ animated: false })
                requestAnimationFrame(() => setPlaced(true))
              }}
            />

            {/* Only in manual: in the resting state there is nothing below to
                be taken back to, and a button pointing at where you already are
                is chrome over the transcript for nothing.

                Anchored to the transcript's own bottom edge, which *is* the top
                of the composer: the list is the flex child above it. Pinning to
                the screen instead would put the button under the composer. */}
            {manual && placed ? (
              <View style={styles.scrollButtonContainer}>
                <ScrollToBottomButton onPress={follow} />
              </View>
            ) : null}
          </View>
        )}

        {(stream.approval || stream.clarify) && manual ? <ApprovalNudge onPress={follow} /> : null}

        <Composer
          streaming={running}
          offline={state !== 'open'}
          queued={stream.outbox.length}
          onSend={stream.send}
          onStop={stream.cancel}
          onVoice={backend?.capabilities.media.audioIn ? () => router.push(`/voice/${id}`) : undefined}
          canAttach={backend?.capabilities.media.images ?? false}
        />
      </KeyboardInset>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 32 },
  // Laid out and measured, just not watched while it happens.
  unplaced: { opacity: 0 },
  list: { paddingHorizontal: 16, paddingVertical: 16 },
  header: { gap: 10, paddingBottom: 6 },
  entry: { paddingVertical: 7 },
  approval: { paddingTop: 7 },
  scrollButtonContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
    pointerEvents: 'box-none'
  }
})
