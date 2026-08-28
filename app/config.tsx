import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ConfigField } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { useAgents, useSelectedAgent, useSelectAgent } from '@/state/agents'
import { Card, Divider } from '@/ui/components/Card'
import { AgentSwitcher } from '@/ui/components/AgentSwitcher'
import { Segmented } from '@/ui/components/Segmented'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { Toggle } from '@/ui/components/Toggle'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Settings, rendered from `/api/config/schema` (§7.4, M4).
 *
 * This is the single highest-leverage decision in the app: the server describes
 * its own configuration, so the form is generated from that description rather
 * than hand-written per setting. Hermes adding a toggle does not need an app
 * release — it appears here on the next fetch.
 *
 * The cost of that leverage is that the UI knows nothing about any individual
 * setting. It can only render by *type*, which is why an unknown type still
 * renders as text rather than being skipped: a field the app does not
 * understand is still a field the user may need.
 */
export default function ConfigScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const backend = useBackend()
  const queryClient = useQueryClient()
  const servers = useAgents(state => state.servers)
  const agents = useAgents(state => state.agents)
  const selectAgent = useSelectAgent()
  const dismissAgent = useAgents(state => state.dismissAgent)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const fieldsKey = ['agent', agent.id, 'config'] as const

  const fields = useQuery({
    queryKey: fieldsKey,
    enabled: Boolean(backend) && (backend?.capabilities.settings.schemaDriven ?? false),
    queryFn: () => backend!.listConfigFields()
  })

  const write = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => backend!.setConfigValue(key, value),
    // The agent is authoritative: it can normalise or reject a value, so the
    // written state is re-read rather than assumed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: fieldsKey })
  })

  const groups = useMemo(() => groupByCategory(fields.data ?? []), [fields.data])

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Agent configuration" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {fields.isLoading ? (
          <Text variant="secondary">Reading the agent schema…</Text>
        ) : fields.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((fields.error as Error).message)}
          </Text>
        ) : groups.length === 0 ? (
          <Card style={styles.card}>
            <Text variant="secondary">This agent publishes no configuration schema.</Text>
          </Card>
        ) : (
          groups.map(group => (
            <View key={group.category} style={styles.group}>
              <Text variant="sectionHeader" style={styles.groupLabel}>
                {group.category}
              </Text>
              <Card>
                {group.fields.map((field, index) => (
                  <View key={field.key}>
                    {index > 0 ? <Divider /> : null}
                    <FieldRow
                      field={field}
                      pending={write.isPending}
                      onChange={value => write.mutate({ key: field.key, value })}
                    />
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      <AgentSwitcher
        servers={servers}
        agents={agents}
        selectedId={agent.id}
        visible={switcherOpen}
        onSelect={selectAgent}
        onDismissAgent={id => void dismissAgent(id)}
        onAddServer={() => router.push('/servers/new' as never)}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </View>
  )
}

function FieldRow({
  field,
  pending,
  onChange
}: {
  field: ConfigField
  pending: boolean
  onChange: (value: string) => void
}) {
  const theme = useTheme()

  const heading = (
    <View style={styles.heading}>
      <Text variant="rowLabel" numberOfLines={1}>
        {humanise(field.key)}
      </Text>
      <Text variant="monoSmall" numberOfLines={1}>
        {field.key}
      </Text>
      {field.description ? <Text variant="secondary">{field.description}</Text> : null}
    </View>
  )

  if (field.type === 'boolean') {
    const on = field.value === 'true' || field.value === '1'

    return (
      <View style={styles.row}>
        {heading}
        <Toggle
          label={humanise(field.key)}
          value={on}
          disabled={pending}
          onChange={next => onChange(next ? 'true' : 'false')}
        />
      </View>
    )
  }

  if (field.type === 'select' && field.options.length > 0 && field.options.length <= 3) {
    return (
      <View style={styles.stack}>
        {heading}
        <Segmented
          label={humanise(field.key)}
          value={field.value}
          options={field.options.map(option => ({ value: option, label: option }))}
          onChange={onChange}
        />
      </View>
    )
  }

  if (field.type === 'select' && field.options.length > 3) {
    return (
      <View style={styles.stack}>
        {heading}
        <View style={styles.chips}>
          {field.options.map(option => {
            const selected = option === field.value

            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChange(option)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.color.secondaryTint : theme.color.bgSubtle,
                    borderColor: selected ? theme.color.secondaryMuted : theme.color.border,
                    borderRadius: theme.radius.pill
                  }
                ]}
              >
                <Text variant="pill" color={selected ? theme.color.secondaryDeep : theme.color.gray600}>
                  {option}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    )
  }

  // number, string, text, list — and anything the schema grows that this app
  // has never heard of. Committing on blur rather than per keystroke keeps one
  // edit to one write.
  return (
    <View style={styles.stack}>
      {heading}
      <ValueInput field={field} onCommit={onChange} />
    </View>
  )
}

function ValueInput({ field, onCommit }: { field: ConfigField; onCommit: (value: string) => void }) {
  const theme = useTheme()
  const [draft, setDraft] = useState(field.value)

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={() => {
        if (draft !== field.value) onCommit(draft)
      }}
      keyboardType={field.type === 'number' ? 'numeric' : 'default'}
      multiline={field.type === 'text'}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="not set"
      placeholderTextColor={theme.color.gray400}
            keyboardAppearance={theme.dark ? 'dark' : 'light'}
      style={[
        styles.input,
        {
          backgroundColor: theme.color.bgSubtle,
          borderColor: theme.color.border,
          borderRadius: theme.radius.control,
          color: theme.color.gray800,
          fontFamily: theme.font.mono
        }
      ]}
    />
  )
}

function groupByCategory(fields: ConfigField[]): Array<{ category: string; fields: ConfigField[] }> {
  const groups: Array<{ category: string; fields: ConfigField[] }> = []

  // The backend already sorted by its own category order; preserving first-seen
  // order here keeps that ranking rather than re-sorting alphabetically.
  for (const field of fields) {
    const existing = groups.find(group => group.category === field.category)

    if (existing) existing.fields.push(field)
    else groups.push({ category: field.category, fields: [field] })
  }

  return groups
}

/** `display.message_reactions` → `Message reactions`. */
function humanise(key: string): string {
  const leaf = key.split('.').at(-1) ?? key
  const words = leaf.replace(/[_-]+/g, ' ').trim()

  return words.charAt(0).toUpperCase() + words.slice(1)
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  card: { padding: 14 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 12 },
  stack: { gap: 10, paddingHorizontal: 13, paddingVertical: 12 },
  heading: { flex: 1, minWidth: 0, gap: 2 },
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: StyleSheet.hairlineWidth }
})
