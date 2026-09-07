import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ModelOption } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { withAgent } from '@/ui/components/AgentGate'
import { ModelList } from '@/ui/components/ModelList'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Model & behavior (§7.11).
 *
 * A radio list, applied on tap rather than behind a Save action: picking a
 * model is one decision with one outcome, and a Save button would imply a form
 * of pending edits that does not exist here. Temperature, system prompt and
 * memory belong on this screen too and need `/api/config/schema` (M4) to be
 * rendered rather than hardcoded — they are not stubbed in the meantime.
 */
function ModelScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const queryClient = useQueryClient()

  const modelsKey = ['agent', agent.id, 'models'] as const

  const models = useQuery({
    queryKey: modelsKey,
    enabled: Boolean(backend) && (backend?.capabilities.settings.model ?? false),
    queryFn: () => backend!.listModels()
  })

  const choose = useMutation({
    mutationFn: (option: ModelOption) => backend!.setModel(option),
    // The selection is authoritative on the agent, so re-read it rather than
    // trusting the optimistic guess — a provider can refuse a model.
    onSettled: () => queryClient.invalidateQueries({ queryKey: modelsKey })
  })

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Model & behavior" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingTop: headerInset, paddingBottom: insets.bottom + 24 }]}>
        {models.isLoading ? (
          <Text variant="secondary">Loading models…</Text>
        ) : models.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((models.error as Error).message)}
          </Text>
        ) : (
          // No `isSelected`: this screen sets the profile default, which is
          // exactly what the host's own `selected` flag reports.
          <ModelList models={models.data ?? []} busy={choose.isPending} onChoose={option => choose.mutate(option)} />
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  rowLabel: { flex: 1, minWidth: 0 }
})

export default withAgent(ModelScreen)
