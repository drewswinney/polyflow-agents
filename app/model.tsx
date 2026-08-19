import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ModelOption } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'
import { Pressable } from 'react-native'

/**
 * Model & behavior (§7.11).
 *
 * A radio list, applied on tap rather than behind a Save action: picking a
 * model is one decision with one outcome, and a Save button would imply a form
 * of pending edits that does not exist here. Temperature, system prompt and
 * memory belong on this screen too and need `/api/config/schema` (M4) to be
 * rendered rather than hardcoded — they are not stubbed in the meantime.
 */
export default function ModelScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
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

  const byProvider = groupByProvider(models.data ?? [])

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Model & behavior" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {models.isLoading ? (
          <Text variant="secondary">Loading models…</Text>
        ) : models.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((models.error as Error).message)}
          </Text>
        ) : (
          byProvider.map(group => (
            <View key={group.provider} style={styles.group}>
              <Text variant="sectionHeader" style={styles.groupLabel}>
                {group.provider}
              </Text>
              <Card>
                {group.models.map((option, index) => (
                  <View key={`${option.provider}/${option.id}`}>
                    {index > 0 ? <Divider /> : null}
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected: option.selected }}
                      disabled={choose.isPending}
                      onPress={() => choose.mutate(option)}
                      style={[styles.row, option.selected && { backgroundColor: theme.color.secondaryTint }]}
                    >
                      <Icon
                        name={option.selected ? 'circle-check' : 'circle'}
                        size={16}
                        color={option.selected ? theme.color.secondary : theme.color.gray400}
                      />
                      <Text variant={option.selected ? 'rowLabelStrong' : 'rowLabel'} style={styles.rowLabel}>
                        {option.id}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

function groupByProvider(models: ModelOption[]): Array<{ provider: string; models: ModelOption[] }> {
  const groups = new Map<string, ModelOption[]>()

  for (const model of models) {
    const bucket = groups.get(model.provider) ?? []
    bucket.push(model)
    groups.set(model.provider, bucket)
  }

  return [...groups].map(([provider, entries]) => ({ provider, models: entries }))
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  rowLabel: { flex: 1, minWidth: 0 }
})
