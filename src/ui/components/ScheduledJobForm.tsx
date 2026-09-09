import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import type { DeliveryTarget, ScheduledJob } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Text } from './Text'

export interface ScheduledJobFormValues {
  name: string
  schedule: string
  prompt: string
  deliver: string
}

/** The phone is where the person is, so a new job reports there when it can. */
const PREFERRED_TARGET = 'polyflow_agents_push'

/**
 * New job, or an edit of one: a name, when, what, and where the output goes.
 *
 * Deliberately no model, skills, workdir or toolsets — those are the host's
 * defaults and the desktop's business, and a form that offers everything the
 * host stores is one nobody fills in from a pocket. The prompt is the whole
 * of what the agent will know, so the hint under it says so.
 */
export function ScheduledJobForm({
  visible,
  job,
  targets,
  busy,
  error,
  onSubmit,
  onDismiss
}: {
  visible: boolean
  /** The job being edited, or null for a new one. */
  job: ScheduledJob | null
  targets: DeliveryTarget[]
  busy: boolean
  error: string | null
  onSubmit: (values: ScheduledJobFormValues) => void
  onDismiss: () => void
}) {
  const theme = useTheme()
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [prompt, setPrompt] = useState('')
  const [deliver, setDeliver] = useState('local')

  // Fresh fields every time the sheet opens: for an edit, the job's own; for
  // a new job, empty with the phone as the target when the host offers it.
  useEffect(() => {
    if (!visible) return

    setName(job?.name ?? '')
    setSchedule(job?.scheduleExpr ?? '')
    setPrompt(job?.prompt ?? '')
    setDeliver(job?.deliver ?? defaultTarget(targets))
  }, [visible, job, targets])

  const isScript = job?.kind === 'script'
  const valid = schedule.trim().length > 0 && (isScript || prompt.trim().length > 0)
  const input = {
    borderColor: theme.color.border,
    backgroundColor: theme.color.bgSubtle,
    color: theme.color.gray900,
    fontFamily: theme.font.body
  }

  return (
    <Sheet visible={visible} title={job ? 'Edit job' : 'New job'} onDismiss={onDismiss} expandable>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Field label="Name" hint={job ? null : 'Optional. Falls back to the start of the prompt.'}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="morning digest"
            placeholderTextColor={theme.color.gray400}
            maxLength={80}
            style={[styles.input, input]}
          />
        </Field>

        <Field label="When" hint="A cron expression (0 6 * * 0), an interval (every 2h), or once (in 30m, 2026-10-01T09:00).">
          <TextInput
            value={schedule}
            onChangeText={setSchedule}
            placeholder="every day at 7am"
            placeholderTextColor={theme.color.gray400}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.mono, input, { fontFamily: theme.font.mono }]}
          />
        </Field>

        {isScript ? (
          <Field label="What it does" hint={null}>
            <Text variant="secondary">
              {job?.script ? `Runs ${job.script} on the host. ` : 'Runs a script on the host. '}
              The script itself is edited there, not here.
            </Text>
          </Field>
        ) : (
          <Field
            label="Prompt"
            hint="Runs in a fresh session with nothing else in it, so say everything the agent needs: hosts, paths, what to report."
          >
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Check the backups finished and tell me what changed."
              placeholderTextColor={theme.color.gray400}
              multiline
              style={[styles.input, styles.promptInput, input]}
            />
          </Field>
        )}

        <Field label="Deliver to" hint={null}>
          <View style={styles.targets}>
            {(targets.length ? targets : [{ id: 'local', name: 'Local (save only)', ready: true, hint: null }]).map(target => {
              const selected = target.id === deliver

              return (
                <Pressable
                  key={target.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !target.ready }}
                  accessibilityLabel={target.ready ? target.name : `${target.name}, needs ${target.hint ?? 'a home channel'}`}
                  disabled={!target.ready}
                  onPress={() => setDeliver(target.id)}
                  style={[
                    styles.target,
                    {
                      borderColor: selected ? theme.color.secondary : theme.color.border,
                      backgroundColor: selected ? theme.color.secondaryTint : theme.color.surface,
                      opacity: target.ready ? 1 : 0.5
                    }
                  ]}
                >
                  {selected ? <Icon name="check" size={10} color={theme.color.secondaryDeep} /> : null}
                  <Text variant="pill" color={selected ? theme.color.secondaryDeep : theme.color.gray800} numberOfLines={1}>
                    {target.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          {targets.some(target => !target.ready) ? (
            <Text variant="secondary" color={theme.color.gray500}>
              Greyed targets need their home channel set on the host first.
            </Text>
          ) : null}
        </Field>

        {error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            disabled={busy}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, opacity: pressed ? 0.6 : 1 }
            ]}
          >
            <Text variant="rowLabelStrong" color={theme.color.gray600}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={job ? 'Save job' : 'Create job'}
            disabled={busy || !valid}
            onPress={() => onSubmit({ name: name.trim(), schedule: schedule.trim(), prompt: prompt.trim(), deliver })}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: busy || !valid ? theme.color.bgSubtle : theme.color.accentFill,
                borderColor: busy || !valid ? theme.color.border : theme.color.accentFill,
                opacity: pressed ? 0.8 : 1
              }
            ]}
          >
            <Text variant="rowLabelStrong" color={busy || !valid ? theme.color.gray400 : theme.color.onAccent}>
              {busy ? (job ? 'Saving…' : 'Creating…') : job ? 'Save' : 'Create'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Sheet>
  )
}

function defaultTarget(targets: DeliveryTarget[]): string {
  const preferred = targets.find(target => target.id === PREFERRED_TARGET)

  return preferred?.ready ? preferred.id : 'local'
}

function Field({ label, hint, children }: { label: string; hint: string | null; children: React.ReactNode }) {
  const theme = useTheme()

  return (
    <View style={styles.field}>
      <Text variant="sectionHeader">{label}</Text>
      {children}
      {hint ? (
        <Text variant="secondary" color={theme.color.gray500}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  field: { gap: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15
  },
  mono: { fontSize: 13 },
  promptInput: { minHeight: 140, textAlignVertical: 'top' },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 }
})
