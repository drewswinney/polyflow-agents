import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { KanbanCardSummary } from '@/domain'

import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Card } from './Card'
import { IconButton } from './IconButton'
import { Text } from './Text'

/**
 * The whole ticket, from either place it can be opened: its lane on the Boards
 * screen, or a mention in the transcript.
 */
export function KanbanCardDetail({ card, onDismiss }: { card: KanbanCardSummary | null; onDismiss: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  if (!card) return null

  const details = [
    ['Status', card.statusLabel],
    ['Assignee', card.assignee],
    ['Risk', card.risk],
    ['Branch', card.branch],
    ['PR', card.pr]
  ].filter(([, value]) => Boolean(value))

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View
        style={[
          styles.root,
          { backgroundColor: theme.color.scrim, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close card details" />
        <Card style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text variant="sectionHeader">{card.statusLabel}</Text>
              <Text variant="sheetTitle">{card.title}</Text>
            </View>
            <IconButton name="xmark" accessibilityLabel="Close card details" onPress={onDismiss} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {details.length > 0 ? (
              <View style={styles.detailGrid}>
                {details.map(([label, value]) => (
                  <View
                    key={label}
                    style={[styles.detailPill, { borderColor: theme.color.border, backgroundColor: theme.color.bgSubtle }]}
                  >
                    <Text variant="sectionHeader">{label}</Text>
                    <Text variant="secondary" numberOfLines={1}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* The ticket body is markdown on disk, so it renders as markdown
                here — same component the transcript uses, so a heading, a
                checklist and a fenced block land in the app's type scale
                rather than arriving as one wall of escaped text. The
                description is the body's first prose line, so showing both
                would just repeat it. */}
            {card.body ? (
              <Markdown source={card.body} />
            ) : card.description ? (
              <Text variant="body">{card.description}</Text>
            ) : (
              <Text variant="secondary">No ticket file for this card.</Text>
            )}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: { maxHeight: '82%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  titleWrap: { flex: 1, minWidth: 0, gap: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailPill: {
    minWidth: '46%',
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  }
})
