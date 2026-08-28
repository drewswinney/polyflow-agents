import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'

import type { KanbanCardSummary } from '@/domain'

import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Card } from './Card'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { Text } from './Text'

/**
 * The whole ticket, from either place it can be opened: its lane on the Boards
 * screen, or a mention in the transcript.
 */
export function KanbanCardDetail({ card, onDismiss }: { card: KanbanCardSummary | null; onDismiss: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [copied, setCopied] = useState(false)
  // The sheet can swap cards while open; a check from the previous copy must
  // not hang off the new card's ID.
  useEffect(() => {
    setCopied(false)
  }, [card?.id])

  if (!card) return null

  const details = [
    ['Status', card.statusLabel],
    ['Risk', card.risk],
    ['Branch', card.branch],
    ['PR', card.pr]
  ].filter(([, value]) => Boolean(value))

  // Same pattern as the transcript's copy buttons: write, flip to a check for
  // two seconds, and let the next tap start fresh.
  const copyId = async () => {
    await Clipboard.setStringAsync(card.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
            {/* The ticket id, copyable: it is the handle for this card in chat,
                PRs, and the `hermes kanban` CLI, and nowhere else in the app
                it was previously surfaced. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied ticket id' : `Copy ticket id ${card.id}`}
              onPress={() => void copyId()}
              hitSlop={8}
              style={[
                styles.idPill,
                { borderColor: copied ? theme.color.primary : theme.color.border, backgroundColor: theme.color.bgSubtle }
              ]}
            >
              <Text variant="sectionHeader">ID</Text>
              <Text variant="monoSmall" numberOfLines={1} style={styles.idValue}>
                {card.id}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? theme.color.primary : theme.color.gray400} />
            </Pressable>

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
  idPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  idValue: { flex: 1 },
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
