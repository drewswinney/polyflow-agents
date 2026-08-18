import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ApprovalPolicy, McpServerStatus, SkillSummary } from '@/domain'
import { useActiveConnection } from '@/state/ConnectionProvider'
import { useSelectedAgent } from '@/state/agents'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Segmented } from '@/ui/components/Segmented'
import { Text } from '@/ui/components/Text'
import { useTheme } from '@/ui/ThemeProvider'

/**
 * Tools & integrations (§7.10).
 *
 * MCP servers are navigation rows, not toggles: each has a status, a tool list
 * and its own failure mode, and a switch would flatten all of that into on/off.
 * Toggles are reserved for genuine preferences (design §Interactions).
 *
 * The design shows an "on · unreachable, retrying" state. `/api/mcp/servers`
 * reports configuration, not reachability — that needs an explicit
 * `POST /api/mcp/servers/{name}/test` — so a server is described as what is
 * actually known rather than given a health it has not reported.
 */
export default function ToolsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const agent = useSelectedAgent()
  const { backend } = useActiveConnection()
  const queryClient = useQueryClient()

  const capabilities = backend?.capabilities
  const policyKey = ['agent', agent.id, 'approval-policy'] as const

  const policy = useQuery({
    queryKey: policyKey,
    enabled: Boolean(backend) && (capabilities?.approvals.policy ?? false),
    queryFn: () => backend!.getApprovalPolicy()
  })

  const setPolicy = useMutation({
    mutationFn: (next: ApprovalPolicy) => backend!.setApprovalPolicy(next),
    // The agent normalises the value it stores, so read back rather than assume.
    onSettled: () => queryClient.invalidateQueries({ queryKey: policyKey })
  })

  const servers = useQuery({
    queryKey: ['agent', agent.id, 'mcp'],
    enabled: Boolean(backend) && (capabilities?.extras.mcp ?? false),
    queryFn: () => backend!.listMcpServers()
  })

  const skills = useQuery({
    queryKey: ['agent', agent.id, 'skills'],
    enabled: Boolean(backend) && (capabilities?.extras.skills ?? false),
    queryFn: () => backend!.listSkills()
  })

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title="Tools & integrations" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {capabilities?.extras.mcp ? (
          <View style={styles.group}>
            <Text variant="sectionHeader" style={styles.groupLabel}>
              MCP servers
            </Text>
            <Card>
              {(servers.data ?? []).map((server, index) => (
                <View key={server.name}>
                  {index > 0 ? <Divider /> : null}
                  <McpRow server={server} />
                </View>
              ))}
              {servers.data?.length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="secondary">No MCP servers configured.</Text>
                </View>
              ) : null}
            </Card>
          </View>
        ) : null}

        {capabilities?.extras.skills ? (
          <View style={styles.group}>
            <Text variant="sectionHeader" style={styles.groupLabel}>
              Skills
            </Text>
            <Card>
              {(skills.data ?? []).map((skill, index) => (
                <View key={skill.name}>
                  {index > 0 ? <Divider /> : null}
                  <SkillRow skill={skill} />
                </View>
              ))}
              {skills.data?.length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="secondary">No skills installed.</Text>
                </View>
              ) : null}
            </Card>
          </View>
        ) : null}

        {capabilities?.approvals.policy ? (
          <View style={styles.group}>
            <Text variant="sectionHeader" style={styles.groupLabel}>
              Approval policy
            </Text>
            <Card style={styles.policyCard}>
              <Text variant="rowLabel">Ask me before</Text>
              {/* One decision, one control. Three independent switches would let
                  the user express states the backend's `approvals.mode` enum —
                  off / smart / manual — does not have. */}
              <Segmented<ApprovalPolicy>
                label="Ask me before"
                value={policy.data ?? 'destructive'}
                options={[
                  { value: 'nothing', label: 'Nothing' },
                  { value: 'destructive', label: 'Destructive' },
                  { value: 'every_tool', label: 'Every tool' }
                ]}
                onChange={next => setPolicy.mutate(next)}
              />
              <Text variant="secondary">
                {policy.data === 'nothing'
                  ? 'The agent runs everything without stopping to ask.'
                  : policy.data === 'every_tool'
                    ? 'Every tool call waits for you, including reads.'
                    : 'The agent stops only for commands it judges destructive.'}
              </Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function McpRow({ server }: { server: McpServerStatus }) {
  const theme = useTheme()

  const tint = server.enabled ? theme.color.success50 : theme.color.bgSubtle
  const glyphColor = server.enabled ? theme.color.success700 : theme.color.gray400
  const detail = server.enabled
    ? `on · ${server.toolCount} tool${server.toolCount === 1 ? '' : 's'} · ${server.transport}`
    : 'off'

  return (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: tint }]}>
        <Icon name="plug" size={13} color={glyphColor} />
      </View>
      <View style={styles.rowBody}>
        <Text variant="rowLabelStrong" numberOfLines={1}>
          {server.name}
        </Text>
        <Text variant="monoSmall">{detail}</Text>
      </View>
      <Icon name="chevron-right" size={11} color={theme.color.gray400} />
    </View>
  )
}

function SkillRow({ skill }: { skill: SkillSummary }) {
  const theme = useTheme()

  return (
    <View style={styles.skillRow}>
      <View style={styles.rowBody}>
        <Text variant="rowLabel" numberOfLines={1} color={skill.enabled ? theme.color.gray800 : theme.color.gray400}>
          {skill.name}
        </Text>
        <Text variant="secondary" numberOfLines={1}>
          {skill.description}
        </Text>
      </View>
      <Text variant="monoSmall">{skill.enabled ? skill.provenance : 'off'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13 },
  skillRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 8 },
  tile: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  empty: { padding: 16 },
  policyCard: { padding: 14, gap: 10 }
})
