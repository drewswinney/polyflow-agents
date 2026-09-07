import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { PermissionDenied, type PickedImage, type PickSource, pickImages } from '@/platform/image-attachments'

import { modelLabel } from '../format'
import { useSheet } from '@/state/sheet'

import { useBottomBarPadding } from '../keyboard'
import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One 48px action slot with three states — disabled, send, stop.
 *
 * Stop lives here, in the composer, while streaming; it is deliberately not in
 * the overflow menu (§7.2). A fourth state covers disconnection: the button
 * shows a clock and the message queues in the outbox instead (§7.16).
 *
 * A draft outranks the stream. Streaming used to win the slot outright, so
 * typing your next message while the agent worked left you holding a Stop
 * button — the one press you did not mean — and no way to send without
 * waiting for the turn to end. Text in the box is an unambiguous intent to
 * send it, so Stop yields the slot until the box is empty again.
 */
export function Composer({
  streaming,
  offline,
  queued,
  onSend,
  onStop,
  onVoice,
  canAttach = false,
  model,
  effort,
  onPressModel
}: {
  streaming: boolean
  offline: boolean
  queued: number
  onSend: (text: string, images: PickedImage[]) => void
  onStop: () => void
  /** Omitted when the agent reports no audio input — the mic is then absent,
   *  not disabled (§4.1). */
  onVoice?: () => void
  /** False when the agent reports no image support; the clip is then absent,
   *  not disabled (§4.1). */
  canAttach?: boolean
  /** The model this session runs on. Absent before a session exists, and the
   *  chip is then absent too — an empty chip names nothing. */
  model?: string | null
  /** Reasoning effort beside the model, when the harness reports one. */
  effort?: string | null
  /** Opens the model picker. Without it the chip is a label, not a control. */
  onPressModel?: (() => void) | undefined
}) {
  const theme = useTheme()
  const gradient = useGradient()
  // Tracks the keyboard rather than toggling with it, so the bar stays welded
  // to the keyboard's top edge while you swipe it away (§7.2).
  const bottomPadding = useBottomBarPadding(10)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<PickedImage[]>([])
  const [picking, setPicking] = useState(false)
  const openSheet = useSheet(store => store.open)

  const typing = draft.trim().length > 0
  // A picture with no caption is a message; the send button has to agree, or
  // the only way to send one would be to type something first.
  const sendable = typing || images.length > 0
  const action: ActionState = sendable ? (offline ? 'queue' : 'send') : streaming ? 'stop' : 'idle'

  const submit = () => {
    if (!sendable) return

    onSend(draft, images)
    setDraft('')
    setImages([])
  }

  const attach = async (source: PickSource) => {
    setPicking(true)

    try {
      const picked = await pickImages(source)

      if (picked.length) setImages(current => [...current, ...picked])
    } catch (cause) {
      Alert.alert(
        'Could not attach',
        cause instanceof PermissionDenied ? cause.message : cause instanceof Error ? cause.message : String(cause)
      )
    } finally {
      setPicking(false)
    }
  }

  // A sheet rather than `Alert.alert`. The OS action sheet could hold two
  // labels and nothing else — no thumbnails, no room for what else might be
  // added to a chat — and on Android it draws as an error dialog.
  const chooseSource = () => {
    if (picking) return

    openSheet({ kind: 'add-to-chat', onPick: source => void attach(source) })
  }

  return (
    // No fill of its own: the bar is transparent so the screen (or, on chat,
    // the transcript scrolling behind it) shows through. Opaque are only the
    // pill, the action button, and the strip above them. `pointerEvents:
    // box-none` goes with that — the bar's padding and the gap between the
    // pill and the button must not shield whatever sits behind the bar (the
    // transcript on chat; on home it just narrows the hit targets to the real
    // controls).
    <Animated.View style={[styles.wrap, bottomPadding]} pointerEvents="box-none">
      {queued > 0 ? (
        <Text variant="secondary" color={theme.color.warning700} style={styles.queued}>
          {`${queued} message${queued === 1 ? '' : 's'} queued — sends on reconnect`}
        </Text>
      ) : null}

      {images.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {images.map(image => (
            <Staged
              key={image.uri}
              image={image}
              onRemove={() => setImages(current => current.filter(row => row.uri !== image.uri))}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* One card, two rows: what you are writing, and what it will go out
          with. The controls used to sit inside the input's own pill, which
          worked while there were two of them — a clip and a mic — and stopped
          working the moment the model belonged there too: a chip long enough
          to name a model squeezed the text into a slot too narrow to read a
          sentence in. */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.color.bgSubtle,
            borderColor: typing ? theme.color.secondaryMuted : theme.color.border,
            borderRadius: theme.radius.floating,
            borderStyle: offline ? 'dashed' : 'solid'
          }
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the agent"
          placeholderTextColor={theme.color.gray400}
          keyboardAppearance={theme.dark ? 'dark' : 'light'}
          multiline
          style={[styles.input, { color: theme.color.gray800, fontFamily: theme.font.body }]}
          onSubmitEditing={submit}
        />

        <View style={styles.controls}>
          {canAttach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach an image"
              accessibilityState={{ disabled: picking }}
              disabled={picking}
              onPress={chooseSource}
              hitSlop={6}
              style={({ pressed }) => [
                styles.round,
                { backgroundColor: theme.color.surface, opacity: pressed || picking ? 0.5 : 1 }
              ]}
            >
              <Icon name="plus" size={15} color={theme.color.gray600} />
            </Pressable>
          ) : null}

          {model ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Model: ${model}${effort ? `, ${effort} effort` : ''}`}
              disabled={!onPressModel}
              onPress={onPressModel}
              hitSlop={6}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.pill,
                  opacity: pressed && onPressModel ? 0.6 : 1
                }
              ]}
            >
              {/* Two weights, one line: the model is the answer to "what am I
                  talking to", the effort is a qualifier on it. */}
              <Text variant="secondary" color={theme.color.gray800} numberOfLines={1}>
                {modelLabel(model)}
              </Text>
              {effort ? (
                <Text variant="secondary" color={theme.color.muted} numberOfLines={1}>
                  {effort}
                </Text>
              ) : null}
            </Pressable>
          ) : null}

          {/* Pushes the send cluster to the trailing edge whatever sits left. */}
          <View style={styles.spacer} pointerEvents="none" />

          {!typing && onVoice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk to the agent"
              onPress={onVoice}
              hitSlop={6}
              style={({ pressed }) => [
                styles.round,
                { backgroundColor: theme.color.surface, opacity: pressed ? 0.6 : 1 }
              ]}
            >
              <Icon name="microphone" size={14} color={theme.color.gray600} />
            </Pressable>
          ) : null}

          <ActionButton
            state={action}
            gradient={gradient}
            // Driven by the state it renders, not by `streaming` a second time,
            // so the icon and what pressing it does cannot drift apart.
            onPress={action === 'stop' ? onStop : submit}
          />
        </View>
      </View>
    </Animated.View>
  )
}

/** One picked image waiting to be sent, with the way to change your mind. */
function Staged({ image, onRemove }: { image: PickedImage; onRemove: () => void }) {
  const theme = useTheme()

  return (
    <View>
      <Image
        source={{ uri: image.uri }}
        style={[styles.thumb, { borderColor: theme.color.border, borderRadius: theme.radius.control }]}
        accessibilityLabel={image.name}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${image.name}`}
        onPress={onRemove}
        hitSlop={8}
        style={[styles.remove, { backgroundColor: theme.color.gray800 }]}
      >
        <Icon name="xmark" size={9} color={theme.color.onAccent} />
      </Pressable>
    </View>
  )
}

type ActionState = 'idle' | 'send' | 'stop' | 'queue'

function ActionButton({
  state,
  gradient,
  onPress
}: {
  state: ActionState
  gradient: ReturnType<typeof useGradient>
  onPress: () => void
}) {
  const theme = useTheme()

  if (state === 'send') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={onPress}>
        <LinearGradient colors={gradient.colors} start={gradient.start} end={gradient.end} style={styles.action}>
          <Icon name="arrow-up" size={17} color={theme.color.onAccent} />
        </LinearGradient>
      </Pressable>
    )
  }

  if (state === 'stop') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop"
        onPress={onPress}
        style={[styles.action, { backgroundColor: '#6d28d9' }]}
      >
        <Icon name="stop" size={15} color={theme.color.onAccent} />
      </Pressable>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state === 'queue' ? 'Queue message' : 'Send'}
      disabled={state === 'idle'}
      onPress={onPress}
      style={[styles.action, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, borderWidth: 1 }]}
    >
      <Icon name={state === 'queue' ? 'clock' : 'arrow-up'} size={16} color={theme.color.gray400} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  queued: { paddingHorizontal: 4 },
  strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingTop: 2, paddingRight: 8 },
  thumb: { width: 56, height: 56, borderWidth: StyleSheet.hairlineWidth },
  remove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: { borderWidth: 1, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, gap: 2 },
  // No flex: the input sizes to its own content between one line and `maxHeight`,
  // and the control row sits under whatever that comes to.
  input: { fontSize: 15, minHeight: 40, maxHeight: 120, paddingHorizontal: 8, paddingVertical: 9 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flexGrow: 1, flexShrink: 0, flexBasis: 0 },
  round: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  // `flexShrink` with `minWidth: 0` so a long model id truncates inside the
  // chip instead of pushing the send button off the end of the row.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    flexShrink: 1,
    minWidth: 0
  },
  action: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }
})
