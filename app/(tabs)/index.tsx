import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { SessionSummary } from '@/domain'
import { useActiveConnection } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent } from '@/state/agents'
import { sessionsKey, useSessions, useSessionSearch } from '@/state/queries'
import { AgentPill } from '@/ui/components/AgentPill'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { BlockedStrip } from '@/ui/components/BlockedStrip'
import { Card, Divider } from '@/ui/components/Card'
import { ConnectionBanner } from '@/ui/components/ConnectionBanner'
import { AgentGlyph, Icon } from '@/ui/components/Icon'
import { IconButton } from '@/ui/components/IconButton'
import { SessionRow } from '@/ui/components/SessionRow'
import { Text } from '@/ui/components/Text'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { relativeTime, recencyGroup } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Sessions (§7.1) — the app's home.
 *
 * Search expands in place in the header rather than pushing a route or opening
 * a modal (§7.7), so cancelling always returns you exactly where you were.
 */
export default function SessionsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const agents = useAgents(state => state.agents)
  const select = useAgents(state => state.select)
  const { backend, state, attempt } = useActiveConnection()
  const queryClient = useQueryClient()

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')

  const sessions = useSessions(agent.id, backend)
  const search = useSessionSearch(agent.id, backend, query)

  const groups = useMemo(() => groupSessions(sessions.data ?? []), [sessions.data])

  const openSession = (id: string) => router.push(`/chat/${id}`)

  const createSession = async () => {
    if (!backend) return

    const id = await backend.createSession({ title: 'New session' })
    await queryClient.invalidateQueries({ queryKey: sessionsKey(agent.id) })
    openSession(id)
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      {searchActive ? (
        <SearchHeader
          agentName={agent.displayName}
          agentIcon={agent.icon}
          query={query}
          onChange={setQuery}
          onCancel={() => {
            setSearchActive(false)
            setQuery('')
          }}
        />
      ) : (
        <ScreenHeader
          title="Sessions"
          center={<AgentPill agent={agent} open={switcherOpen} onPress={() => setSwitcherOpen(true)} />}
          right={
            <IconButton
              name="magnifying-glass"
              accessibilityLabel="Search sessions"
              edge="right"
              onPress={() => setSearchActive(true)}
            />
          }
        />
      )}

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={sessions.isFetching} onRefresh={() => void sessions.refetch()} />}
      >
        <ConnectionBanner state={state} attempt={attempt} />

        {searchActive ? (
          <SearchResults
            query={query}
            agentName={agent.displayName}
            hits={search.data ?? []}
            loading={search.isFetching}
            sessions={sessions.data ?? []}
            onOpen={openSession}
          />
        ) : (
          <>
            <NewSessionButton onPress={() => void createSession()} />

            {sessions.isLoading ? (
              <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
            ) : sessions.error ? (
              <Card style={styles.messageCard}>
                <Text variant="rowLabelStrong">Could not reach {agent.displayName}</Text>
                <Text variant="secondary">{String((sessions.error as Error).message)}</Text>
              </Card>
            ) : groups.length === 0 ? (
              <EmptyState agentName={agent.displayName} agentIcon={agent.icon} />
            ) : (
              groups.map(group => (
                <View key={group.label} style={styles.group}>
                  <Text variant="sectionHeader" style={styles.groupLabel}>
                    {group.label}
                  </Text>
                  <Card>
                    {group.sessions.map((session, index) => (
                      <View key={session.id}>
                        {index > 0 ? <Divider /> : null}
                        {session.blockedOn ? <BlockedStrip /> : null}
                        <SessionRow session={session} onPress={() => openSession(session.id)} />
                      </View>
                    ))}
                  </Card>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      <AgentSwitcher
        agents={agents}
        selectedId={agent.id}
        visible={switcherOpen}
        onSelect={select}
        onAddAgent={() => router.push('/agents/new')}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </View>
  )
}

/** Dashed outline, not the gradient: that is reserved for send and user bubbles. */
function NewSessionButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.newSession,
        { borderColor: theme.color.secondaryMuted, borderRadius: theme.radius.control }
      ]}
    >
      <Icon name="plus" size={13} color={theme.color.secondaryDeep} />
      <Text variant="rowLabelStrong" color={theme.color.secondaryDeep}>
        New session
      </Text>
    </Pressable>
  )
}

function SearchHeader({
  agentName,
  agentIcon,
  query,
  onChange,
  onCancel
}: {
  agentName: string
  agentIcon: Parameters<typeof AgentGlyph>[0]['name']
  query: string
  onChange: (value: string) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.searchHeader,
        {
          // Search expands in place, so this must match ScreenHeader's top pad
          // exactly — a different value would visibly jolt the screen on open.
          paddingTop: insets.top + theme.space.headerTop,
          paddingBottom: theme.space.headerBottom,
          backgroundColor: theme.color.surface,
          borderBottomColor: theme.color.border
        }
      ]}
    >
      <View style={styles.scopeRow}>
        <AgentGlyph name={agentIcon} size={10} />
        <Text variant="sectionHeader">{`Searching ${agentName}`}</Text>
      </View>

      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            {
              backgroundColor: theme.color.bgSubtle,
              borderColor: theme.color.secondaryMuted,
              borderRadius: theme.radius.control
            }
          ]}
        >
          <Icon name="magnifying-glass" size={14} color={theme.color.secondary} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={onChange}
            placeholder="Search this agent"
            placeholderTextColor={theme.color.gray400}
            style={[styles.searchInput, { color: theme.color.gray800, fontFamily: theme.font.body }]}
          />
          {query ? (
            <IconButton
              name="xmark"
              accessibilityLabel="Clear search"
              size={13}
              slot={36}
              color={theme.color.gray400}
              onPress={() => onChange('')}
            />
          ) : null}
        </View>

        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text variant="rowLabelStrong" color={theme.color.primary}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function SearchResults({
  query,
  agentName,
  hits,
  loading,
  sessions,
  onOpen
}: {
  query: string
  agentName: string
  hits: Array<{ sessionId: string; title: string; snippet: string; matchStart: number; matchEnd: number; updatedAt: number }>
  loading: boolean
  sessions: SessionSummary[]
  onOpen: (id: string) => void
}) {
  const theme = useTheme()

  if (query.trim().length < 2) {
    return (
      <Card style={styles.messageCard}>
        <Text variant="secondary">{`Type to search every session on ${agentName}.`}</Text>
      </Card>
    )
  }

  return (
    <View style={styles.group}>
      <Text variant="secondary" style={styles.groupLabel}>
        {loading ? 'Searching…' : `${hits.length} match${hits.length === 1 ? '' : 'es'} in ${agentName} · all time`}
      </Text>

      {hits.length > 0 ? (
        <Card>
          {hits.map((hit, index) => (
            <View key={`${hit.sessionId}-${index}`}>
              {index > 0 ? <Divider /> : null}
              <Pressable accessibilityRole="button" onPress={() => onOpen(hit.sessionId)} style={styles.hitRow}>
                <View style={styles.hitHead}>
                  <Text variant="rowLabelStrong" numberOfLines={1} style={styles.hitTitle}>
                    {hit.title || sessions.find(session => session.id === hit.sessionId)?.title || 'Session'}
                  </Text>
                  <Text variant="monoSmall">{relativeTime(hit.updatedAt)}</Text>
                </View>
                <Text variant="secondary" numberOfLines={2}>
                  {hit.snippet.slice(0, hit.matchStart)}
                  <Text variant="secondary" style={{ backgroundColor: theme.color.highlight }}>
                    {hit.snippet.slice(hit.matchStart, hit.matchEnd)}
                  </Text>
                  {hit.snippet.slice(hit.matchEnd)}
                </Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      <Text variant="sectionHeader" style={styles.groupLabel}>
        All sessions
      </Text>
      <Card>
        {sessions.map((session, index) => (
          <View key={session.id}>
            {index > 0 ? <Divider /> : null}
            <SessionRow session={session} onPress={() => onOpen(session.id)} />
          </View>
        ))}
      </Card>
    </View>
  )
}

/** A freshly paired agent gets starter prompts, not a bare "no sessions" (§7.1). */
function EmptyState({ agentName, agentIcon }: { agentName: string; agentIcon: Parameters<typeof AgentGlyph>[0]['name'] }) {
  const theme = useTheme()

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyRing, { borderColor: theme.color.secondaryMuted }]}>
        <AgentGlyph name={agentIcon} size={34} color="#a78bfa" />
      </View>
      <Text variant="sheetTitle">{`${agentName} is paired and idle`}</Text>
      <Text variant="secondary" style={styles.emptyBody}>
        Nothing has run here yet. Start a session and it will show up in this list.
      </Text>
    </View>
  )
}

function groupSessions(sessions: SessionSummary[]): Array<{ label: string; sessions: SessionSummary[] }> {
  if (sessions.length === 0) return []

  const pinned = sessions.filter(session => session.pinned)
  const rest = sessions.filter(session => !session.pinned)
  const groups: Array<{ label: string; sessions: SessionSummary[] }> = []

  if (pinned.length) groups.push({ label: 'Pinned', sessions: pinned })

  for (const label of ['Today', 'Earlier'] as const) {
    const bucket = rest.filter(session => recencyGroup(session.updatedAt) === label)

    if (bucket.length) groups.push({ label, sessions: bucket })
  }

  return groups
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  loading: { marginTop: 24 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  messageCard: { padding: 14, gap: 4 },
  newSession: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed'
  },
  searchHeader: { paddingHorizontal: 20, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  scopeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchField: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15 },
  hitRow: { paddingHorizontal: 13, paddingVertical: 12, gap: 4 },
  hitHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hitTitle: { flex: 1, minWidth: 0 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  emptyRing: {
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6
  },
  emptyBody: { maxWidth: 264, textAlign: 'center' }
})
