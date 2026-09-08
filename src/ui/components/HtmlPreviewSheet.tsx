import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import WebView from 'react-native-webview'

import type { AgentBackend, Artifact } from '@/domain'
import { useArtifactFile } from '@/platform/artifact-cache'
import { useTheme } from '../ThemeProvider'
import { Text } from './Text'
import { Sheet } from './Sheet'

/**
 * How much of the screen the preview occupies at rest; the header's drag up
 * is what takes it to the full screen.
 */
const REST_FRACTION = 0.5

/**
 * An HTML artifact, rendered as a page instead of shown as a file.
 *
 * A {@link Sheet} with `expandable` on: it arrives at half the screen so a
 * page that only needs a glance gets one, and the same surface becomes the
 * whole screen when the finger says it needs more. The WebView reads the
 * device's cached copy through `useArtifactFile` — the same download the
 * share sheet would use — so nothing here touches the host's bytes endpoint
 * directly.
 *
 * Rendered by whoever is showing artifacts (the Artifacts screen, a chat's
 * tile strip): it mounts only while open, like the image viewer.
 */
export function HtmlPreviewSheet({
  visible,
  backend,
  artifact,
  onClose
}: {
  visible: boolean
  backend: AgentBackend | null
  artifact: Artifact | null
  onClose: () => void
}) {
  const theme = useTheme()
  // Kept across closes: the query refetches nothing (the bytes for an id and
  // version never change), and the sheet's own exit animation still needs the
  // page under it.
  const [open, setOpen] = useState<Artifact | null>(null)

  if (visible && artifact) setOpen(artifact)

  const shown = open
  const file = useArtifactFile(backend, shown)

  return (
    <Sheet
      visible={visible && shown !== null}
      title={shown?.name ?? 'Preview'}
      restFraction={REST_FRACTION}
      expandable
      onDismiss={onClose}
      onClose={onClose}
    >
      <View style={styles.body}>
        {file.isLoading ? (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        ) : file.error || !file.data ? (
          <Text variant="secondary" color={theme.color.error700}>
            {`Could not load ${shown?.name ?? 'the page'}: ${file.error ? String((file.error as Error).message) : 'the file is missing.'}`}
          </Text>
        ) : (
          // The page is a cached file on this device — nothing is fetched, so
          // the webview's network access is irrelevant, and the whitelist and
          // incognito flags keep it that way: no cookies in, no session out.
          // JavaScript stays on because the artifact is agent-generated HTML
          // that may well be a small interactive report.
          <WebView
            source={{ uri: file.data }}
            originWhitelist={['*']}
            allowFileAccess
            javaScriptEnabled
            scrollEnabled
            contentInsetAdjustmentBehavior="automatic"
            style={styles.webview}
            sharedCookiesEnabled={false}
            incognito
          />
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  webview: { flex: 1 },
  loading: { marginTop: 40 }
})
