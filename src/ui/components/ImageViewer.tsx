import { useState } from 'react'
import { FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { MessageImage } from '@/domain'

import { Icon } from './Icon'
import { Text } from './Text'

/**
 * A photo viewer is black in both themes: the picture is the only thing that
 * should have a colour, and a light surround would tint how it reads. So these
 * are deliberately not theme tokens.
 */
const VIEWER_BG = '#000'
const VIEWER_INK = '#fff'
const VIEWER_INK_DIM = 'rgba(255,255,255,0.7)'

/**
 * A message's pictures, full screen, one per page.
 *
 * An RN `Modal` rather than a route: the viewer belongs to the message it was
 * opened from, and a route would need the pictures handed to it by id through
 * a store that has no other reason to hold them. It mounts only while open —
 * the caller renders it or does not — so a transcript of picture messages
 * carries no idle modals.
 *
 * Pinch to zoom is the `ScrollView`'s own, which is iOS only; Android pages
 * and shows, and that is the whole of it there.
 */
export function ImageViewer({
  images,
  index,
  onClose
}: {
  /** Only pictures this device can draw — the caller filters out name-only ones. */
  images: MessageImage[]
  index: number
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [current, setCurrent] = useState(index)

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: VIEWER_BG }]}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_data, position) => ({ length: width, offset: width * position, index: position })}
          keyExtractor={(image, position) => `${image.name}-${position}`}
          onMomentumScrollEnd={event => setCurrent(Math.round(event.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={styles.page}
              maximumZoomScale={3}
              minimumZoomScale={1}
              centerContent
              bouncesZoom
            >
              <Image source={{ uri: item.uri }} style={{ width, height }} resizeMode="contain" accessibilityLabel={item.name} />
            </ScrollView>
          )}
        />

        <View style={[styles.chrome, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12} style={styles.close}>
            <Icon name="xmark" size={18} color={VIEWER_INK} />
          </Pressable>

          {images.length > 1 ? (
            <Text variant="rowLabelStrong" color={VIEWER_INK}>
              {`${current + 1} / ${images.length}`}
            </Text>
          ) : null}

          {/* Balances the close button so the counter sits centred. */}
          <View style={styles.close} />
        </View>

        <View style={[styles.caption, { bottom: insets.bottom + 16 }]} pointerEvents="none">
          <Text variant="secondary" color={VIEWER_INK_DIM} numberOfLines={1}>
            {images[current]?.name ?? ''}
          </Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  chrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12
  },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  caption: { position: 'absolute', left: 24, right: 24, alignItems: 'center' }
})
