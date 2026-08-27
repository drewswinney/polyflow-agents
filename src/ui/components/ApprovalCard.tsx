import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import type { PermissionOutcome, PermissionRequest } from '@/domain'

import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The in-chat approval card (§7.6).
 *
 * **Not a modal.** An approval halts one session — the wait is keyed by session
 * on the host — so trapping the whole app behind it blocks you from every other
 * session for no reason. It sits in the transcript instead: you can scroll,
 * leave, answer another agent, and come back. What makes that safe rather than
 * negligent is the notification path (see `docs/push-relay.md`) and the
 * countdown below — leaving is a choice, not a way to lose the request.
 *
 * The countdown is the honest half of that. An unanswered approval does not wait
 * forever: the host denies it when `approvals.timeout` elapses. A card that sat
 * in a scrollback implying "answer whenever" would be lying, so an expired
 * request stops offering buttons that would only bounce.
 */
export function ApprovalCard({
  request,
  hostName,
  onRespond
}: {
  request: PermissionRequest
  hostName: string
  onRespond: (outcome: PermissionOutcome) => void
}) {
  const theme = useTheme()
  const gradient = useGradient()
  const remaining = useCountdown(request.expiresAt)
  const expired = remaining !== null && remaining <= 0

  const meta = [request.tool, request.sudo ? 'sudo' : null].filter(Boolean).join(' · ')

  return (
    <View
      style={[
        styles.card,
        theme.shadow.card,
        {
          backgroundColor: theme.color.surface,
          borderColor: expired ? theme.color.border : theme.color.warning200,
          borderRadius: theme.radius.card
        }
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.shield,
            { backgroundColor: expired ? theme.color.bgSubtle : theme.color.warning50 }
          ]}
        >
          <Icon
            name="shield-halved"
            size={17}
            color={expired ? theme.color.gray400 : theme.color.warning700}
          />
        </View>
        <View style={styles.headText}>
          <Text variant="rowLabelStrong">{expired ? 'Approval expired' : 'Approve this command?'}</Text>
          <Text variant="monoSmall">{meta}</Text>
        </View>
        {expired ? null : <Deadline remaining={remaining} />}
      </View>

      <Text variant="body">{request.description}</Text>

      <ScrollView
        style={[styles.code, { backgroundColor: theme.color.bgSubtle, borderRadius: theme.radius.control }]}
        contentContainerStyle={styles.codeContent}
      >
        <Text variant="mono" color={theme.color.gray800}>
          {request.command}
        </Text>
      </ScrollView>

      {expired ? (
        <Text variant="secondary" color={theme.color.gray500}>
          {`No answer in time, so ${hostName} denied it. Ask again to run it.`}
        </Text>
      ) : (
        <>
          <Text variant="secondary">{`Runs on ${hostName}.`}</Text>

          <Pressable accessibilityRole="button" onPress={() => onRespond('allow_once')}>
            <LinearGradient
              colors={gradient.colors}
              start={gradient.start}
              end={gradient.end}
              style={[styles.primary, { borderRadius: theme.radius.control }]}
            >
              <Text variant="rowLabelStrong" color={theme.color.onAccent}>
                Allow once
              </Text>
            </LinearGradient>
          </Pressable>

          <View style={styles.secondaryRow}>
            {request.allowPermanent ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onRespond('allow_always')}
                style={[
                  styles.secondaryButton,
                  { borderColor: theme.color.border, borderRadius: theme.radius.control }
                ]}
              >
                <Text variant="rowLabelStrong">Always allow</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => onRespond('deny')}
              style={[
                styles.secondaryButton,
                {
                  backgroundColor: theme.color.error50,
                  borderColor: theme.color.error200,
                  borderRadius: theme.radius.control
                }
              ]}
            >
              <Text variant="rowLabelStrong" color={theme.color.error700}>
                Deny
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  )
}

/**
 * The bar above the composer when the card is scrolled out of view.
 *
 * The counterpart to not being a modal: leaving the card behind must not mean
 * losing track of it. Tapping returns to the card rather than answering here —
 * a one-tap Allow you cannot read the command from is exactly the habit an
 * approval prompt exists to prevent.
 */
export function ApprovalNudge({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Review the pending approval"
      onPress={onPress}
      style={({ pressed }) => [
        styles.nudge,
        {
          backgroundColor: pressed ? theme.color.warning200 : theme.color.warning50,
          borderTopColor: theme.color.warning200
        }
      ]}
    >
      <Icon name="hand" size={13} color={theme.color.warning700} />
      <Text variant="secondary" color={theme.color.warningText} style={styles.nudgeLabel}>
        Waiting on your answer
      </Text>
      <Text variant="secondary" color={theme.color.warning700}>
        Review
      </Text>
    </Pressable>
  )
}

/** `m:ss` left, in mono because it is machine data. Absent when the host never said. */
function Deadline({ remaining }: { remaining: number | null }) {
  const theme = useTheme()

  if (remaining === null) return null

  const seconds = Math.ceil(remaining / 1000)
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <Text variant="monoSmall" color={seconds <= 30 ? theme.color.error700 : theme.color.warning700}>
      {label}
    </Text>
  )
}

/**
 * Milliseconds left, or null when there is no deadline to count.
 *
 * Ticks once a second and only while a deadline is live, so a settled card costs
 * nothing. Recomputed from the timestamp rather than decremented, since an
 * interval that missed frames while the app was backgrounded would otherwise
 * report time that has already passed.
 */
function useCountdown(expiresAt: number | null): number | null {
  const [remaining, setRemaining] = useState(() => (expiresAt === null ? null : expiresAt - Date.now()))

  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(null)

      return
    }

    setRemaining(expiresAt - Date.now())

    const timer = setInterval(() => {
      const left = expiresAt - Date.now()

      setRemaining(left)

      if (left <= 0) clearInterval(timer)
    }, 1000)

    return () => clearInterval(timer)
  }, [expiresAt])

  return remaining
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 11, borderWidth: 1 },
  nudge: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  nudgeLabel: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  shield: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  code: { maxHeight: 140 },
  codeContent: { padding: 12 },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center' },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth
  }
})
