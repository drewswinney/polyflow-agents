import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from 'expo-audio'
import { File } from 'expo-file-system'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useBackend } from '@/state/ConnectionProvider'
import { useAgentScopedRoute } from '@/state/agent-scope'
import { useChatInbox } from '@/state/chat-inbox'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Voice — push-to-talk (§7.9).
 *
 * The design draws a realtime voice mode: barge-in, a 180ms round trip, an agent
 * that talks back. None of that is buildable. Hermes's audio surface is three
 * request/response REST endpoints — transcribe, speak, list voices — with no
 * duplex channel anywhere (§2.6), so "interrupt the agent by speaking" has
 * nothing to interrupt.
 *
 * What is real is hold-to-talk: record, release, transcribe, and the text lands
 * in the composer's send path exactly as if it had been typed. That is a
 * smaller promise, and one the API can actually keep.
 */
export default function VoiceScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const backend = useBackend()
  const submit = useChatInbox(state => state.submit)

  // Dictation is addressed to one session, and a session belongs to one agent
  // (§5.2): if the selection moves while this is open, the transcript has
  // nowhere to be sent and the screen leaves rather than posting it into the
  // wrong scope.
  useAgentScopedRoute()

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 100)

  const [phase, setPhase] = useState<'idle' | 'denied' | 'recording' | 'transcribing'>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync()

      if (!permission.granted) {
        setPhase('denied')

        return
      }

      // Recording on iOS needs the session put into a record-capable mode
      // explicitly, or `record()` succeeds and captures silence.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    })()
  }, [])

  const start = async () => {
    if (phase === 'denied' || phase === 'transcribing') return

    setError(null)
    setTranscript('')

    try {
      await recorder.prepareToRecordAsync()
      recorder.record()
      setPhase('recording')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('idle')
    }
  }

  const stop = async () => {
    if (phase !== 'recording') return

    setPhase('transcribing')

    try {
      await recorder.stop()

      const uri = recorder.uri

      if (!uri || !backend) throw new Error('Nothing was recorded.')

      // The transcribe endpoint takes a base64 data URL, so the clip is read
      // back off disk rather than streamed — there is no streaming endpoint to
      // stream to.
      const base64 = await new File(uri).base64()
      const mimeType = uri.endsWith('.wav') ? 'audio/wav' : 'audio/m4a'
      const text = await backend.transcribe(`data:${mimeType};base64,${base64}`, mimeType)

      setTranscript(text)
      setPhase('idle')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('idle')
    }
  }

  const send = () => {
    submit(id, transcript)
    router.back()
  }

  const canRecord = phase === 'idle' || phase === 'recording'

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Voice"
        onBack={() => router.back()}
        subtitle={<Text variant="monoSmall">push to talk · not realtime</Text>}
      />

      <View style={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.stage}>
          {/* A static aura, layered circles rather than a radial gradient —
              React Native has none (design §Platform notes). */}
          <View style={[styles.auraOuter, { backgroundColor: theme.color.secondaryTint }]} />
          <View style={[styles.auraInner, { backgroundColor: theme.color.secondaryTintStrong }]} />

          <View style={styles.bars}>
            {[0, 1, 2, 3, 4, 5].map(index => (
              <View
                key={index}
                style={[
                  styles.bar,
                  {
                    backgroundColor: theme.color.secondary,
                    height: barHeight(index, recorderState.isRecording ? recorderState.metering : undefined),
                    opacity: recorderState.isRecording ? 0.9 : 0.28
                  }
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.readout}>
          <Text variant="sheetTitle" style={styles.status}>
            {phase === 'denied'
              ? 'Microphone access is off'
              : phase === 'recording'
                ? 'Listening'
                : phase === 'transcribing'
                  ? 'Transcribing'
                  : transcript
                    ? 'Ready to send'
                    : 'Hold to talk'}
          </Text>

          {transcript ? (
            <Text variant="body" style={styles.transcript}>
              {`“${transcript}”`}
            </Text>
          ) : null}

          {error ? (
            <Text variant="secondary" color={theme.color.error700}>
              {error}
            </Text>
          ) : null}

          {phase === 'denied' ? (
            <Text variant="secondary" style={styles.transcript}>
              Grant microphone access in system settings to dictate. Typing still works.
            </Text>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
            disabled={!canRecord}
            onPressIn={() => void start()}
            onPressOut={() => void stop()}
            style={[
              styles.talk,
              {
                backgroundColor: recorderState.isRecording ? theme.color.secondary : theme.color.surface,
                borderColor: recorderState.isRecording ? theme.color.secondary : theme.color.border
              }
            ]}
          >
            <Icon
              name="microphone"
              size={26}
              color={recorderState.isRecording ? theme.color.onAccent : theme.color.secondary}
            />
          </Pressable>

          <Text variant="secondary">Everything said here lands in the text transcript.</Text>

          {transcript ? (
            <Pressable
              accessibilityRole="button"
              onPress={send}
              style={[styles.send, { backgroundColor: theme.color.secondary, borderRadius: theme.radius.control }]}
            >
              <Text variant="rowLabelStrong" color={theme.color.onAccent}>
                Send to session
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

/**
 * Bar heights from the recorder's metering, in dBFS (roughly -160 quiet to 0
 * loud). Each bar is offset so the group reads as a waveform rather than six
 * identical sticks moving in lockstep.
 */
function barHeight(index: number, metering: number | undefined): number {
  if (metering === undefined) return 18

  const level = Math.min(1, Math.max(0, (metering + 60) / 60))
  const offsets = [0.6, 0.85, 1, 0.9, 0.7, 0.5]

  return 18 + level * 48 * offsets[index % offsets.length]
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between', paddingTop: 24 },
  stage: { height: 248, alignItems: 'center', justifyContent: 'center' },
  auraOuter: { position: 'absolute', width: 236, height: 236, borderRadius: 118, opacity: 0.8 },
  auraInner: { position: 'absolute', width: 188, height: 188, borderRadius: 94, opacity: 0.9 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 66 },
  bar: { width: 4, borderRadius: 100 },
  readout: { alignItems: 'center', gap: 10 },
  status: { textAlign: 'center' },
  transcript: { textAlign: 'center', maxWidth: 300 },
  controls: { alignItems: 'center', gap: 14 },
  talk: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  send: { height: 52, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
})
