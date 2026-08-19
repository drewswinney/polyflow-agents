import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useActiveConnection } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { type EventFilter, matchesFilter, useEventLog } from '@/state/event-log'
import { Card, Divider } from '@/ui/components/Card'
import { EventRow } from '@/ui/components/EventRow'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

const FILTERS: Array<{ key: EventFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'tools', label: 'Tools' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'errors', label: 'Errors' }
]

/**
 * Logs & events (§7.15).
 *
 * The same rows Activity shows, plus the thing Activity deliberately does not
 * do: tapping one opens its full payload as pretty-printed JSON. That is the
 * screen's whole reason to exist — Activity is for noticing, this is for
 * finding out what actually happened.
 */
export default function LogsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const { backend } = useActiveConnection()
  const [filter, setFilter] = useState<EventFilter>('all')

  const liveEvents = useEventLog(store => store.records)

  const history = useQuery({
    queryKey: ['agent', agent.id, 'events', 'full'],
    enabled: Boolean(backend) && (backend?.capabilities.logs.events ?? false),
    queryFn: () => backend!.listEvents(200)
  })

  const rows = useMemo(
    () => [...liveEvents, ...(history.data ?? [])].filter(record => matchesFilter(record, filter)),
    [liveEvents, history.data, filter]
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Logs & events" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map(option => {
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

        <Card>
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="secondary">
                {history.isFetching ? 'Loading…' : filter === 'all' ? 'No events yet.' : `No ${filter} events.`}
              </Text>
            </View>
          ) : (
            rows.map((record, index) => (
              <View key={record.id}>
                {index > 0 ? <Divider /> : null}
                <EventRow record={record} expandable />
              </View>
            ))
          )}
        </Card>

        {history.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((history.error as Error).message)}
          </Text>
        ) : null}

        <Text variant="monoSmall" style={styles.footer}>
          {`${rows.length} shown · live tail capped at 500`}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  chips: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: { height: 34, justifyContent: 'center', paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth },
  empty: { padding: 16 },
  footer: { paddingHorizontal: 4 }
})
