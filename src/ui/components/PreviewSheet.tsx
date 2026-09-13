import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { File } from 'expo-file-system'
import WebView from 'react-native-webview'

import type { AgentBackend, Artifact } from '@/domain'
import { useArtifactFile } from '@/platform/artifact-cache'
import { parseDelimited, previewNavigationDecision, type PreviewMode, previewMode } from '../artifacts'
import { Markdown } from '../markdown/Markdown'
import { useTheme } from '../ThemeProvider'
import { Text } from './Text'
import { Sheet } from './Sheet'

/**
 * How much of the screen the preview occupies at rest; the header's drag up
 * is what takes it to the full screen.
 */
const REST_FRACTION = 0.5

/** Rows of a table drawn before the rest is summarised in a footer. */
const MAX_TABLE_ROWS = 500

/** Column width bounds, so one long cell does not push the rest off screen. */
const MIN_COLUMN = 72
const MAX_COLUMN = 240
const CHARACTER_WIDTH = 8

/**
 * Whether this platform's WebView draws a PDF. WKWebView does; Android's has
 * no viewer, so a PDF there keeps the detail screen and its share button.
 */
export const PDF_IN_SHEET = Platform.OS === 'ios'

/** Whether tapping an artifact opens the sheet rather than the detail screen. */
export function opensInSheet(artifact: Pick<Artifact, 'name' | 'mimeType' | 'size'>): boolean {
  return previewMode(artifact, PDF_IN_SHEET) !== null
}

/**
 * An artifact rendered as the thing it is, instead of shown as a file: a page
 * or a PDF in a WebView, markdown as prose, a CSV as a table.
 *
 * A {@link Sheet} with `expandable` on: it arrives at half the screen so
 * something that only needs a glance gets one, and the same surface becomes
 * the whole screen when the finger says it needs more. Everything reads the
 * device's cached copy through `useArtifactFile` — the same download the
 * share sheet would use — so nothing here touches the host's bytes endpoint
 * directly.
 *
 * Rendered by whoever is showing artifacts (the Artifacts screen, a chat's
 * tile strip): it mounts only while open, like the image viewer. Callers ask
 * `opensInSheet` first; an artifact this cannot draw is theirs to route.
 *
 * The sheet shows the thing and nothing about it — no provenance, no share,
 * no delete — and for the types that open here that used to be the end of
 * the road. `onInfo` is the way through: an info button in the header,
 * handing the artifact back to the caller to take to its own screen. A
 * caller that *is* that screen leaves it out.
 */
export function PreviewSheet({
  visible,
  backend,
  artifact,
  onClose,
  onInfo,
  onRename
}: {
  visible: boolean
  backend: AgentBackend | null
  artifact: Artifact | null
  onClose: () => void
  /** Show everything about the artifact: the detail screen. */
  onInfo?: (artifact: Artifact) => void
  /** Given, the sheet's title is the artifact's and a long press on it renames. */
  onRename?: (artifact: Artifact, title: string) => void
}) {
  const theme = useTheme()
  // Kept across closes: the query refetches nothing (the bytes for an id and
  // version never change), and the sheet's own exit animation still needs the
  // content under it.
  const [open, setOpen] = useState<Artifact | null>(null)

  // A render-phase update must be conditional: React does not skip the
  // re-render for a same-value set issued during render, so an unguarded
  // call here loops until the re-render limit.
  if (visible && artifact && artifact !== open) setOpen(artifact)

  const shown = open
  const mode = shown ? previewMode(shown, PDF_IN_SHEET) : null
  const file = useArtifactFile(backend, shown)

  return (
    <Sheet
      visible={visible && shown !== null}
      title={shown?.title ?? 'Preview'}
      restFraction={REST_FRACTION}
      expandable
      onDismiss={onClose}
      onClose={onClose}
      {...(onRename && shown ? { onRename: (title: string) => onRename(shown, title) } : {})}
      {...(onInfo && shown ? { action: { icon: 'circle-info', label: `About ${shown.title}`, onPress: () => onInfo(shown) } } : {})}
    >
      <View style={styles.body}>
        {file.isLoading ? (
          <ActivityIndicator color={theme.color.secondary} style={styles.loading} />
        ) : file.error || !file.data || !mode ? (
          <Text variant="secondary" color={theme.color.error700} style={styles.message}>
            {`Could not load ${shown?.title ?? 'the file'}: ${file.error ? String((file.error as Error).message) : 'the file is missing.'}`}
          </Text>
        ) : mode === 'page' || mode === 'pdf' ? (
          // The page is a cached file on this device — nothing is fetched, so
          // the webview's network access is irrelevant, and the whitelist and
          // incognito flags keep it that way: no cookies in, no session out.
          // JavaScript stays on because the artifact is agent-generated HTML
          // that may well be a small interactive report.
          <WebView
            source={{ uri: file.data }}
            originWhitelist={['*']}
            allowFileAccess
            // iOS reads a file:// source only from a directory it was told
            // about; the cached copy's own folder is exactly that.
            allowingReadAccessToURL={new File(file.data).parentDirectory.uri}
            javaScriptEnabled
            scrollEnabled
            contentInsetAdjustmentBehavior="automatic"
            style={styles.webview}
            sharedCookiesEnabled={false}
            incognito
            // `target="_blank"` (and any popup) asks the webview for a new
            // window. There is none, so the URL goes to the system browser —
            // the same `Linking.openURL` path the chat markdown uses — and
            // the artifact stays loaded behind it.
            onOpenWindow={event => {
              const target = event.nativeEvent.targetUrl

              // `Linking.openURL` can only take web URLs: a `javascript:` or
              // `data:` link must be dropped, not handed to the OS.
              if (target && /^https?:/i.test(target)) void Linking.openURL(target).catch(() => undefined)
            }}
            // A link with no `target` would otherwise navigate this webview
            // in place, replacing the artifact with the linked page and
            // leaving no way back. Decline top-frame jumps to external
            // content and open them in the browser, so every external link
            // in the artifact behaves the same; the page itself, its
            // subresources and its #anchors keep loading.
            onShouldStartLoadWithRequest={request => {
              const shouldStart = previewNavigationDecision(request)

              // Only a web URL can be handed to the system browser; a
              // `javascript:` or `data:` jump is declined and dropped.
              if (!shouldStart && request.isTopFrame !== false && /^https?:/i.test(request.url)) {
                void Linking.openURL(request.url).catch(() => undefined)
              }

              return shouldStart
            }}
          />
        ) : (
          <TextBody uri={file.data} mode={mode} name={shown?.name ?? ''} />
        )}
      </View>
    </Sheet>
  )
}

/** Markdown or a table: the file's text, read once and laid out natively. */
function TextBody({ uri, mode, name }: { uri: string; mode: Exclude<PreviewMode, 'page' | 'pdf'>; name: string }) {
  const theme = useTheme()
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setText(null)
    setFailed(null)

    new File(uri)
      .text()
      .then(content => {
        if (!cancelled) setText(content)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [uri])

  if (failed !== null) {
    return (
      <Text variant="secondary" color={theme.color.error700} style={styles.message}>
        {`Could not read ${name}: ${failed}`}
      </Text>
    )
  }

  if (text === null) return <ActivityIndicator color={theme.color.secondary} style={styles.loading} />

  if (mode === 'markdown') {
    return (
      <ScrollView contentContainerStyle={styles.prose}>
        <Markdown source={text} />
      </ScrollView>
    )
  }

  return <Table text={text} delimiter={mode === 'tsv' ? '\t' : ','} />
}

/**
 * Delimited text as a grid: the first row as the header, columns sized to
 * their longest cell within bounds, scrolling both ways. Long tables stop at
 * `MAX_TABLE_ROWS` and say so, rather than laying out ten thousand rows for a
 * glance.
 */
function Table({ text, delimiter }: { text: string; delimiter: string }) {
  const theme = useTheme()
  const { header, rows, total, widths } = useMemo(() => {
    const parsed = parseDelimited(text, delimiter)
    const [head = [], ...rest] = parsed
    const shown = rest.slice(0, MAX_TABLE_ROWS)
    const columns = Math.max(head.length, ...shown.map(row => row.length))
    const widths = Array.from({ length: columns }, (_, column) => {
      const longest = Math.max(head[column]?.length ?? 0, ...shown.map(row => row[column]?.length ?? 0))

      return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, longest * CHARACTER_WIDTH + 24))
    })

    return { header: head, rows: shown, total: rest.length, widths }
  }, [text, delimiter])

  if (header.length === 0) {
    return (
      <Text variant="secondary" style={styles.message}>
        The file is empty.
      </Text>
    )
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <ScrollView contentContainerStyle={styles.grid}>
        <View style={[styles.row, styles.headerRow, { borderColor: theme.color.border }]}>
          {widths.map((width, column) => (
            <Text key={column} variant="rowLabelStrong" numberOfLines={1} style={[styles.cell, { width }]}>
              {header[column] ?? ''}
            </Text>
          ))}
        </View>

        {rows.map((row, index) => (
          <View key={index} style={[styles.row, { borderColor: theme.color.border }]}>
            {widths.map((width, column) => (
              <Text key={column} variant="body" numberOfLines={1} style={[styles.cell, { width }]}>
                {row[column] ?? ''}
              </Text>
            ))}
          </View>
        ))}

        {total > rows.length ? (
          <Text variant="secondary" style={styles.footer}>
            {`Showing the first ${rows.length} of ${total} rows.`}
          </Text>
        ) : null}
      </ScrollView>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  webview: { flex: 1 },
  loading: { marginTop: 40 },
  message: { paddingHorizontal: 16, paddingTop: 8 },
  prose: { paddingHorizontal: 16, paddingBottom: 24 },
  grid: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { borderBottomWidth: 1 },
  cell: { paddingVertical: 8, paddingRight: 12 },
  footer: { paddingTop: 12 }
})
