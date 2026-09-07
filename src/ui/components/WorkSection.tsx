import { memo, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated'

import type { TranscriptEntry } from '@/domain'
import type { StreamTail } from '@/state/stream-tail'

import { useTheme } from '../ThemeProvider'
import { isWorkLive, workHeadline } from '../transcript-rows'
import { Icon, ToolGlyph } from './Icon'
import { Text } from './Text'
import { TranscriptEntryView } from './TranscriptEntryView'

/**
 * One turn's working-out, behind a header that says what it is doing.
 *
 * Collapsed by default, because the reason this exists is that a turn's tool
 * cards and thinking blocks push the reply off a phone screen (§7.2). Closed
 * is not silent, though: the header carries the current tool or thought and
 * updates as the agent moves, so a collapsed section still reports the turn
 * rather than hiding it.
 *
 * Drawn as a line of muted text rather than a card. The cards are what the
 * section holds; giving the header its own surface as well framed the quiet
 * part of the transcript more heavily than the conversation it sits between.
 *
 * Open state is owned by the screen, not held here. FlashList recycles cells,
 * and a `useState` in a recycled component is state from whatever row used the
 * view last — which is how one section opens and an unrelated one further down
 * opens with it.
 */
export const WorkSection = memo(function WorkSection({
  entries,
  open,
  onToggle,
  tail
}: {
  entries: TranscriptEntry[]
  open: boolean
  onToggle: () => void
  /**
   * The live stream, on the last section of a running turn only.
   *
   * Passed to exactly one section so that a flush repaints one header and not
   * the transcript (§7.3 step 2) — every other section reads settled entries
   * and never subscribes.
   */
  tail?: StreamTail
}) {
  const theme = useTheme()

  // Hooks cannot be conditional, so a section with no tail subscribes to a
  // store that never changes rather than skipping the subscription.
  const liveThinking = useSyncExternalStore(
    tail?.subscribe ?? NO_TAIL.subscribe,
    () => tail?.getSnapshot().thinking ?? ''
  )

  const headline = workHeadline(entries, liveThinking)
  const live = isWorkLive(entries, liveThinking)
  const last = entries[entries.length - 1]

  // One grey for the whole line — headline, glyph and chevron — so it reads as
  // a single quiet row rather than an icon with a caption. `muted` is the same
  // role the copy buttons under each message wear, and it carries the
  // light/dark difference so this does not have to.
  const muted = theme.color.muted

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // The headline alone would read out as a bare tool name with no hint
        // that it opens onto anything.
        accessibilityLabel={`${open ? 'Hide' : 'Show'} agent steps. ${headline}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.6 : 1 }]}
      >
        <PulsingGlyph live={live}>
          {last?.kind === 'tool' ? (
            <ToolGlyph name={last.call.name} size={12} color={live ? theme.color.toolInk : muted} />
          ) : (
            <Icon name="brain" size={12} color={live ? theme.color.secondary : muted} />
          )}
        </PulsingGlyph>

        <Text variant="secondary" color={muted} style={styles.headline} numberOfLines={1}>
          {headline}
        </Text>

        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={9} color={muted} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {entries.map(entry => (
            <View key={entry.id}>
              <TranscriptEntryView entry={entry} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
})

/** The subscription a section without a live tail makes: none, expressed as a
 *  store that never notifies. */
const NO_TAIL = { subscribe: () => () => undefined }

/** One breath of the header glyph, in milliseconds. Slow enough to read as
 *  activity rather than as a spinner asking to be waited on. */
const PULSE_MS = 1100
/** How far the glyph fades at the bottom of a breath. */
const PULSE_MIN_OPACITY = 0.25

/**
 * The header's glyph, breathing while the agent is inside the section.
 *
 * Opacity rather than a spinner. A spinner is a modal-feeling thing — it says
 * *wait* — and the whole point of the collapsed section is that you do not have
 * to: the turn is running, the header names the step, and you can read the
 * reply above it meanwhile. It fades the glyph's own colour, which is the
 * kind's ink while live, so the pulse says what is running as well as that
 * something is.
 *
 * The animation runs on the UI thread, so it costs nothing per token: the
 * transcript re-renders around it while this keeps breathing untouched.
 */
function PulsingGlyph({ live, children }: { live: boolean; children: ReactNode }) {
  const breath = useSharedValue(1)

  useEffect(() => {
    if (!live) {
      // Back to solid in one step rather than stopping mid-fade, which would
      // strand a settled section at whatever opacity the last frame held.
      breath.value = withTiming(1, { duration: 200 })

      return
    }

    breath.value = withRepeat(
      withTiming(PULSE_MIN_OPACITY, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )
  }, [live, breath])

  const style = useAnimatedStyle(() => ({ opacity: breath.value }))

  return <Animated.View style={[styles.glyph, style]}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  section: { alignItems: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  // Fixed, so the headline starts in the same place whether the section is
  // spinning, on a tool glyph, or on the brain — otherwise the text shifts
  // sideways every time the agent changes what it is doing.
  glyph: { width: 16, alignItems: 'center' },
  headline: { flex: 1 },
  // Inset under the header, so the steps read as belonging to the line that
  // names them rather than as siblings of it.
  //
  // `paddingTop` is deliberately larger than `gap`: the header is a different
  // kind of thing from the rows under it — a summary of them — and spacing it
  // exactly like one more row made it read as the first item in its own list.
  body: { paddingTop: 10, paddingLeft: 10, gap: 6 }
})
