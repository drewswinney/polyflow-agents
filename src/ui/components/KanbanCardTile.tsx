import { Pressable, StyleSheet, View } from 'react-native'

import type { KanbanCardSummary } from '@/domain'

import { statusTone } from '../kanban'
import { useTheme } from '../ThemeProvider'
import { PREVIEW_HEIGHT } from './ArtifactCards'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * One card, as it appears in a lane and in the transcript.
 *
 * The only difference between the two is `showStatus`: in a lane the column
 * heading already says what state the card is in, and repeating it on every
 * card is noise. Unfurled under a message there is no column, so the status has
 * to travel with the card.
 */
export function KanbanCardTile({
  card,
  onPress,
  showStatus = false
}: {
  card: KanbanCardSummary
  onPress: () => void
  showStatus?: boolean
}) {
  const theme = useTheme()
  const tone = statusTone(theme, card.status)
  const chips = [card.risk ? `risk:${card.risk}` : null, card.branch, card.pr].filter(Boolean) as string[]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        theme.shadow.card,
        {
          borderRadius: theme.radius.card,
          borderColor: theme.color.border,
          backgroundColor: pressed ? theme.color.bgSubtle : theme.color.surface
        }
      ]}
    >
      {showStatus ? (
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: tone.text }]} />
          <Text variant="sectionHeader" color={tone.text}>
            {card.statusLabel}
          </Text>
        </View>
      ) : null}

      <View style={styles.topRow}>
        <Text variant="rowLabelStrong" numberOfLines={3} style={styles.title}>
          {card.title}
        </Text>
        <Icon
          name={card.checked ? 'circle-check' : 'circle'}
          size={12}
          color={card.checked ? theme.color.success700 : theme.color.gray400}
        />
      </View>

      {card.description ? (
        <Text variant="secondary" numberOfLines={3}>
          {card.description}
        </Text>
      ) : null}

      {chips.length > 0 ? (
        <View style={styles.chipRow}>
          {chips.map(chip => (
            <View
              key={chip}
              style={[styles.chip, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border }]}
            >
              <Text variant="monoSmall" color={theme.color.gray600} numberOfLines={1}>
                {chip}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
}

/** A compact card's width: room for three lines of a title at the tile's type size. */
const PREVIEW_WIDTH = 200

/**
 * A card at the size of an artifact tile, for the strip under a message.
 *
 * The same footprint as `ArtifactCards`' tiles — a block `PREVIEW_HEIGHT`
 * tall with a caption and *Open* beneath — so a message that produced a file
 * and named a ticket shows two strips of the same kind of thing. The block
 * holds what a glance wants: the state, the title, the first lines of the
 * description. Everything else is the sheet's, one tap away.
 */
export function KanbanCardPreview({ card, onPress }: { card: KanbanCardSummary; onPress: () => void }) {
  const theme = useTheme()
  const tone = statusTone(theme, card.status)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.title}, ${card.statusLabel}`}
      onPress={onPress}
      style={({ pressed }) => [styles.preview, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.previewBlock,
          theme.shadow.card,
          { borderRadius: theme.radius.control, borderColor: theme.color.border, backgroundColor: theme.color.surface }
        ]}
      >
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: tone.text }]} />
          <Text variant="sectionHeader" color={tone.text} numberOfLines={1} style={styles.title}>
            {card.statusLabel}
          </Text>
          {card.priority != null ? (
            <Text variant="monoSmall" color={theme.color.gray500}>
              {`P${card.priority}`}
            </Text>
          ) : null}
        </View>

        <Text variant="rowLabelStrong" numberOfLines={3}>
          {card.title}
        </Text>

        {card.description ? (
          <Text variant="secondary" numberOfLines={3} style={styles.previewBody}>
            {card.description}
          </Text>
        ) : null}
      </View>

      <Text variant="rowLabel" numberOfLines={1} style={styles.previewName}>
        {card.id}
      </Text>

      <View style={styles.open}>
        <Text variant="pill" color={theme.color.secondaryDeep}>
          Open
        </Text>
        <Icon name="chevron-right" size={9} color={theme.color.secondaryDeep} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  preview: { width: PREVIEW_WIDTH, gap: 4, alignItems: 'flex-start' },
  previewBlock: {
    alignSelf: 'stretch',
    height: PREVIEW_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    overflow: 'hidden'
  },
  previewBody: { flexShrink: 1 },
  previewName: { paddingTop: 2 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  card: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, minWidth: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 1 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%'
  }
})
