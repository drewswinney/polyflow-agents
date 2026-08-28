import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text as RNText, View } from 'react-native'

import type { KanbanCardSummary } from '@/domain'
import { useSelectedAgent } from '@/state/agents'
import { useBackend } from '@/state/ConnectionProvider'
import { useKanbanCardIndex } from '@/state/boards'

import { statusTone } from '../kanban'
import { MentionProvider } from '../markdown/MentionContext'
import { collectMentions, type Mention } from '../markdown/mentions'
import { useTheme } from '../ThemeProvider'
import { KanbanCardDetail } from './KanbanCardDetail'
import { KanbanCardTile } from './KanbanCardTile'

/**
 * More than three cards under one message stops being context and starts being
 * the Boards screen, badly. The chips in the prose still name every ticket.
 */
const MAX_UNFURLS = 3

interface KanbanMentions {
  cards: Map<string, KanbanCardSummary>
  open: (card: KanbanCardSummary) => void
  /** Called by a mounted chip or unfurl: the board is worth fetching now. */
  demand: () => void
}

const KanbanMentionContext = createContext<KanbanMentions | null>(null)

/**
 * Turns `[[wiki-link]]`s in the transcript into the cards they point at.
 *
 * Wraps the Chat screen, so three things are true at once: the markdown
 * renderer can draw a mention without knowing what a board is, every mention in
 * the session resolves against one shared copy of the board, and the detail
 * modal is mounted once above the list rather than once per message.
 *
 * The board is not fetched until something actually mentions a card. Most
 * sessions never do, and a session on a host without the plugin never can —
 * `useKanbanCardIndex` is gated on the capability as well.
 */
export function KanbanMentionProvider({ children }: { children: ReactNode }) {
  const agent = useSelectedAgent()
  const backend = useBackend()
  const [wanted, setWanted] = useState(false)
  const [selected, setSelected] = useState<KanbanCardSummary | null>(null)
  const cards = useKanbanCardIndex(agent.scope ?? '', backend, wanted)

  const demand = useCallback(() => setWanted(true), [])
  const open = useCallback((card: KanbanCardSummary) => setSelected(card), [])

  const value = useMemo<KanbanMentions>(() => ({ cards, open, demand }), [cards, open, demand])
  const render = useCallback(
    (mention: Mention, key: string) => <KanbanMentionChip key={key} mention={mention} />,
    []
  )

  return (
    <KanbanMentionContext.Provider value={value}>
      <MentionProvider render={render}>
        {children}
        <KanbanCardDetail card={selected} onDismiss={() => setSelected(null)} />
      </MentionProvider>
    </KanbanMentionContext.Provider>
  )
}

/**
 * A mention inside a sentence.
 *
 * Styled text rather than a bordered pill on purpose: it sits in the middle of
 * a paragraph, and a box with its own padding and corner radius breaks the line
 * rhythm around it — the status colour is enough to mark it as a thing you can
 * touch. Before the board arrives, and for a ticket that is not on it, the
 * mention reads as its own text and does nothing, which is what it did before
 * any of this existed.
 */
function KanbanMentionChip({ mention }: { mention: Mention }) {
  const theme = useTheme()
  const context = useContext(KanbanMentionContext)
  const demand = context?.demand

  useEffect(() => {
    demand?.()
  }, [demand])

  const card = context?.cards.get(mention.slug)
  const label = mention.label ?? card?.title ?? mention.slug

  if (!card) return <RNText>{label}</RNText>

  const tone = statusTone(theme, card.status)

  return (
    <RNText
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.title}, ${card.statusLabel}`}
      style={{ fontFamily: theme.font.bodyMedium, color: tone.text, backgroundColor: tone.bg }}
      onPress={() => context?.open(card)}
    >
      {` ${label} `}
    </RNText>
  )
}

/**
 * The cards a message named, unfurled beneath it.
 *
 * A link preview, in effect: the chip keeps the sentence readable and this
 * answers the question the sentence raises — what state is it in, which branch,
 * which PR — without a tap. Renders nothing at all when the message names no
 * card, when the board has not arrived, or outside a `KanbanMentionProvider`.
 */
export function KanbanUnfurls({ text }: { text: string }) {
  const context = useContext(KanbanMentionContext)
  const demand = context?.demand
  const mentions = useMemo(() => collectMentions(text), [text])

  useEffect(() => {
    if (mentions.length) demand?.()
  }, [mentions, demand])

  const cards = useMemo(
    () =>
      mentions
        .map(mention => context?.cards.get(mention.slug))
        .filter((card): card is KanbanCardSummary => Boolean(card))
        .slice(0, MAX_UNFURLS),
    [mentions, context]
  )

  if (!context || cards.length === 0) return null

  return (
    <View style={styles.unfurls}>
      {cards.map(card => (
        <KanbanCardTile key={card.id} card={card} onPress={() => context.open(card)} showStatus />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  unfurls: { gap: 8, marginTop: 8 }
})
