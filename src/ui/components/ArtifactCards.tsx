import { router } from 'expo-router'
import { memo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import type { Artifact } from '@/domain'
import { useBackend } from '@/state/ConnectionProvider'
import { opensInSheet, PreviewSheet } from './PreviewSheet'

import { useTheme } from '../ThemeProvider'
import { ArtifactPreview } from './ArtifactPreview'
import { Icon } from './Icon'
import { Text } from './Text'

/** How tall a tile's picture is; its width follows the picture's own shape. */
export const PREVIEW_HEIGHT = 168
/** The widest a picture may go before it gives up height instead. */
const PREVIEW_MAX_WIDTH = 260

/**
 * What a stretch of working-out produced, in the transcript (`docs/artifacts.md` §6).
 *
 * A tile per artifact, and nothing more than the tile: the host's rendering
 * of the thing (`ArtifactPreview`) at its own proportions, its filename, and
 * "Open". The card is meant to be *seen* — a page that looks like the
 * report, a picture that is the picture — so the metadata a list row would
 * carry stays on the detail screen it opens. Several artifacts from one
 * stretch of work sit side by side in a strip you scroll sideways.
 *
 * HTML artifacts open as a rendered page in a sheet that starts at half the
 * screen and takes it all when dragged up; everything else keeps the detail
 * screen. The sheet is held here, the way the entry holds its image viewer,
 * so the chat screen never hears about it.
 *
 * Memoised like every other transcript row: nothing here changes while text
 * streams below it.
 */
export const ArtifactCards = memo(function ArtifactCards({ artifacts }: { artifacts: Artifact[] }) {
  const backend = useBackend()
  const [preview, setPreview] = useState<Artifact | null>(null)

  const open = (artifact: Artifact) => {
    if (opensInSheet(artifact)) setPreview(artifact)
    // Cast like the Artifacts screen: the generated route table lags a new screen.
    else router.push(`/artifacts/${artifact.id}` as never)
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {artifacts.map(artifact => (
          <Tile key={artifact.id} artifact={artifact} onOpen={() => open(artifact)} />
        ))}
      </ScrollView>

      <PreviewSheet visible={preview !== null} backend={backend} artifact={preview} onClose={() => setPreview(null)} />
    </>
  )
})

function Tile({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const theme = useTheme()
  // The caption is as wide as the picture and no wider, so a narrow portrait
  // page does not trail a filename twice its width.
  const [width, setWidth] = useState<number | undefined>(undefined)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${artifact.name}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.8 : 1 }]}
    >
      <ArtifactPreview
        artifact={artifact}
        mode="natural"
        height={PREVIEW_HEIGHT}
        maxWidth={PREVIEW_MAX_WIDTH}
        radius={theme.radius.control}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      />

      <View style={{ width }}>
        <Text variant="rowLabel" numberOfLines={1} style={styles.name}>
          {artifact.name}
        </Text>

        <View style={styles.open}>
          <Text variant="pill" color={theme.color.secondaryDeep}>
            Open
          </Text>
          <Icon name="chevron-right" size={9} color={theme.color.secondaryDeep} />
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 6, paddingRight: 8 },
  tile: { gap: 4, alignItems: 'flex-start' },
  name: { paddingTop: 2 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 3 }
})
