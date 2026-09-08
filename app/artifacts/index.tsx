import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Artifact } from '@/domain'
import { useBackend, useConnectionFault, useConnectionState } from '@/state/ConnectionProvider'
import { useAgentScopedRoute } from '@/state/agent-scope'
import { useSelectedAgent } from '@/state/agents'
import { artifactsNotInstalled, useArtifacts } from '@/state/artifacts'
import { useSessions } from '@/state/queries'
import { useSidebar } from '@/state/sidebar'
import { withAgent } from '@/ui/components/AgentGate'
import { ArtifactPreview } from '@/ui/components/ArtifactPreview'
import { Card, Divider } from '@/ui/components/Card'
import { opensInSheet, PreviewSheet } from '@/ui/components/PreviewSheet'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import {
  ARTIFACT_FILTERS,
  type ArtifactFilter,
  describeOrigin,
  formatBytes,
  groupArtifactsByDay,
  matchesArtifactFilter
} from '@/ui/artifacts'
import { relativeTime } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/** Between tiles in the picture grid, and between the grid and the screen edge. */
const GRID_GAP = 8
const GRID_COLUMNS = 3
const SCREEN_PAD = 16

/**
 * Artifacts (`docs/artifacts.md` §6) — what the agent produced, and what was sent to it.
 *
 * Top-level from the sidebar, or scoped to one conversation from a chat's
 * header (`?session=`). Pictures are tiles, everything else is a row, and both
 * are grouped by the day they last changed — a file the agent keeps rewriting
 * surfaces where its latest version belongs.
 */
function ArtifactsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const connection = useConnectionState()
  const fault = useConnectionFault()
  const openSidebar = useSidebar(store => store.show)
  const { session } = useLocalSearchParams<{ session?: string }>()
  const scope = agent.scope ?? ''

  // Scoped to a session, this screen holds an id that only resolves against
  // the agent it was opened for; unscoped, the list is simply re-read. Either
  // way a switch means leaving.
  const stale = useAgentScopedRoute()

  const [filter, setFilter] = useState<ArtifactFilter>('all')
  /** The HTML artifact being previewed as a page, if any. */
  const [preview, setPreview] = useState<Artifact | null>(null)

  const artifacts = useArtifacts(scope, stale ? null : backend, session ? { sessionId: session } : {})
  const sessions = useSessions(scope, session ? backend : null)
  const sessionTitle = session ? sessions.data?.find(row => row.id === session)?.title : undefined

  const groups = useMemo(
    () => groupArtifactsByDay((artifacts.data?.artifacts ?? []).filter(artifact => matchesArtifactFilter(artifact, filter))),
    [artifacts.data, filter]
  )

  const notInstalled = artifacts.error ? artifactsNotInstalled(artifacts.error) : false
  const loadError = artifacts.error
    ? String((artifacts.error as Error).message)
    : !backend && connection === 'error'
      ? (fault.error ?? 'Not connected.')
      : null

  // Cast like `/theme` in Settings: the generated route table lags a new screen.
  // HTML opens as a rendered page in a sheet; everything else keeps the detail screen.
  const open = (artifact: Artifact) => {
    if (opensInSheet(artifact)) setPreview(artifact)
    else router.push(`/artifacts/${artifact.id}` as never)
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      {/* No subtitle: the floating header's inset is one row tall, and a
          second line there lands on the filter chips. The session's name
          goes in the body instead, where it scrolls with everything else. */}
      <ScreenHeader
        title={session ? 'Session artifacts' : 'Artifacts'}
        {...(session ? { onBack: () => router.back() } : { onMenu: openSidebar })}
      />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: headerInset, paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={artifacts.isFetching} onRefresh={() => void artifacts.refetch()} />}
      >
        {sessionTitle ? (
          <Text variant="secondary" numberOfLines={1} style={styles.scopeLabel}>
            {sessionTitle}
          </Text>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {ARTIFACT_FILTERS.map(option => {
            const selected = option.key === filter

            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(option.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.color.secondaryTint : theme.color.surface,
                    borderColor: selected ? theme.color.secondaryMuted : theme.color.border,
                    borderRadius: theme.radius.pill
                  }
                ]}
              >
                <Text variant="pill" color={selected ? theme.color.secondaryDeep : theme.color.gray600}>
                  {option.label}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {artifacts.data ? (
          groups.length === 0 ? (
            <EmptyState scoped={Boolean(session)} filtered={filter !== 'all'} agentName={agent.displayName} />
          ) : (
            groups.map(group => (
              <View key={group.label} style={styles.group}>
                <Text variant="sectionHeader" style={styles.groupLabel}>
                  {group.label}
                </Text>
                <DayGroup artifacts={group.artifacts} onOpen={open} />
              </View>
            ))
          )
        ) : notInstalled ? (
          <Card style={styles.messageCard}>
            <Text variant="rowLabelStrong">Artifacts are not set up on this host</Text>
            <Text variant="secondary">
              {`${agent.displayName}'s host has no artifact store. Install the polyflow_agents_push plugin there and restart hermes serve — the same plugin that delivers notifications.`}
            </Text>
          </Card>
        ) : loadError ? (
          <Card style={styles.messageCard}>
            <Text variant="rowLabelStrong">Could not reach {agent.displayName}</Text>
            <Text variant="secondary">{loadError}</Text>
          </Card>
        ) : (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        )}
      </ScrollView>

      <PreviewSheet visible={preview !== null} backend={backend} artifact={preview} onClose={() => setPreview(null)} />
    </View>
  )
}

/**
 * One day's artifacts: the pictures as a grid, the rest as rows in a card.
 *
 * Pictures first because they are what a glance is for; the rows under them
 * carry the names a glance cannot read off a thumbnail.
 */
function DayGroup({ artifacts, onOpen }: { artifacts: Artifact[]; onOpen: (artifact: Artifact) => void }) {
  const pictures = artifacts.filter(artifact => artifact.kind === 'image')
  const files = artifacts.filter(artifact => artifact.kind !== 'image')

  return (
    <View style={styles.dayGroup}>
      {pictures.length ? <PictureGrid artifacts={pictures} onOpen={onOpen} /> : null}

      {files.length ? (
        <Card>
          {files.map((artifact, index) => (
            <View key={artifact.id}>
              {index > 0 ? <Divider /> : null}
              <ArtifactRow artifact={artifact} onPress={() => onOpen(artifact)} />
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  )
}

function PictureGrid({ artifacts, onOpen }: { artifacts: Artifact[]; onOpen: (artifact: Artifact) => void }) {
  const { width } = useWindowDimensions()
  const tile = Math.floor((width - SCREEN_PAD * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)

  return (
    <View style={styles.grid}>
      {artifacts.map(artifact => (
        <PictureTile key={artifact.id} artifact={artifact} size={tile} onPress={() => onOpen(artifact)} />
      ))}
    </View>
  )
}

/**
 * A picture in the grid: the host's thumbnail, or the picture itself when the
 * host had none. The tile is laid out before the bytes arrive — a tinted
 * square with the glyph — so a grid of twelve lays out once rather than
 * shuffling as each download lands.
 */
function PictureTile({ artifact, size, onPress }: { artifact: Artifact; size: number; onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={artifact.name} onPress={onPress}>
      <ArtifactPreview artifact={artifact} mode="cover" width={size} height={size} />

      {artifact.origin === 'upload' ? (
        <View style={[styles.tileBadge, { backgroundColor: theme.color.scrim }]}>
          <Icon name="arrow-up" size={9} color={theme.color.onAccent} />
        </View>
      ) : null}
    </Pressable>
  )
}

/** A non-picture: glyph tile, name, provenance, size and age. */
function ArtifactRow({ artifact, onPress }: { artifact: Artifact; onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.color.bgSubtle }]}
    >
      {/* The page itself when the host rendered one; the kind's glyph when not. */}
      <ArtifactPreview artifact={artifact} mode="cover" width={40} height={40} radius={8} />

      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          <Text variant="rowLabelStrong" numberOfLines={1} style={styles.rowName}>
            {artifact.name}
          </Text>
          <Text variant="monoSmall">{relativeTime(artifact.updatedAt)}</Text>
        </View>
        <Text variant="secondary" numberOfLines={1}>
          {`${describeOrigin(artifact)} · ${formatBytes(artifact.size)}${artifact.version > 1 ? ` · v${artifact.version}` : ''}${artifact.share ? ' · shared' : ''}`}
        </Text>
      </View>
    </Pressable>
  )
}

function EmptyState({ scoped, filtered, agentName }: { scoped: boolean; filtered: boolean; agentName: string }) {
  const theme = useTheme()

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyRing, { borderColor: theme.color.secondaryMuted }]}>
        <Icon name="box-archive" size={30} color={theme.color.secondaryMuted} />
      </View>
      <Text variant="sheetTitle">{filtered ? 'Nothing matches' : 'Nothing here yet'}</Text>
      <Text variant="secondary" style={styles.emptyBody}>
        {filtered
          ? 'No artifacts of that kind. Try another filter.'
          : scoped
            ? 'This conversation has not produced a file, and no picture has been sent to it.'
            : `Files ${agentName} writes or generates, and pictures you send it, will show up here.`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: SCREEN_PAD, paddingTop: 14, gap: 13 },
  scopeLabel: { paddingHorizontal: 4 },
  chips: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: { height: 34, justifyContent: 'center', paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth },
  loading: { marginTop: 24 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  dayGroup: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tileBadge: { position: 'absolute', right: 6, bottom: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, minWidth: 0 },
  messageCard: { padding: 14, gap: 4 },
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

export default withAgent(ArtifactsScreen)
