import { Pressable, StyleSheet, View } from 'react-native'

import type { ModelOption } from '@/domain'

import { useTheme } from '../ThemeProvider'
import { Card, Divider } from './Card'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * The models a host offers, grouped by provider, as a radio list.
 *
 * Shared by Settings (§7.11), which sets the profile default, and the
 * composer's sheet, which re-points one session. Two screens, one list —
 * they differ only in what "selected" means and what tapping does, which is
 * why both arrive as props.
 *
 * Applied on tap rather than behind a Save action: picking a model is one
 * decision with one outcome, and a Save button would imply a form of pending
 * edits that does not exist here.
 */
export function ModelList({
  models,
  onChoose,
  busy = false,
  isSelected
}: {
  models: ModelOption[]
  onChoose: (option: ModelOption) => void
  busy?: boolean
  /**
   * Overrides the host's own `selected` flag. The session sheet needs it: the
   * list reports which model is the *profile* default, which is exactly not
   * the question being asked when re-pointing one conversation.
   */
  isSelected?: (option: ModelOption) => boolean
}) {
  const theme = useTheme()

  return (
    <>
      {groupByProvider(models).map(group => (
        <View key={group.provider} style={styles.group}>
          <Text variant="sectionHeader" style={styles.groupLabel}>
            {group.provider}
          </Text>
          <Card>
            {group.models.map((option, index) => {
              const selected = isSelected ? isSelected(option) : option.selected

              return (
                <View key={`${option.provider}/${option.id}`}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    disabled={busy}
                    onPress={() => onChoose(option)}
                    style={[styles.row, selected && { backgroundColor: theme.color.secondaryTint }]}
                  >
                    <Icon
                      name={selected ? 'circle-check' : 'circle'}
                      size={16}
                      color={selected ? theme.color.secondary : theme.color.gray400}
                    />
                    <Text variant={selected ? 'rowLabelStrong' : 'rowLabel'} style={styles.rowLabel}>
                      {option.id}
                    </Text>
                  </Pressable>
                </View>
              )
            })}
          </Card>
        </View>
      ))}
    </>
  )
}

export function groupByProvider(models: ModelOption[]): { provider: string; models: ModelOption[] }[] {
  const groups = new Map<string, ModelOption[]>()

  for (const model of models) {
    const bucket = groups.get(model.provider) ?? []
    bucket.push(model)
    groups.set(model.provider, bucket)
  }

  return [...groups].map(([provider, entries]) => ({ provider, models: entries }))
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  rowLabel: { flex: 1, minWidth: 0 }
})
