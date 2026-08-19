import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { SessionSummary } from '@/domain'

import { relativeTime } from '../format'
import { useTheme } from '../ThemeProvider'
import { Divider } from './Card'
import { Icon } from './Icon'
import { Text } from './Text'

/** The drawer's destinations, as expo-router's typed routes see them. */
export type SidebarPath = '/' | '/sessions' | '/settings'

const MAX_WIDTH = 320
const WIDTH_FRACTION = 0.84
const SLIDE_MS = 190

/**
 * The slide-out sidebar (§7.17) — the app's primary navigation, in place of the
 * bottom tab bar it replaces.
 *
 * It carries the two things you reach for constantly: starting a session and
 * returning to a recent one. It deliberately does *not* duplicate the Sessions
 * screen — that screen still owns the full list, its recency grouping and
 * search, and is one row away here. A drawer that tries to be the list ends up
 * a worse list.
 *
 * "New session" navigates home rather than creating anything: home *is* the new
 * session, and it holds off creating one until there is a message to send.
 *
 * Mounted once above the router, so the hamburger works from any screen.
 */
export function Sidebar({
  visible,
  sessions,
  loading,
  activePath,
  paired,
  onOpenSession,
  onNavigate,
  onDismiss
}: {
  visible: boolean
  sessions: SessionSummary[]
  loading: boolean
  /** Drives the selected row's tint; the route the drawer is sitting over. */
  activePath: string
  /**
   * Whether an agent is paired at all.
   *
   * Every destination here is scoped to one — a session belongs to an agent,
   * settings are an agent's settings — so with the registry empty they lead
   * nowhere. They go quiet rather than disappearing: the drawer's shape is how
   * you know what the app does, and a removal should read as "nothing to point
   * these at yet", not as features that vanished.
   */
  paired: boolean
  onOpenSession: (id: string) => void
  onNavigate: (path: SidebarPath) => void
  onDismiss: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()

  const width = Math.min(MAX_WIDTH, screenWidth * WIDTH_FRACTION)

  // `visible` flips instantly; `mounted` trails it so the panel can animate out
  // before the Modal is torn down.
  const [mounted, setMounted] = useState(visible)
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current

  useEffect(() => {
    if (visible) setMounted(true)

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      useNativeDriver: true
    })

    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })

    return () => animation.stop()
  }, [visible, progress])

  if (!mounted) return null

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] })
  const recents = sessions.slice(0, 8)

  return (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          theme.shadow.sheet,
          {
            width,
            transform: [{ translateX }],
            backgroundColor: theme.color.surface,
            borderRightColor: theme.color.border,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8
          }
        ]}
      >
        <View style={styles.top}>
          <NavRow
            icon="plus"
            label="New session"
            accent
            disabled={!paired}
            selected={activePath === '/'}
            onPress={() => {
              onDismiss()
              onNavigate('/')
            }}
          />
          <NavRow
            icon="comments"
            label="Sessions"
            disabled={!paired}
            selected={activePath === '/sessions'}
            onPress={() => {
              onDismiss()
              onNavigate('/sessions')
            }}
          />
        </View>

        {!paired ? (
          <Text variant="secondary" style={styles.unpaired}>
            No agent paired. Add one to use any of this.
          </Text>
        ) : null}

        <Divider />

        <ScrollView contentContainerStyle={styles.recents}>
          <Text variant="sectionHeader" style={styles.recentsLabel}>
            Recent
          </Text>

          {!paired || recents.length === 0 ? (
            <Text variant="secondary" style={styles.recentsLabel}>
              {!paired ? '—' : loading ? 'Loading…' : 'No sessions yet.'}
            </Text>
          ) : (
            recents.map(session => (
              <RecentRow
                key={session.id}
                session={session}
                onPress={() => {
                  onDismiss()
                  onOpenSession(session.id)
                }}
              />
            ))
          )}
        </ScrollView>

        <Divider />

        <View style={styles.bottom}>
          <NavRow
            icon="sliders"
            label="Settings"
            disabled={!paired}
            selected={activePath === '/settings'}
            onPress={() => {
              onDismiss()
              onNavigate('/settings')
            }}
          />
        </View>
      </Animated.View>
    </Modal>
  )
}

/** A destination. `accent` marks the one action that creates rather than navigates. */
function NavRow({
  icon,
  label,
  selected,
  accent,
  disabled,
  onPress
}: {
  icon: string
  label: string
  selected?: boolean
  accent?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const theme = useTheme()

  const tint = disabled
    ? theme.color.gray400
    : accent
      ? theme.color.secondary
      : selected
        ? theme.color.secondaryDeep
        : theme.color.gray800

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        {
          borderRadius: theme.radius.row,
          backgroundColor: selected && !disabled
            ? theme.color.secondaryTint
            : pressed
              ? theme.color.bgSubtle
              : 'transparent'
        }
      ]}
    >
      <View style={styles.navIcon}>
        <Icon name={icon} size={15} color={tint} />
      </View>
      <Text variant="rowLabelStrong" numberOfLines={1} color={tint} style={styles.navLabel}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * One line per session — title and age. The full row, with preview, is the
 * Sessions screen's.
 *
 * A session blocked on you is marked here too. In-chat approvals mean a halted
 * session is one you can walk away from (§7.6), so every list that leads back to
 * it has to say which one is waiting.
 */
function RecentRow({ session, onPress }: { session: SessionSummary; onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.recentRow,
        { borderRadius: theme.radius.row, backgroundColor: pressed ? theme.color.bgSubtle : 'transparent' }
      ]}
    >
      {session.blockedOn ? <Icon name="hand" size={11} color={theme.color.warning700} /> : null}

      <Text variant="rowLabel" numberOfLines={1} style={styles.recentTitle}>
        {session.title}
      </Text>

      <Text variant="monoSmall" color={session.blockedOn ? theme.color.warning700 : undefined}>
        {session.blockedOn ? 'waiting' : relativeTime(session.updatedAt)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,17,32,0.32)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth
  },
  top: { padding: 8, gap: 2 },
  bottom: { padding: 8 },
  navRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  navIcon: { width: 20, alignItems: 'center' },
  navLabel: { flex: 1, minWidth: 0 },
  recents: { paddingHorizontal: 8, paddingVertical: 10, gap: 1 },
  unpaired: { paddingHorizontal: 20, paddingTop: 10 },
  recentsLabel: { paddingHorizontal: 10, paddingBottom: 6 },
  recentRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  recentTitle: { flex: 1, minWidth: 0 }
})
