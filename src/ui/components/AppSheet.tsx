import { useMutation, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import type { ModelOption, ModelSwitch } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { useAgents, useSelectAgent, useSelectedAgentOrNull } from '@/state/agents'
import { useSheet, type SheetRequest } from '@/state/sheet'

import { useTheme } from '../ThemeProvider'
import { modelLabel } from '../format'
import { Card } from './Card'
import { Icon } from './Icon'
import { AgentSwitcherList } from './AgentSwitcher'
import { ModelList } from './ModelList'
import { Sheet } from './Sheet'
import { Text } from './Text'

/**
 * The one mounted sheet, showing whatever the store has asked for.
 *
 * Beside `AppSidebar` in the root layout rather than inside a screen, so it
 * covers the composer and the keyboard instead of being positioned by them.
 */
export function AppSheet() {
  const request = useSheet(store => store.request)
  const close = useSheet(store => store.close)
  const settle = useSheet(store => store.settle)

  return (
    <Sheet visible={request !== null} title={titleFor(request)} onDismiss={close} onHidden={settle}>
      {request?.kind === 'model' ? <ModelSheet request={request} onDone={close} /> : null}
      {request?.kind === 'add-to-chat' ? <AddToChatSheet request={request} onDone={close} /> : null}
      {request?.kind === 'agent' ? <AgentSheet onDone={close} /> : null}
    </Sheet>
  )
}

function titleFor(request: SheetRequest | null): string {
  // On home there is no chat yet — the pick applies to the session the next
  // message creates.
  if (request?.kind === 'model') return request.sessionId ? 'Model for this chat' : 'Model for new session'
  if (request?.kind === 'add-to-chat') return 'Add to chat'
  if (request?.kind === 'agent') return 'Agents'

  return ''
}

/**
 * Re-points one session at another model (§7.11).
 *
 * The selected row is the *session's* model, not the host's default — the
 * list's own `selected` flag answers a different question, and showing it here
 * would report the profile default as this conversation's pick.
 */
function ModelSheet({ request, onDone }: { request: Extract<SheetRequest, { kind: 'model' }>; onDone: () => void }) {
  const theme = useTheme()
  const backend = useBackend()
  const agent = useSelectedAgentOrNull()
  const [outcome, setOutcome] = useState<ModelSwitch | null>(null)

  const models = useQuery({
    queryKey: ['agent', agent?.id ?? '', 'models'] as const,
    enabled: Boolean(backend) && (backend?.capabilities.settings.model ?? false),
    queryFn: () => backend!.listModels()
  })

  const choose = useMutation({
    // With no session there is nothing on the host to re-point: the pick is
    // handed back to the screen, which spends it on the session it is about to
    // create. Reported as an immediate, unremarkable switch so the sheet just
    // closes — nothing has happened yet that needs reading.
    mutationFn: async (option: ModelOption): Promise<ModelSwitch> => {
      if (request.sessionId === null) {
        request.onPick?.(option.id)

        return { model: option.id, deferred: false, warning: '' }
      }

      return backend!.setSessionModel(request.sessionId, option)
    },
    onSuccess: result => {
      // A clean, immediate switch has nothing left to say, so the sheet gets
      // out of the way. A deferred one — or one the host warned about — is a
      // different outcome from the one the tap implied, and has to be read
      // before it is dismissed.
      if (!result.deferred && !result.warning) {
        onDone()

        return
      }

      setOutcome(result)
    }
  })

  if (outcome) {
    return (
      <View style={styles.body}>
        <Card>
          <View style={styles.notice}>
            <Text variant="rowLabelStrong">{modelLabel(outcome.model)}</Text>
            {outcome.deferred ? (
              <Text variant="secondary">
                A turn is still running, so this applies from your next message — the one in flight finishes on the old
                model.
              </Text>
            ) : null}
            {outcome.warning ? (
              <Text variant="secondary" color={theme.color.warning700}>
                {outcome.warning}
              </Text>
            ) : null}
          </View>
        </Card>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={[styles.done, { borderColor: theme.color.border, borderRadius: theme.radius.row }]}
        >
          <Text variant="rowLabelStrong">Done</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {models.isLoading ? <ActivityIndicator color={theme.color.secondary} /> : null}

      {models.error ? (
        <Text variant="secondary" color={theme.color.error700}>
          {String((models.error as Error).message)}
        </Text>
      ) : null}

      {choose.error ? (
        <Text variant="secondary" color={theme.color.error700}>
          {String((choose.error as Error).message)}
        </Text>
      ) : null}

      <ModelList
        models={models.data ?? []}
        busy={choose.isPending}
        isSelected={option => option.id === request.currentModel || `${option.provider}/${option.id}` === request.currentModel}
        onChoose={option => choose.mutate(option)}
      />
    </ScrollView>
  )
}

/**
 * Which agent the app is pointed at.
 *
 * Selecting re-scopes everything — sessions, settings, history — so switching
 * lands you on New session (§5.2): the screens you can switch *from* are
 * scoped to the agent you just left, and keeping the screen would redraw it
 * against something else's data.
 */
function AgentSheet({ onDone }: { onDone: () => void }) {
  const servers = useAgents(state => state.servers)
  const agents = useAgents(state => state.agents)
  const dismissAgent = useAgents(state => state.dismissAgent)
  const selected = useSelectedAgentOrNull()
  const selectAgent = useSelectAgent()

  return (
    // No card, but the same inset a card gave it: the sheet is already the
    // surface, and boxing the list drew a second edge a few points in from the
    // first — the server groups carry their own rules to separate them.
    <ScrollView contentContainerStyle={styles.plain}>
      <AgentSwitcherList
        servers={servers}
        agents={agents}
        selectedId={selected?.id ?? ''}
        onSelect={id => {
          onDone()

          // Re-picking the agent you are already on is not a switch.
          if (id === selected?.id) return

          selectAgent(id)
          router.navigate('/')
        }}
        onDismissAgent={id => void dismissAgent(id)}
        onAddServer={() => {
          onDone()
          router.push('/servers/new')
        }}
      />
    </ScrollView>
  )
}

/** What can be attached to the next message. */
function AddToChatSheet({
  request,
  onDone
}: {
  request: Extract<SheetRequest, { kind: 'add-to-chat' }>
  onDone: (after?: () => void) => void
}) {
  const theme = useTheme()

  const rows = [
    { icon: 'image', label: 'Photo library', source: 'library' as const },
    { icon: 'camera', label: 'Take photo', source: 'camera' as const }
  ]

  return (
    <View style={styles.body}>
      <Card>
        {rows.map((row, index) => (
          <Pressable
            key={row.source}
            accessibilityRole="button"
            onPress={() => {
              // Closed first: the picker is a native screen of its own, and
              // leaving the sheet under it means coming back to a stale card.
              // And closed *fully* first — the pick waits for the sheet to
              // leave the screen, because a picker presented while this
              // sheet's Modal is still on its way out is presented on that
              // Modal, and dismissed with it. That was the camera that opened
              // and closed itself.
              onDone(() => request.onPick(row.source))
            }}
            style={[styles.row, index > 0 && { borderTopColor: theme.color.divider, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.tile, { backgroundColor: theme.color.secondaryTint }]}>
              <Icon name={row.icon} size={15} color={theme.color.secondary} />
            </View>
            <Text variant="rowLabel" style={styles.rowLabel}>
              {row.label}
            </Text>
          </Pressable>
        ))}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8, gap: 13 },
  // Same 16 as the carded sheets, so the list starts on the same line they do —
  // the rows' own 11 sits inside it, which is what a card's padding used to add.
  plain: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8 },
  notice: { padding: 14, gap: 6 },
  done: { height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  tile: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, minWidth: 0 }
})
