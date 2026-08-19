import { LinearGradient } from 'expo-linear-gradient'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { PermissionOutcome, PermissionRequest } from '@/domain'

import { useGradient, useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The blocking approval sheet (§7.6).
 *
 * On a phone this is the defining interaction: a laptop user is already looking
 * at the screen when the agent halts, and a phone user is not. Three outcomes,
 * the exact command shown verbatim, and a consequence sentence that names the
 * host — never a bare "allow?".
 *
 * No expiry countdown: approval requests carry no TTL in the API (§2.6). If one
 * lands later the countdown is additive.
 */
export function ApprovalSheet({
  request,
  hostName,
  onRespond
}: {
  request: PermissionRequest | null
  hostName: string
  onRespond: (outcome: PermissionOutcome) => void
}) {
  const theme = useTheme()
  const gradient = useGradient()
  const insets = useSafeAreaInsets()

  if (!request) return null

  const meta = [request.tool, request.sudo ? 'sudo' : null].filter(Boolean).join(' · ')

  return (
    <Modal transparent visible animationType="slide" onRequestClose={() => onRespond('deny')}>
      <View style={styles.scrim}>
        <View
          style={[
            styles.sheet,
            theme.shadow.sheet,
            {
              backgroundColor: theme.color.surface,
              borderTopLeftRadius: theme.radius.sheet,
              borderTopRightRadius: theme.radius.sheet,
              paddingBottom: Math.max(insets.bottom, 16) + 8
            }
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.color.border }]} />

          <View style={styles.head}>
            <View style={[styles.shield, { backgroundColor: theme.color.secondaryTint }]}>
              <Icon name="shield-halved" size={17} color={theme.color.secondary} />
            </View>
            <View style={styles.headText}>
              <Text variant="sheetTitle">Approve this command?</Text>
              <Text variant="monoSmall">{meta}</Text>
            </View>
          </View>

          <Text variant="body">{request.description}</Text>

          <ScrollView
            style={[styles.code, { backgroundColor: theme.color.bgSubtle, borderRadius: theme.radius.control }]}
            contentContainerStyle={styles.codeContent}
            horizontal={false}
          >
            <Text variant="mono" color={theme.color.gray800}>
              {request.command}
            </Text>
          </ScrollView>

          <Text variant="secondary">{`Runs on ${hostName}.`}</Text>

          <Pressable accessibilityRole="button" onPress={() => onRespond('allow_once')}>
            <LinearGradient
              colors={gradient.colors}
              start={gradient.start}
              end={gradient.end}
              style={[styles.primary, { borderRadius: theme.radius.control }]}
            >
              <Text variant="rowLabelStrong" color="#ffffff">
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
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,17,32,0.5)' },
  sheet: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  shield: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 2 },
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
