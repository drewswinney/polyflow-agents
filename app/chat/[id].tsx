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
   * Whether the transcript is parked at the bottom.
   *
   * Only decides whether a *pending approval* is worth yanking the view to, and
   * whether the keyboard rising should take the tail with it. A ref, not state,
   * because it changes on every scroll frame and nothing should re-render.
   */
  const atBottom = useRef(true)

  /**
   * Mirrors `atBottom` as state, but only crossing the threshold re-renders —
   * this drives the pending-approval bar, and nothing else may pay per frame.
   */
  const [scrolledAway, setScrolledAway] = useState(false)

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
   * Where the incoming turn starts, and whether the view is still holding it.
   *
   * A reply is read from its first line. Parking at the bottom of it means
   * reading a message backwards — the top scrolls away as fast as the bottom
   * arrives — so the view parks at the top of what just came in and lets the
   * rest fill the screen beneath it.
   *
   * The offset it starts at is simply how tall the transcript was the moment
   * before, which is what `contentHeight` is here to remember.
   */
  const contentHeight = useRef(0)
  const anchor = useRef<number | null>(null)
  const holdAnchor = useRef(false)

  // A turn opens on the first chunk or tool call of a reply, which is the
  // moment there is something new to read.
  useEffect(() => {
    holdAnchor.current = stream.turnActive
    if (stream.turnActive) anchor.current = null
  }, [stream.turnActive])

  /**
   * Re-aim at each new thing, not just at the first.
   *
   * The anchor used to be captured once per turn, so a reply that ran long
   * pinned the view to its opening line and everything after it — the second
   * paragraph, every tool card, the whole rest of the turn — arrived below the
   * fold and stayed there. One turn, one glimpse.
   *
   * A settled entry appearing is the same event the anchor exists for: a new
   * thing to read. Clearing it re-arms the capture, so the next growth parks
   * that entry's top where the reply's first line went. Reading rule unchanged,
   * applied per item instead of per turn.
   *
   * Length, not the array: entries are replaced wholesale on every transcript
   * load, and re-aiming on a reload that returned the same rows would yank the
   * view for nothing.
   */
  const entryCount = stream.entries.length

  useEffect(() => {
    // Only while the view still holds the turn. Once a drag has released the
    // anchor the reader has chosen a position, and new arrivals do not get to
    // take it back (§7.3).
    if (holdAnchor.current) anchor.current = null
  }, [entryCount])

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    const previous = contentHeight.current

    contentHeight.current = height

    if (!holdAnchor.current) return

    // Captured on the first growth *after* the turn opened, so the message you
    // sent is already measured into the height being captured.
    if (anchor.current === null) {
      anchor.current = previous
      listRef.current?.scrollToOffset({ offset: previous, animated: true })

      return
    }

    // Held rather than re-aimed. Until the reply is a screen tall the list
    // cannot scroll that far and the offset clamps, so each token that arrives
    // buys a little more of the distance and the first line climbs to the top;
    // from then on this is the offset it is already at, and the view stops.
    // Unanimated — an animation here would be re-started every frame.
    listRef.current?.scrollToOffset({ offset: anchor.current, animated: false })
  }, [])

  // Dragging is taking over: the reader has chosen a position, and nothing may
  // pull them off it for the rest of the turn.
  const releaseAnchor = useCallback(() => {
    holdAnchor.current = false
  }, [])

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
    if (!approvalId || stream.loading || !placed) return
    if (approvalId !== restoredApprovalId && !atBottom.current) return

    // The turn is halted on an answer from you, so it outranks reading position.
    holdAnchor.current = false

    // The footer holding the card is only measured a frame after mount, so an
    // immediate scrollToEnd lands short of it. One frame is enough.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)

    return () => clearTimeout(timer)
  }, [approvalId, restoredApprovalId, stream.loading, placed])

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
              // `autoscrollToBottomThreshold`: following the bottom is the thing
              // the anchor above replaces, and the two would fight every frame.
              maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
              onContentSizeChange={onContentSizeChange}
              onScrollBeginDrag={releaseAnchor}
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
          </View>
        )}

        {(stream.approval || stream.clarify) && scrolledAway ? (
          <ApprovalNudge onPress={() => listRef.current?.scrollToEnd({ animated: true })} />
        ) : null}

        {scrolledAway && placed ? (
          <View style={styles.scrollButtonContainer}>
            <ScrollToBottomButton onPress={() => listRef.current?.scrollToEnd({ animated: true })} />
          </View>
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
  // Laid out and measured, just not watched while it happens.
  unplaced: { opacity: 0 },
  list: { paddingHorizontal: 16, paddingVertical: 16 },
  header: { gap: 10, paddingBottom: 6 },
  entry: { paddingVertical: 7 },
  approval: { paddingTop: 7 },
  scrollButtonContainer: {
    marginTop: -12,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
})
