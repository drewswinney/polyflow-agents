import {
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
import { AgentSelector } from './AgentSelector'
import { Divider } from './Card'
import { Icon } from './Icon'
import { Text } from './Text'

/** The drawer's destinations, as expo-router's typed routes see them. */
export type SidebarPath = '/' | '/sessions' | '/artifacts' | '/boards' | '/settings'

const MAX_WIDTH = 320
const WIDTH_FRACTION = 0.84

/**
 * How wide the drawer is, and therefore how far the page slides off it.
 *
 * Shared with the shell that does the sliding: the page has to come to rest on
 * the panel's edge, so one of them owning the number and the other guessing it
 * is a gap that only shows up on some screen sizes.
 */
export function useSidebarWidth(): number {
  const { width } = useWindowDimensions()

  return Math.min(MAX_WIDTH, width * WIDTH_FRACTION)
}

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
 * Mounted once *below* the router by `SidebarShell`, which slides the page off
 * it — so there is no `visible` here. It is on screen the whole time; whether
 * you can see it is a question about where the page is.
 */
export function Sidebar({
  sessions,
  loading,
  activePath,
  paired,
  supportsArtifacts,
  supportsBoards,
  onOpenSession,
  onNavigate,
  onDismiss
}: {
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
  /** Whether the host keeps artifacts (`docs/artifacts.md`); the row is absent, not disabled, without it. */
  supportsArtifacts: boolean
  supportsBoards: boolean
  onOpenSession: (id: string) => void
  onNavigate: (path: SidebarPath) => void
  onDismiss: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const width = useSidebarWidth()

  const recents = sessions.slice(0, 8)

  return (
    <View
      style={[
        styles.panel,
        {
          width,
          backgroundColor: theme.color.surface,
          borderRightColor: theme.color.border,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 8
        }
      ]}
    >
        {/* The switcher heads the sidebar because that is what the sidebar is:
            where you go to change what the app is pointed at. Renders nothing
            before an agent exists, which is the same state that disables the
            rows under it. */}
        <View style={styles.agent}>
          <AgentSelector />
        </View>

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
          {supportsArtifacts ? (
            <NavRow
              icon="box-archive"
              label="Artifacts"
              disabled={!paired}
              selected={activePath === '/artifacts' || activePath.startsWith('/artifacts/')}
              onPress={() => {
                onDismiss()
                onNavigate('/artifacts')
              }}
            />
          ) : null}
          {supportsBoards ? (
            <NavRow
              icon="table-columns"
              label="Boards"
              disabled={!paired}
              selected={activePath === '/boards'}
              onPress={() => {
                onDismiss()
                onNavigate('/boards')
              }}
            />
          ) : null}
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
    </View>
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
  // Weighted upward: the pill wants air between it and the status bar, and
  // sits closer to the rows below because those are what it scopes.
  agent: { alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  // No absolute positioning: the shell puts it behind the page and the page
  // slides off it. It is a floor the page is lifted from, not a panel over it.
  panel: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth },
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
