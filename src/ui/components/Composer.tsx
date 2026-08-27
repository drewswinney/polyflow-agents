import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { PermissionDenied, type PickedImage, type PickSource, pickImages } from '@/platform/image-attachments'

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
  canAttach = false
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
}) {
  const theme = useTheme()
  const gradient = useGradient()
  // Tracks the keyboard rather than toggling with it, so the bar stays welded
  // to the keyboard's top edge while you swipe it away (§7.2).
  const bottomPadding = useBottomBarPadding(10)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<PickedImage[]>([])
  const [picking, setPicking] = useState(false)

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

  const chooseSource = () => {
    if (picking) return

    Alert.alert('Attach an image', undefined, [
      { text: 'Photo Library', onPress: () => void attach('library') },
      { text: 'Take Photo', onPress: () => void attach('camera') },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        { backgroundColor: theme.color.surface, borderTopColor: theme.color.border },
        bottomPadding
      ]}
    >
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

      <View style={styles.row}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: theme.color.bgSubtle,
              borderColor: typing ? theme.color.secondaryMuted : theme.color.border,
              borderRadius: theme.radius.pill,
              borderStyle: offline ? 'dashed' : 'solid'
            }
          ]}
        >
          {canAttach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach an image"
              accessibilityState={{ disabled: picking }}
              disabled={picking}
              onPress={chooseSource}
              // Grown to clear 44 without moving the glyph: a 15px icon is a
              // 15px target, and the misses read as a dead button rather than
              // as a miss. Kept inside the pill's own 48px box on every side,
              // because Android does not deliver a touch that lands outside
              // the parent's bounds however much slop is asked for.
              hitSlop={{ top: 16, bottom: 16, left: 13, right: 12 }}
              style={({ pressed }) => ({ opacity: pressed || picking ? 0.5 : 1 })}
            >
              <Icon name="paperclip" size={15} color={theme.color.gray400} />
            </Pressable>
          ) : null}
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
          {!typing && onVoice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk to the agent"
              onPress={onVoice}
              // The circle is 36px by the design; the remaining 8px in each
              // direction is made up invisibly so the target still clears 44.
              hitSlop={4}
              style={({ pressed }) => [
                styles.mic,
                { backgroundColor: theme.color.secondaryTint, opacity: pressed ? 0.6 : 1 }
              ]}
            >
              <Icon name="microphone" size={14} color={theme.color.secondary} />
            </Pressable>
          ) : null}
        </View>

        <ActionButton
          state={action}
          gradient={gradient}
          // Driven by the state it renders, not by `streaming` a second time,
          // so the icon and what pressing it does cannot drift apart.
          onPress={action === 'stop' ? onStop : submit}
        />
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
        style={[styles.action, { backgroundColor: theme.color.gray800 }]}
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
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, gap: 8 },
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
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  field: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    borderWidth: 1
  },
  input: { flex: 1, fontSize: 15, maxHeight: 120, paddingVertical: 12 },
  mic: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  action: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }
})
