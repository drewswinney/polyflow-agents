import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

import { SETUP_STEPS, type SetupStep, setupStepIndex } from '../setup'
import { useGradient, useTheme } from '../ThemeProvider'
import { Text } from './Text'

/**
 * Where you are in setup, as three dots (`docs/architecture.md` §7.8).
 *
 * Dots rather than "Step 2 of 3": the pages are short enough that the number
 * would be the longest thing on some of them, and the dots say the same at a
 * glance — how far, how much left — without a sentence.
 */
export function SetupSteps({ step }: { step: SetupStep }) {
  const theme = useTheme()
  const current = setupStepIndex(step)

  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${SETUP_STEPS.length}`}>
      {SETUP_STEPS.map((name, index) => (
        <View
          key={name}
          style={[
            styles.dot,
            index === current && styles.dotCurrent,
            { backgroundColor: index <= current ? theme.color.primary : theme.color.border }
          ]}
        />
      ))}
    </View>
  )
}

/**
 * The one button a setup page ends with: the accent gradient when it can be
 * pressed, flat and grey when it cannot, a spinner while it works.
 */
export function SetupButton({
  label,
  onPress,
  disabled = false,
  busy = false
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
}) {
  const theme = useTheme()
  const gradient = useGradient()
  const ready = !disabled && !busy

  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={onPress}>
      <LinearGradient
        colors={ready ? gradient.colors : [theme.color.bgSubtle, theme.color.bgSubtle]}
        start={gradient.start}
        end={gradient.end}
        style={[styles.primary, { borderRadius: theme.radius.control }]}
      >
        {busy ? (
          <ActivityIndicator color={theme.color.onAccent} />
        ) : (
          <Text variant="rowLabelStrong" color={ready ? theme.color.onAccent : theme.color.gray400}>
            {label}
          </Text>
        )}
      </LinearGradient>
    </Pressable>
  )
}

/** A quieter second action under the primary: "Skip for now", "Add another". */
export function SetupLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text variant="rowLabelStrong" color={theme.color.secondaryDeep}>
        {label}
      </Text>
    </Pressable>
  )
}

/** The bottom of every setup page: the steps, the button, and whatever sits under it. */
export function SetupFooter({ step, children, bottomInset }: { step: SetupStep; children: ReactNode; bottomInset: number }) {
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, 12) + 12 }]}>
      <SetupSteps step={step} />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotCurrent: { width: 20 },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center' },
  link: { height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 24, paddingTop: 8, gap: 10 }
})
