import * as Clipboard from 'expo-clipboard'
import { File } from 'expo-file-system'
import { router, useLocalSearchParams } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Artifact } from '@/domain'
import { ensureArtifactFile, useArtifactFile } from '@/platform/artifact-cache'
import { useBackend } from '@/state/ConnectionProvider'
import { useAgentScopedRoute } from '@/state/agent-scope'
import { useSelectedAgent, useSelectedServer } from '@/state/agents'
import { useArtifact, useArtifactActions } from '@/state/artifacts'
import { withAgent } from '@/ui/components/AgentGate'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ImageViewer } from '@/ui/components/ImageViewer'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { ARTIFACT_GLYPH, describeOrigin, formatBytes, isTextLike, kindLabel, shareCaption } from '@/ui/artifacts'
import { clockTime, relativeTime } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/** How long "Copied" stays on the button before it reads "Copy link" again. */
const COPIED_FOR_MS = 1_800

/**
 * One artifact (`docs/artifacts.md` §6): preview, provenance, and the four
 * things you can do with it — open the conversation it came from, hand the
 * file to another app, share or stop sharing a link, delete it.
 *
 * "Share file" and "Copy link" are separate on purpose. The file goes anywhere
 * the share sheet reaches, outsiders included; the link works for anyone who
 * can already sign in to the host, and the caption under it says so rather
 * than letting the word "link" promise more than the host's auth gate allows.
 */
function ArtifactScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const headerInset = useHeaderInset()
  const agent = useSelectedAgent()
  const server = useSelectedServer()
  const backend = useBackend()
  const { id } = useLocalSearchParams<{ id: string }>()
  const scope = agent.scope ?? ''

  const stale = useAgentScopedRoute()
  const query = useArtifact(scope, stale ? null : backend, id ?? '')
  const artifact = query.data ?? null
  const actions = useArtifactActions(scope, backend)

  const [busy, setBusy] = useState<'share-file' | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)

    return () => clearTimeout(timer)
  }, [copied])

  const shareFile = async () => {
    if (!backend || !artifact) return

    setBusy('share-file')
    setNotice(null)

    try {
      const uri = await ensureArtifactFile(artifact, () => backend.readArtifact(artifact.id))

      if (!(await Sharing.isAvailableAsync())) {
        setNotice('Sharing is not available on this device.')

        return
      }

      await Sharing.shareAsync(uri, { mimeType: artifact.mimeType, dialogTitle: artifact.name })
    } catch (error) {
      setNotice(String((error as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const copyLink = async () => {
    if (!artifact) return

    setNotice(null)

    try {
      const share = artifact.share ?? (await actions.share.mutateAsync({ id: artifact.id }))

      await Clipboard.setStringAsync(share.url)
      setCopied(true)
    } catch (error) {
      setNotice(String((error as Error).message))
    }
  }

  const stopSharing = () => {
    if (!artifact) return

    setNotice(null)
    actions.unshare.mutate(artifact.id, { onError: error => setNotice(String((error as Error).message)) })
  }

  const confirmDelete = () => {
    if (!artifact) return

    Alert.alert('Delete this artifact?', `${artifact.name} is removed from the host. The agent's own copy, if it still has one, is untouched.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          actions.remove.mutate(artifact.id, {
            onSuccess: () => router.back(),
            onError: error => setNotice(String((error as Error).message))
          })
      }
    ])
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader title={artifact?.name ?? 'Artifact'} titleVariant="sub" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingTop: headerInset, paddingBottom: insets.bottom + 24 }]}>
        {artifact ? (
          <>
            <Preview artifact={artifact} />

            <Card>
              <MetaRow label="Kind" value={`${kindLabel(artifact.kind)} · ${artifact.mimeType}`} />
              <Divider />
              <MetaRow label="Size" value={formatBytes(artifact.size)} />
              <Divider />
              <MetaRow label="From" value={describeOrigin(artifact)} />
              {artifact.sourcePath ? (
                <>
                  <Divider />
                  <MetaRow label="Path" value={artifact.sourcePath} mono />
                </>
              ) : null}
              <Divider />
              <MetaRow
                label={artifact.version > 1 ? `Updated · v${artifact.version}` : 'Created'}
                value={`${relativeTime(artifact.updatedAt)} ago · ${clockTime(artifact.updatedAt)}`}
              />
              {artifact.sessionId ? (
                <>
                  <Divider />
                  <ActionRow icon="comments" label="Open the conversation" onPress={() => router.push(`/chat/${artifact.sessionId}` as never)} />
                </>
              ) : null}
            </Card>

            <View style={styles.group}>
              <Text variant="sectionHeader" style={styles.groupLabel}>
                Share
              </Text>
              <Card>
                <ActionRow
                  icon="arrow-up-from-bracket"
                  label="Share file…"
                  detail="AirDrop, Messages, Mail — the file itself, to anyone"
                  busy={busy === 'share-file'}
                  onPress={() => void shareFile()}
                />
                {backend?.capabilities.artifacts.share ? (
                  <>
                    <Divider />
                    <ActionRow
                      icon={copied ? 'check' : 'link'}
                      label={copied ? 'Copied' : artifact.share ? 'Copy link' : 'Share a link'}
                      detail={shareCaption(artifact.share, server.displayName)}
                      busy={actions.share.isPending}
                      onPress={() => void copyLink()}
                    />
                    {artifact.share ? (
                      <>
                        <Divider />
                        <ActionRow icon="link-slash" label="Stop sharing" busy={actions.unshare.isPending} onPress={stopSharing} />
                      </>
                    ) : null}
                  </>
                ) : null}
              </Card>
            </View>

            <Card>
              <ActionRow icon="trash" label="Delete from host" destructive busy={actions.remove.isPending} onPress={confirmDelete} />
            </Card>

            {notice ? (
              <Text variant="secondary" color={theme.color.error700} style={styles.notice}>
                {notice}
              </Text>
            ) : null}
          </>
        ) : query.error ? (
          <Card style={styles.messageCard}>
            <Text variant="rowLabelStrong">Could not load this artifact</Text>
            <Text variant="secondary">{String((query.error as Error).message)}</Text>
          </Card>
        ) : (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        )}
      </ScrollView>
    </View>
  )
}

/**
 * The top of the screen: the picture, the text, or a glyph for what cannot be
 * drawn. Fetched through the same on-disk cache the list's tiles use, so a
 * picture tapped from the grid is already here.
 */
function Preview({ artifact }: { artifact: Artifact }) {
  const theme = useTheme()
  const backend = useBackend()
  const { width } = useWindowDimensions()
  const file = useArtifactFile(backend, artifact)
  const [viewing, setViewing] = useState(false)
  const [text, setText] = useState<string | null>(null)

  const textLike = isTextLike(artifact)

  useEffect(() => {
    if (!textLike || !file.data) return

    let cancelled = false

    new File(file.data)
      .text()
      .then(content => {
        if (!cancelled) setText(content)
      })
      .catch(() => {
        if (!cancelled) setText(null)
      })

    return () => {
      cancelled = true
    }
  }, [textLike, file.data])

  const edge = width - 32

  if (artifact.kind === 'image') {
    return (
      <>
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open ${artifact.name}`}
          disabled={!file.data}
          onPress={() => setViewing(true)}
          style={[styles.picture, { width: edge, height: edge * 0.75, backgroundColor: theme.color.secondaryTint, borderColor: theme.color.border, borderRadius: theme.radius.card }]}
        >
          {file.data ? (
            <Image source={{ uri: file.data }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={artifact.name} />
          ) : file.error ? (
            <PreviewFallback icon="triangle-exclamation" label={String((file.error as Error).message)} />
          ) : (
            <ActivityIndicator color={theme.color.secondary} />
          )}
        </Pressable>

        {viewing && file.data ? <ImageViewer images={[{ name: artifact.name, uri: file.data }]} index={0} onClose={() => setViewing(false)} /> : null}
      </>
    )
  }

  if (textLike) {
    return (
      <Card style={styles.textCard}>
        {text !== null ? (
          <Text variant="mono" selectable>
            {text}
          </Text>
        ) : file.error ? (
          <Text variant="secondary" color={theme.color.error700}>
            {String((file.error as Error).message)}
          </Text>
        ) : (
          <ActivityIndicator color={theme.color.secondary} />
        )}
      </Card>
    )
  }

  return (
    <View style={[styles.glyphTile, { backgroundColor: theme.color.secondaryTint, borderColor: theme.color.border, borderRadius: theme.radius.card }]}>
      <PreviewFallback icon={ARTIFACT_GLYPH[artifact.kind]} label={`${kindLabel(artifact.kind)} · ${formatBytes(artifact.size)}`} />
    </View>
  )
}

function PreviewFallback({ icon, label }: { icon: string; label: string }) {
  const theme = useTheme()

  return (
    <View style={styles.fallback}>
      <Icon name={icon} size={28} color={theme.color.secondaryMuted} />
      <Text variant="secondary" style={styles.fallbackLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  )
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="secondary" style={styles.metaLabel}>
        {label}
      </Text>
      <Text variant={mono ? 'mono' : 'rowLabel'} style={styles.metaValue} selectable numberOfLines={mono ? 2 : 3}>
        {value}
      </Text>
    </View>
  )
}

function ActionRow({
  icon,
  label,
  detail,
  destructive = false,
  busy = false,
  onPress
}: {
  icon: string
  label: string
  detail?: string
  destructive?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const tint = destructive ? theme.color.error700 : theme.color.secondaryDeep

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.color.bgSubtle }]}
    >
      <View style={styles.actionIcon}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : <Icon name={icon} size={15} color={tint} />}
      </View>
      <View style={styles.actionBody}>
        <Text variant="rowLabelStrong" color={tint}>
          {label}
        </Text>
        {detail ? (
          <Text variant="secondary" numberOfLines={3}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  loading: { marginTop: 24 },
  group: { gap: 8 },
  groupLabel: { paddingHorizontal: 4 },
  picture: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  glyphTile: { height: 140, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  fallback: { alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  fallbackLabel: { textAlign: 'center' },
  textCard: { padding: 14, maxHeight: 360, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 13, paddingVertical: 11 },
  metaLabel: { width: 72 },
  metaValue: { flex: 1, minWidth: 0 },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  actionIcon: { width: 22, alignItems: 'center' },
  actionBody: { flex: 1, minWidth: 0, gap: 2 },
  messageCard: { padding: 14, gap: 4 },
  notice: { paddingHorizontal: 4 }
})

export default withAgent(ArtifactScreen)
