import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { ClarifyRequest } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The agent's question, in the transcript (§7.2).
 *
 * Everything under this was already built — the event maps, the stream holds
 * the request, `respondToClarify` answers it — and nothing rendered it. So a
 * question arrived, the turn halted waiting on it, and the app showed a session
 * doing nothing with no way to reply. It is the same shape as the approval card
 * deliberately: both are the agent stopped, waiting on you.
 *
 * Choices are buttons rather than a picker. The agent offers a small set and
 * the answer is one tap; a select-then-confirm dance would add a step to the
 * common case to serve the rare multi-select one.
 */
export function ClarifyCard({
  request,
  onRespond
}: {
  request: ClarifyRequest
  onRespond: (answer: string) => void
}) {
  const theme = useTheme()
  const [picked, setPicked] = useState<string[]>([])

  const toggle = (choice: string) => {
    if (!request.multiSelect) {
      onRespond(choice)

      return
    }

    setPicked(current =>
      current.includes(choice) ? current.filter(value => value !== choice) : [...current, choice]
    )
  }

  return (
    <View
      style={[
        styles.card,
        theme.shadow.card,
        {
          backgroundColor: theme.color.surface,
          borderColor: theme.color.secondaryMuted,
          borderRadius: theme.radius.card
        }
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.glyph, { backgroundColor: theme.color.secondaryTint }]}>
          <Icon name="circle-question" size={17} color={theme.color.secondary} />
        </View>
        <Text variant="rowLabelStrong" style={styles.headText}>
          {request.multiSelect ? 'Pick any that apply' : 'The agent has a question'}
        </Text>
      </View>

      <Text variant="body">{request.question}</Text>

      {request.choices.length === 0 ? (
        // A question with no choices wants prose, and the composer is already
        // the place you write prose. Saying so beats a second text field that
        // behaves subtly differently from the one below it.
        <Text variant="secondary" color={theme.color.gray500}>
          Answer in the composer below.
        </Text>
      ) : (
        <View style={styles.choices}>
          {request.choices.map(choice => {
            const selected = picked.includes(choice)

            return (
              <Pressable
                key={choice}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => toggle(choice)}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    borderRadius: theme.radius.control,
                    borderColor: selected ? theme.color.secondary : theme.color.border,
                    backgroundColor: selected
                      ? theme.color.secondaryTint
                      : pressed
                        ? theme.color.bgSubtle
                        : 'transparent'
                  }
                ]}
              >
                <Text variant="rowLabel" color={selected ? theme.color.secondaryDeep : theme.color.gray800}>
                  {choice}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {request.multiSelect && request.choices.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          disabled={picked.length === 0}
          onPress={() => onRespond(picked.join(', '))}
          style={[
            styles.confirm,
            {
              borderRadius: theme.radius.control,
              borderColor: theme.color.secondaryMuted,
              opacity: picked.length === 0 ? 0.4 : 1
            }
          ]}
        >
          <Text variant="rowLabelStrong" color={theme.color.secondaryDeep}>
            {picked.length === 0 ? 'Select an answer' : `Send ${picked.length} selected`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 11, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  glyph: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0 },
  choices: { gap: 8 },
  choice: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth
  },
  confirm: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1 }
})
