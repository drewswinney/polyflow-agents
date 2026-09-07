import { useEffect, useState } from 'react'
import { Image, type LayoutChangeEvent, StyleSheet, View, type ViewStyle } from 'react-native'

import type { Artifact } from '@/domain'
import { useArtifactFile, useArtifactThumbnail } from '@/platform/artifact-cache'
import { useBackend } from '@/state/ConnectionProvider'

import { ARTIFACT_GLYPH, kindLabel } from '../artifacts'
import { useTheme } from '../ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

/** A page's proportions, for the placeholder before a page's real ones are known. */
const PAGE_RATIO = 816 / 1056

/**
 * How the preview fills space.
 *
 * `cover` is a fixed box the picture fills, for grid and row tiles where
 * every cell must be the same size. `natural` is the picture at its own
 * proportions — a portrait page stays a portrait page, a wide screenshot
 * stays wide — fitted inside a height and a maximum width, with nothing
 * drawn behind it. That is the one for a card and for the detail screen,
 * where a tinted box around a page reads as a frame the page is floating in.
 */
export type PreviewMode =
  | { mode: 'cover'; width: number; height: number }
  | { mode: 'natural'; height: number; maxWidth: number }

/**
 * What an artifact looks like, at any size.
 *
 * Three things it can draw, tried in order: the host's first-page thumbnail
 * (a PDF's first page, a rendered HTML file, a report drawn as a page, a
 * picture shrunk); the full picture, when the host had no thumbnail but the
 * file is an image; and a glyph with the kind's name, for everything a phone
 * cannot preview. The same component draws a 40px row tile, a grid tile and
 * the card in the chat, so an artifact looks like itself everywhere.
 */
export function ArtifactPreview({
  artifact,
  radius,
  style,
  onLayout,
  ...size
}: {
  artifact: Artifact
  radius?: number
  style?: ViewStyle
  /** The laid-out frame, so a caller can match a caption to the picture's width. */
  onLayout?: (event: LayoutChangeEvent) => void
} & PreviewMode) {
  const theme = useTheme()
  const backend = useBackend()
  const thumbnail = useArtifactThumbnail(backend, artifact)
  // Only asked for once the thumbnail has been refused, and only for a
  // picture: a full download for a tile is the thing the thumbnail exists to
  // avoid, and for a document it would be bytes nothing here can draw.
  const wantsFull = artifact.kind === 'image' && thumbnail.isError
  const full = useArtifactFile(wantsFull ? backend : null, artifact)

  const uri = thumbnail.data ?? (wantsFull ? full.data : undefined)
  const ratio = useImageRatio(size.mode === 'natural' ? uri : undefined)

  const frame = frameFor(size, artifact, ratio)
  const corner = radius ?? theme.radius.row
  const small = Math.min(frame.width, frame.height) < 64
  // A picture at its own proportions is the thing itself, so nothing is
  // painted behind it; a box that is waiting, or has only a glyph to show,
  // gets the tint.
  const bare = size.mode === 'natural' && Boolean(uri) && ratio !== null

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.box,
        {
          width: frame.width,
          height: frame.height,
          borderRadius: corner,
          backgroundColor: bare ? 'transparent' : theme.color.secondaryTint,
          borderColor: theme.color.border
        },
        style
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode={size.mode === 'cover' ? 'cover' : 'contain'}
          accessibilityLabel={artifact.name}
        />
      ) : (
        <View style={styles.fallback}>
          <Icon name={ARTIFACT_GLYPH[artifact.kind]} size={small ? 15 : 24} color={theme.color.secondary} />
          {small ? null : (
            <Text variant="pill" color={theme.color.secondaryDeep}>
              {kindLabel(artifact.kind)}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}

/**
 * The frame the picture is drawn in.
 *
 * In `natural` mode the height is the ask and the width follows the picture,
 * capped — a wide screenshot hits the cap and gives up height instead. Until
 * the picture's proportions are known, a page is assumed for a document and
 * a square for everything else, so the placeholder is close to what lands.
 */
function frameFor(size: PreviewMode, artifact: Artifact, ratio: number | null): { width: number; height: number } {
  if (size.mode === 'cover') return { width: size.width, height: size.height }

  const assumed = artifact.kind === 'image' ? 1 : PAGE_RATIO
  const aspect = ratio ?? assumed
  const width = Math.min(size.maxWidth, Math.round(size.height * aspect))

  return { width, height: Math.round(width / aspect) }
}

/** A picture's width over its height, once it has been measured. */
function useImageRatio(uri: string | undefined): number | null {
  const [ratio, setRatio] = useState<{ uri: string; value: number } | null>(null)

  useEffect(() => {
    if (!uri) return

    let cancelled = false

    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) setRatio({ uri, value: width / height })
      },
      () => {
        // Unreadable: the assumed proportions stand, and the image itself
        // will report its own failure by drawing nothing.
      }
    )

    return () => {
      cancelled = true
    }
  }, [uri])

  return ratio !== null && ratio.uri === uri ? ratio.value : null
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  fallback: { alignItems: 'center', gap: 6 }
})
