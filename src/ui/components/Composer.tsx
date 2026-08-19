import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One 48px action slot with three states — disabled, send, stop.
 *
 * Stop lives here, in the composer, while streaming; it is deliberately not in
 * the overflow menu (§7.2). A fourth state covers disconnection: the button
 * shows a clock and the message queues in the outbox instead (§7.16).
 */
export function Composer({
  streaming,
  offline,
  queued,
  onSend,
  onStop,
  onVoice
}: {
  streaming: boolean
  offline: boolean
  queued: number
  onSend: (text: string) => void
  onStop: () => void
  /** Omitted when the agent reports no audio input — the mic is then absent,
   *  not disabled (§4.1). */
  onVoice?: () => void
}) {
  const theme = useTheme()
  const gradient = useGradient()
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState('')

  const typing = draft.trim().length > 0

  const submit = () => {
    if (!typing) return

    onSend(draft)
    setDraft('')
  }

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          paddingBottom: Math.max(insets.bottom, 12) + 10
        }
      ]}
    >
      {queued > 0 ? (
        <Text variant="secondary" color={theme.color.warning700} style={styles.queued}>
          {`${queued} message${queued === 1 ? '' : 's'} queued — sends on reconnect`}
        </Text>
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
          <Icon name="paperclip" size={15} color={theme.color.gray400} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the agent"
            placeholderTextColor={theme.color.gray400}
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
          state={streaming ? 'stop' : offline && typing ? 'queue' : typing ? 'send' : 'idle'}
          gradient={gradient}
          onPress={streaming ? onStop : submit}
        />
      </View>
    </View>
  )
}

function ActionButton({
  state,
  gradient,
  onPress
}: {
  state: 'idle' | 'send' | 'stop' | 'queue'
  gradient: ReturnType<typeof useGradient>
  onPress: () => void
}) {
  const theme = useTheme()

  if (state === 'send') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={onPress}>
        <LinearGradient colors={gradient.colors} start={gradient.start} end={gradient.end} style={styles.action}>
          <Icon name="arrow-up" size={17} color="#ffffff" />
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
        <Icon name="stop" size={15} color="#ffffff" />
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
