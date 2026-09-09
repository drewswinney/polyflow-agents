import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import type { ScheduledJob } from '@/domain'
import { useSelectedAgent } from '@/state/agents'
import { useBackend } from '@/state/ConnectionProvider'
import { useScheduledJobIndex, useScheduledJobsSync } from '@/state/scheduled'

import { actionLabel, jobFromRef, type ScheduledJobRef } from '../scheduled'
import { ScheduledJobDetail } from './ScheduledJobDetail'
import { ScheduledJobPreview } from './ScheduledJobTile'

interface ScheduledJobCardsContext {
  jobs: Map<string, ScheduledJob>
  open: (job: ScheduledJob) => void
  /** Called by a mounted card: the list is worth fetching now. */
  demand: () => void
}

const Context = createContext<ScheduledJobCardsContext | null>(null)

/**
 * Turns the agent's `cronjob` tool calls in the transcript into the jobs they
 * made, the way `KanbanMentionProvider` turns `[[links]]` into cards.
 *
 * Wraps the Chat screen so every card in the session resolves against one
 * copy of the list and the detail sheet is mounted once above the list. The
 * list is not fetched until a card actually mounts — most sessions never
 * touch a job — and once it is, the host's `cron.changed` keeps it current,
 * so a job the agent just created shows its first run as it happens.
 */
export function ScheduledJobProvider({ children }: { children: ReactNode }) {
  const agent = useSelectedAgent()
  const backend = useBackend()
  const scope = agent.scope ?? ''
  const [wanted, setWanted] = useState(false)
  const [selected, setSelected] = useState<ScheduledJob | null>(null)
  const jobs = useScheduledJobIndex(scope, backend, wanted)

  useScheduledJobsSync(scope, backend, wanted)

  const demand = useCallback(() => setWanted(true), [])
  const open = useCallback((job: ScheduledJob) => setSelected(job), [])
  const value = useMemo<ScheduledJobCardsContext>(() => ({ jobs, open, demand }), [jobs, open, demand])

  // The sheet shows the live row when the list has it, so a run that lands
  // while it is open is on it; the tapped copy is the fallback for a job the
  // agent has since deleted.
  const live = selected ? (jobs.get(selected.id) ?? selected) : null

  return (
    <Context.Provider value={value}>
      {children}
      <ScheduledJobDetail job={live} onDismiss={() => setSelected(null)} scope={scope} backend={backend} />
    </Context.Provider>
  )
}

/**
 * The jobs a stretch of working-out touched, as a strip of tiles beneath it.
 *
 * Each card is drawn from the live list when the job is still on it and from
 * the tool's own result when it is not, so a card never goes blank because
 * the job was later removed. Renders nothing outside a provider.
 */
export function ScheduledJobCards({ refs }: { refs: ScheduledJobRef[] }) {
  const context = useContext(Context)
  const demand = context?.demand

  useEffect(() => {
    if (refs.length) demand?.()
  }, [refs, demand])

  if (!context || refs.length === 0) return null

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {refs.map(ref => {
        const job = context.jobs.get(ref.jobId) ?? jobFromRef(ref)

        return <ScheduledJobPreview key={ref.jobId} job={job} caption={actionLabel(ref.action)} onPress={() => context.open(job)} />
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // The artifact strip's measurements, so the strips line up under a message.
  strip: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 6, paddingRight: 8 }
})
