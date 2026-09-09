import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { AgentBackend, ScheduledJob, ScheduledJobDraft, ScheduledJobUpdate } from '@/domain'

export const scheduledJobsKey = (scope: string) => ['agent', scope, 'scheduled-jobs'] as const
export const scheduledJobRunsKey = (scope: string, id: string) => ['agent', scope, 'scheduled-jobs', id, 'runs'] as const
export const deliveryTargetsKey = (scope: string) => ['agent', scope, 'delivery-targets'] as const

/**
 * The agent's scheduled jobs (§7.20).
 *
 * `active` is what the Chat screen uses to stay lazy, exactly as the board
 * does: the list is only worth fetching there once the agent has actually
 * touched a job in the conversation. The Scheduled screen leaves it alone.
 */
export function useScheduledJobs(scope: string, backend: AgentBackend | null, active = true) {
  return useQuery({
    queryKey: scheduledJobsKey(scope),
    enabled: active && Boolean(backend) && backend?.capabilities.extras.cron === true,
    queryFn: () => backend!.listScheduledJobs(),
    // The host tells us when the store moves (`useScheduledJobsSync`); this
    // is the backstop for a socket that missed it.
    staleTime: 30_000
  })
}

/** Every job by id, for a sheet that must render the live row rather than the tapped copy. */
export function useScheduledJobIndex(scope: string, backend: AgentBackend | null, active = true): Map<string, ScheduledJob> {
  const jobs = useScheduledJobs(scope, backend, active)

  return useMemo(() => new Map((jobs.data ?? []).map(job => [job.id, job])), [jobs.data])
}

/** The runs of one job, newest first. Off until a sheet asks for them. */
export function useScheduledJobRuns(scope: string, backend: AgentBackend | null, id: string | null) {
  return useQuery({
    queryKey: scheduledJobRunsKey(scope, id ?? ''),
    enabled: Boolean(backend) && Boolean(id) && backend?.capabilities.extras.cron === true,
    queryFn: () => backend!.listScheduledJobRuns(id!, 20),
    staleTime: 15_000
  })
}

/** Where output can go. Changes when the host's gateway config does, which is rarely. */
export function useDeliveryTargets(scope: string, backend: AgentBackend | null, active = true) {
  return useQuery({
    queryKey: deliveryTargetsKey(scope),
    enabled: active && Boolean(backend) && backend?.capabilities.extras.cron === true,
    queryFn: () => backend!.listDeliveryTargets(),
    staleTime: 5 * 60_000
  })
}

/**
 * Refetch the list when the host says the store moved.
 *
 * The gateway watches `cron/jobs.json` and broadcasts `cron.changed` to every
 * socket when it changes — on a create, an edit, a pause, and on the
 * scheduler's own bookkeeping after a run. That covers the case this screen
 * cannot see coming: the agent creating a job from chat with its own
 * `cronjob` tool, or a run firing while the list is open. The record carries
 * no payload, so the answer is always a refetch of the whole list.
 */
export function useScheduledJobsSync(scope: string, backend: AgentBackend | null, active = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!active || !backend || backend.capabilities.extras.cron !== true) return

    return backend.subscribeEvents(record => {
      if (record.name !== 'cron.changed') return

      void queryClient.invalidateQueries({ queryKey: scheduledJobsKey(scope) })
      void queryClient.invalidateQueries({ queryKey: ['agent', scope, 'scheduled-jobs'], exact: false })
    })
  }, [active, backend, scope, queryClient])
}

function useInvalidateJobs(scope: string) {
  const queryClient = useQueryClient()

  return () => void queryClient.invalidateQueries({ queryKey: scheduledJobsKey(scope) })
}

export function useScheduledJobCreate(scope: string, backend: AgentBackend | null) {
  const invalidate = useInvalidateJobs(scope)

  return useMutation({
    mutationFn: async (draft: ScheduledJobDraft) => {
      if (!backend) throw new Error('Not connected')
      return backend.createScheduledJob(draft)
    },
    onSuccess: invalidate
  })
}

export function useScheduledJobUpdate(scope: string, backend: AgentBackend | null) {
  const invalidate = useInvalidateJobs(scope)

  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: ScheduledJobUpdate }) => {
      if (!backend) throw new Error('Not connected')
      return backend.updateScheduledJob(id, update)
    },
    onSuccess: invalidate
  })
}

export function useScheduledJobDelete(scope: string, backend: AgentBackend | null) {
  const invalidate = useInvalidateJobs(scope)

  return useMutation({
    mutationFn: async (id: string) => {
      if (!backend) throw new Error('Not connected')
      return backend.deleteScheduledJob(id)
    },
    onSuccess: invalidate
  })
}

/** Pause or resume. The row flips on settle either way, since the host is the truth. */
export function useScheduledJobEnable(scope: string, backend: AgentBackend | null) {
  const invalidate = useInvalidateJobs(scope)

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      if (!backend) throw new Error('Not connected')
      return backend.setScheduledJobEnabled(id, enabled)
    },
    onSettled: invalidate
  })
}

/**
 * Run now. The host's trigger route waits for the whole job, so this can
 * resolve minutes later — the list is refetched on settle, and a `cron.changed`
 * lands well before that once the run has been claimed.
 */
export function useScheduledJobTrigger(scope: string, backend: AgentBackend | null) {
  const invalidate = useInvalidateJobs(scope)

  return useMutation({
    mutationFn: async (id: string) => {
      if (!backend) throw new Error('Not connected')
      return backend.triggerScheduledJob(id)
    },
    onSettled: invalidate
  })
}
