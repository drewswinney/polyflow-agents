import * as Clipboard from 'expo-clipboard'
import { File } from 'expo-file-system'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Artifact, ArtifactVersion } from '@/domain'
import { ensureArtifactFile, useArtifactFile } from '@/platform/artifact-cache'
import { useBackend } from '@/state/ConnectionProvider'
import { useAgentScopedRoute } from '@/state/agent-scope'
import { useSelectedAgent, useSelectedServer } from '@/state/agents'
import { useArtifact, useArtifactActions, useArtifactVersions } from '@/state/artifacts'
import { withAgent } from '@/ui/components/AgentGate'
import { ArtifactPreview } from '@/ui/components/ArtifactPreview'
import { Card, Divider } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { ImageViewer } from '@/ui/components/ImageViewer'
import { PDF_IN_SHEET, PreviewSheet } from '@/ui/components/PreviewSheet'
import { ScreenHeader, useHeaderInset } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { describeOrigin, formatBytes, isTextLike, kindLabel, previewLabel, previewMode, shareCaption } from '@/ui/artifacts'
import { clockTime, relativeTime } from '@/ui/format'
import { useTheme } from '@/ui/ThemeProvider'

/** How long "Copied" stays on the button before it reads "Copy link" again. */
const COPIED_FOR_MS = 1_800

/**
 * `expo-sharing`, loaded when the button is pressed rather than when the
 * screen's module is.
 *
 * It is the one native module this feature added, and an Expo module resolves
 * its native half at *import* time — so a static import here made every build
 * that predates it fail to boot at all, with the error pointing at this file.
 * That is not a theoretical build: the app ships JS over the air onto native
 * builds keyed by app version, and a phone on the old native would have
 * opened to a red screen. Loaded here, a stale build still opens, still shows
 * artifacts, and says "needs a newer build" on the one button that does.
 */
async function loadSharing(): Promise<typeof import('expo-sharing') | null> {
  try {
    return await import('expo-sharing')
  } catch {
    return null
  }
}

/**
 * One artifact (`docs/artifacts.md` §6): preview, provenance, and the four
 * things you can do with it — open the conversation it came from, hand the
 * file to another app, share or stop sharing a link, delete it. For a type
 * the preview sheet renders, a row (and the preview itself) opens the sheet,
 * so the screen the sheet's info button leads to also leads back.
 *
 * With `?v=`, the same screen shows one of the artifact's *earlier* versions
 * (§4.2): the file as it was, its own size and dates, and "Share file" for
 * those bytes — but no link, no delete and no version list, since those are
 * the artifact's, not the draft's. Without it, the current version, with the
 * earlier ones listed below when the host kept any.
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
  const { id, v } = useLocalSearchParams<{ id: string; v?: string }>()
  const scope = agent.scope ?? ''

  const stale = useAgentScopedRoute()
  const query = useArtifact(scope, stale ? null : backend, id ?? '')
  const artifact = query.data ?? null
  const actions = useArtifactActions(scope, backend)

  // `?v=` naming the current version is the artifact itself, so the URL a
  // list row was opened by and the plain one show the same screen.
  const wanted = v && Number.isInteger(Number(v)) && Number(v) !== artifact?.version ? Number(v) : null
  const versions = useArtifactVersions(scope, stale ? null : backend, id ?? '', wanted !== null || (artifact?.version ?? 1) > 1)
  const kept: ArtifactVersion | null = wanted === null ? null : (versions.data?.find(row => row.version === wanted) ?? null)
  /** What the screen is about: the artifact, or one of its kept versions. */
  const shown: Artifact | null = wanted === null ? artifact : kept

  const [busy, setBusy] = useState<'share-file' | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const mode = shown ? previewMode(shown, PDF_IN_SHEET) : null

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)

    return () => clearTimeout(timer)
  }, [copied])

  const shareFile = async () => {
    if (!backend || !shown) return

    setBusy('share-file')
    setNotice(null)

    try {
      const uri = await ensureArtifactFile(shown, () => backend.readArtifact(shown.id, shown.version))
      const Sharing = await loadSharing()

      if (!Sharing) {
        setNotice('Sharing a file needs a newer build of the app. The file is downloaded and the rest of this screen works.')

        return
      }

      if (!(await Sharing.isAvailableAsync())) {
        setNotice('Sharing is not available on this device.')

        return
      }

      await Sharing.shareAsync(uri, { mimeType: shown.mimeType, dialogTitle: shown.name })
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
      <ScreenHeader title={shown?.name ?? artifact?.name ?? 'Artifact'} titleVariant="sub" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingTop: headerInset, paddingBottom: insets.bottom + 24 }]}>
        {shown && artifact ? (
          <>
            {kept ? (
              <Card style={styles.messageCard}>
                <Text variant="rowLabelStrong">{`Version ${kept.version} of ${artifact.version}`}</Text>
                <Text variant="secondary">{`Replaced ${relativeTime(kept.archivedAt)} ago. The current version is what the link and the conversation point at.`}</Text>
              </Card>
            ) : null}

            <Preview artifact={shown} onOpen={mode ? () => setPreviewing(true) : undefined} />

            <Card>
              {mode ? (
                <>
                  <ActionRow icon="eye" label={previewLabel(mode)} onPress={() => setPreviewing(true)} />
                  <Divider />
                </>
              ) : null}
              <MetaRow label="Kind" value={`${kindLabel(shown.kind)} · ${shown.mimeType}`} />
              <Divider />
              <MetaRow label="Size" value={formatBytes(shown.size)} />
              <Divider />
              <MetaRow label="From" value={describeOrigin(shown)} />
              {shown.sourcePath ? (
                <>
                  <Divider />
                  <MetaRow label="Path" value={shown.sourcePath} mono />
                </>
              ) : null}
              <Divider />
              {kept ? (
                <>
                  <MetaRow label={`Written · v${kept.version}`} value={`${relativeTime(kept.updatedAt)} ago · ${clockTime(kept.updatedAt)}`} />
                  <Divider />
                  <MetaRow label="Replaced" value={`${relativeTime(kept.archivedAt)} ago · ${clockTime(kept.archivedAt)}`} />
                </>
              ) : (
                <MetaRow
                  label={artifact.version > 1 ? `Updated · v${artifact.version}` : 'Created'}
                  value={`${relativeTime(artifact.updatedAt)} ago · ${clockTime(artifact.updatedAt)}`}
                />
              )}
              {kept ? (
                <>
                  <Divider />
                  <ActionRow icon="file" label="Show the current version" onPress={() => router.navigate(`/artifacts/${artifact.id}` as never)} />
                </>
              ) : null}
              {artifact.sessionId ? (
                <>
                  <Divider />
                  <ActionRow icon="comments" label="Open the conversation" onPress={() => router.push(`/chat/${artifact.sessionId}` as never)} />
                </>
              ) : null}
            </Card>

            {!kept ? <Versions artifact={artifact} versions={versions.data ?? null} error={versions.error ? String((versions.error as Error).message) : null} /> : null}

            <View style={styles.group}>
              <Text variant="sectionHeader" style={styles.groupLabel}>
                Share
              </Text>
              <Card>
                <ActionRow
                  icon="arrow-up-from-bracket"
                  label="Share file…"
                  detail={kept ? 'AirDrop, Messages, Mail — this version of the file, to anyone' : 'AirDrop, Messages, Mail — the file itself, to anyone'}
                  busy={busy === 'share-file'}
                  onPress={() => void shareFile()}
                />
                {!kept && backend?.capabilities.artifacts.share ? (
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

            {!kept ? (
              <Card>
                <ActionRow icon="trash" label="Delete from host" destructive busy={actions.remove.isPending} onPress={confirmDelete} />
              </Card>
            ) : null}

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
        ) : artifact && wanted !== null && (versions.error || versions.data) ? (
          <>
            <Card style={styles.messageCard}>
              <Text variant="rowLabelStrong">{`Version ${wanted} is not available`}</Text>
              <Text variant="secondary">
                {versions.error
                  ? String((versions.error as Error).message)
                  : 'The host did not keep this version: it was written before versions were kept, or enough rewrites have passed since that it was let go.'}
              </Text>
            </Card>
            <Card>
              <ActionRow icon="file" label="Show the current version" onPress={() => router.navigate(`/artifacts/${artifact.id}` as never)} />
            </Card>
          </>
        ) : (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        )}
      </ScrollView>

      <PreviewSheet visible={previewing} backend={backend} artifact={shown} onClose={() => setPreviewing(false)} />
    </View>
  )
}

/**
 * The versions a rewrite replaced, newest first, each a row to the same
 * screen at `?v=`. Nothing at all when there are none — an artifact never
 * rewritten, or one whose rewrites the host did not keep — since a heading
 * over an empty card would only raise the question.
 */
function Versions({ artifact, versions, error }: { artifact: Artifact; versions: ArtifactVersion[] | null; error: string | null }) {
  const theme = useTheme()

  if (!error && !versions?.length) return null

  return (
    <View style={styles.group}>
      <Text variant="sectionHeader" style={styles.groupLabel}>
        Earlier versions
      </Text>
      {error ? (
        <Text variant="secondary" color={theme.color.error700} style={styles.notice}>
          {`Could not list earlier versions: ${error}`}
        </Text>
      ) : (
        <Card>
          {versions!.map((kept, index) => (
            <View key={kept.version}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Version ${kept.version} of ${artifact.name}`}
                onPress={() => router.push(`/artifacts/${artifact.id}?v=${kept.version}` as never)}
                style={({ pressed }) => [styles.versionRow, pressed && { backgroundColor: theme.color.bgSubtle }]}
              >
                <ArtifactPreview artifact={kept} mode="cover" width={40} height={40} radius={8} />
                <View style={styles.versionBody}>
                  <View style={styles.versionTitle}>
                    <Text variant="rowLabelStrong" numberOfLines={1} style={styles.versionName}>
                      {`Version ${kept.version}`}
                    </Text>
                    <Text variant="monoSmall">{relativeTime(kept.updatedAt)}</Text>
                  </View>
                  <Text variant="secondary" numberOfLines={1}>
                    {`${formatBytes(kept.size)}${kept.name !== artifact.name ? ` · ${kept.name}` : ''} · replaced ${relativeTime(kept.archivedAt)} ago`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={11} color={theme.color.secondaryMuted} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </View>
  )
}

/**
 * The top of the screen: the picture, the text, or a glyph for what cannot be
 * drawn. Fetched through the same on-disk cache the list's tiles use, so a
 * picture tapped from the grid is already here. Given `onOpen`, the page is
 * a button to the preview sheet — the thing as itself — the way the picture
 * is a button to the image viewer. Inline text stays selectable instead; the
 * row under it is its way to the sheet.
 */
function Preview({ artifact, onOpen }: { artifact: Artifact; onOpen?: () => void }) {
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

  // A PDF, a Word file, a rendered HTML page: the host's first-page render,
  // shown whole. `ArtifactPreview` falls back to the kind's glyph on its own
  // when the host could not render this one.
  return (
    <Pressable
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={onOpen ? `Open ${artifact.name}` : undefined}
      disabled={!onOpen}
      onPress={onOpen}
      style={({ pressed }) => [styles.pageWrap, { opacity: pressed ? 0.8 : 1 }]}
    >
      <ArtifactPreview artifact={artifact} mode="natural" height={Math.round(edge * 0.95)} maxWidth={edge} radius={theme.radius.card} />
    </Pressable>
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
  pageWrap: { alignItems: 'center' },
  fallback: { alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  fallbackLabel: { textAlign: 'center' },
  textCard: { padding: 14, maxHeight: 360, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 13, paddingVertical: 11 },
  metaLabel: { width: 72 },
  metaValue: { flex: 1, minWidth: 0 },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  actionIcon: { width: 22, alignItems: 'center' },
  actionBody: { flex: 1, minWidth: 0, gap: 2 },
  versionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  versionBody: { flex: 1, minWidth: 0, gap: 3 },
  versionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionName: { flex: 1, minWidth: 0 },
  messageCard: { padding: 14, gap: 4 },
  notice: { paddingHorizontal: 4 }
})

export default withAgent(ArtifactScreen)
