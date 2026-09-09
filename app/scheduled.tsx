import { useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ScheduledJob } from '@/domain'
import { useSelectedAgent } from '@/state/agents'
import { useBackend, useConnectionFault, useConnectionState } from '@/state/ConnectionProvider'
import {
  useDeliveryTargets,
  useScheduledJobCreate,
  useScheduledJobIndex,
  useScheduledJobs,
  useScheduledJobsSync,
  useScheduledJobUpdate
} from '@/state/scheduled'
import { useSidebar } from '@/state/sidebar'
import { withAgent } from '@/ui/components/AgentGate'
import { Card, Divider } from '@/ui/components/Card'
import { IconButton } from '@/ui/components/IconButton'
import { ScheduledJobDetail } from '@/ui/components/ScheduledJobDetail'
import { ScheduledJobForm, type ScheduledJobFormValues } from '@/ui/components/ScheduledJobForm'
import { ScheduledJobTile } from '@/ui/components/ScheduledJobTile'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { kanbanErrorText as hostErrorText } from '@/ui/kanban'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Scheduled (§7.20): the agent's jobs, what they do, and how they went.
 *
 * A top-level destination rather than a Settings row, because a job is
 * something the agent *does* — closer to a session than to a config key —
 * and because the list is where you look when a push says a run failed.
 *
 * Paused, active, running and failed all live in one list: the state is on
 * the row. Enabled-first and then by name, so what will fire is above what
 * will not.
 */
function ScheduledScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const connection = useConnectionState()
  const fault = useConnectionFault()
  const openSidebar = useSidebar(store => store.show)
  const scope = agent.scope ?? ''
  const supported = backend?.capabilities.extras.cron === true

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScheduledJob | null>(null)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const jobs = useScheduledJobs(scope, backend)
  // The sheet renders the live row, not the snapshot tapped off a tile, so a
  // pause or a run that lands while it is open shows there too.
  const index = useScheduledJobIndex(scope, backend)
  const targets = useDeliveryTargets(scope, backend, supported)
  const create = useScheduledJobCreate(scope, backend)
  const update = useScheduledJobUpdate(scope, backend)

  useScheduledJobsSync(scope, backend)

  const selected = selectedId ? (index.get(selectedId) ?? null) : null
  const sorted = [...(jobs.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  const loadError = jobs.error
    ? hostErrorText(jobs.error)
    : !backend && connection === 'error'
      ? (fault.error ?? 'Not connected.')
      : null

  const formOpen = creating || editing !== null

  const closeForm = () => {
    setCreating(false)
    setEditing(null)
    setFormError(null)
  }

  const submit = (values: ScheduledJobFormValues) => {
    setFormError(null)

    if (editing) {
      // Only what changed: the host's update route merges, and sending the
      // prompt back unchanged is harmless but sending an empty name is a rename.
      const changed = {
        ...(values.name !== editing.name ? { name: values.name } : {}),
        ...(values.schedule !== editing.scheduleExpr ? { schedule: values.schedule } : {}),
        ...(editing.kind === 'prompt' && values.prompt !== editing.prompt ? { prompt: values.prompt } : {}),
        ...(values.deliver !== editing.deliver ? { deliver: values.deliver } : {})
      }

      if (Object.keys(changed).length === 0) {
        closeForm()
        return
      }

      update.mutate({ id: editing.id, update: changed }, { onSuccess: closeForm, onError: e => setFormError(hostErrorText(e)) })
      return
    }

    create.mutate(
      { name: values.name, schedule: values.schedule, prompt: values.prompt, deliver: values.deliver },
      {
        onSuccess: job => {
          closeForm()
          setSelectedId(job.id)
        },
        onError: e => setFormError(hostErrorText(e))
      }
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Scheduled"
        onMenu={openSidebar}
        right={supported ? <IconButton name="plus" size={17} accessibilityLabel="New job" outlined onPress={() => setCreating(true)} /> : null}
      />

      {!supported ? (
        <View style={[styles.body, { paddingTop: headerInset }]}>
          <Card style={styles.messageCard}>
            <Text variant="rowLabelStrong">Scheduled jobs unavailable</Text>
            <Text variant="secondary">This agent does not report a scheduler.</Text>
          </Card>
        </View>
      ) : jobs.data ? (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: headerInset, paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={jobs.isFetching && !jobs.isPending} onRefresh={() => void jobs.refetch()} tintColor={theme.color.gray500} />}
        >
          {sorted.length === 0 ? (
            <Card style={styles.messageCard}>
              <Text variant="rowLabelStrong">Nothing scheduled</Text>
              <Text variant="secondary">
                {`Add a job with the plus, or ask ${agent.displayName} in chat — "every weekday at 7, summarise overnight alerts".`}
              </Text>
            </Card>
          ) : (
            <Card>
              {sorted.map((job, position) => (
                <View key={job.id}>
                  {position > 0 ? <Divider /> : null}
                  <ScheduledJobTile job={job} onPress={() => setSelectedId(job.id)} />
                </View>
              ))}
            </Card>
          )}

          <Text variant="secondary" color={theme.color.gray500} style={styles.footnote}>
            {"Jobs fire from the host's gateway on their schedule. Each agent run is a session, and opens like one."}
          </Text>
        </ScrollView>
      ) : loadError ? (
        <View style={[styles.body, { paddingTop: headerInset }]}>
          <Card style={styles.messageCard}>
            <Text variant="rowLabelStrong">{`Could not load jobs for ${agent.displayName}`}</Text>
            <Text variant="secondary">{loadError}</Text>
          </Card>
        </View>
      ) : (
        <ActivityIndicator color={theme.color.gray500} style={styles.loading} />
      )}

      <ScheduledJobDetail
        job={formOpen ? null : selected}
        onDismiss={() => setSelectedId(null)}
        scope={scope}
        backend={backend}
        editable={supported}
        onEdit={job => setEditing(job)}
      />

      <ScheduledJobForm
        visible={formOpen}
        job={editing}
        targets={targets.data ?? []}
        busy={create.isPending || update.isPending}
        error={formError}
        onSubmit={submit}
        onDismiss={closeForm}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  messageCard: { padding: 14, gap: 4 },
  footnote: { paddingHorizontal: 4 },
  loading: { marginTop: 24 }
})

export default withAgent(ScheduledScreen)
