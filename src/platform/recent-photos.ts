/**
 * The library's newest photos, for the row at the top of "Add to chat".
 *
 * The image picker can only *present* the library; listing it is the media
 * library's job, which is the one reason that module is here. Everything a
 * tapped photo then goes through — re-encoding, downscaling, the accepted
 * extensions — is `image-attachments`, not a second copy of it.
 *
 * Two platform facts shape the shape of `RecentPhoto`:
 *
 * - **iOS hands back `ph://` URIs**, which React Native's `Image` cannot load
 *   without the camera-roll package. The asset's `localUri` is a plain file,
 *   so that is what a tile renders. RN decodes a local file down to the view
 *   it is drawn in, so a full-resolution source behind a 72px tile is cheap.
 * - **A photo may live only in iCloud.** Resolving it for a tile must not
 *   trigger a download, so those are left out of the row; resolving it to
 *   attach may, and does.
 *
 * "Limited" access on iOS is not treated as a failure: the subset the person
 * chose to expose is exactly the set of recents worth showing.
 */

import * as MediaLibrary from 'expo-media-library'
import { Platform } from 'react-native'

import { type PickedImage, prepareImage } from './image-attachments'

/** How many photos the row shows. A screen's worth, scrolled. */
const DEFAULT_LIMIT = 12

export interface RecentPhoto {
  id: string
  /** Something `Image` can render: a file or content URI, never `ph://`. */
  uri: string
  width: number
  height: number
  filename: string | null
}

export type RecentPhotosAccess = 'granted' | 'limited' | 'denied'

export interface RecentPhotos {
  access: RecentPhotosAccess
  photos: RecentPhoto[]
}

/**
 * The newest photos, asking for access on first use.
 *
 * Asks only while asking can still get an answer: a person who has already
 * declined is not asked again on every open of the sheet, and the row says
 * where to change that instead.
 */
export async function recentPhotos(limit = DEFAULT_LIMIT): Promise<RecentPhotos> {
  let permission = await MediaLibrary.getPermissionsAsync(false, ['photo'])

  if (!permission.granted && permission.canAskAgain) {
    permission = await MediaLibrary.requestPermissionsAsync(false, ['photo'])
  }

  if (!permission.granted) return { access: 'denied', photos: [] }

  const page = await MediaLibrary.getAssetsAsync({
    first: limit,
    mediaType: ['photo'],
    sortBy: [['creationTime', false]]
  })

  const photos = await Promise.all(page.assets.map(renderable))

  return {
    access: permission.accessPrivileges === 'limited' ? 'limited' : 'granted',
    photos: photos.filter((photo): photo is RecentPhoto => photo !== null)
  }
}

/** An asset as a tile can draw it, or null when that would mean a download. */
async function renderable(asset: MediaLibrary.Asset): Promise<RecentPhoto | null> {
  let uri: string | null = asset.uri

  if (Platform.OS === 'ios') {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false })

    uri = info.localUri ?? null
  }

  if (!uri) return null

  return { id: asset.id, uri, width: asset.width, height: asset.height, filename: asset.filename || null }
}

/**
 * A tapped recent, re-encoded exactly as a picked one would be.
 *
 * On iOS the asset is resolved again rather than taken from the tile's URI:
 * this time a download is fine, and the tile's file may have been a cached
 * rendition. Android is *not* asked again — the asset's URI is already the
 * file, and the info call there reads EXIF, which the OS refuses without
 * `ACCESS_MEDIA_LOCATION`. That is a location permission, for a photo's GPS
 * tag the agent has no use for, and this app does not request it.
 */
export async function attachRecentPhoto(photo: RecentPhoto): Promise<PickedImage> {
  const localUri = Platform.OS === 'ios' ? (await MediaLibrary.getAssetInfoAsync(photo.id)).localUri : undefined

  return prepareImage({
    uri: localUri ?? photo.uri,
    width: photo.width,
    height: photo.height,
    fileName: photo.filename,
    // The library reports no MIME type; the name is the only hint that a
    // source is a PNG worth keeping lossless. Anything else becomes JPEG.
    mimeType: /\.png$/i.test(photo.filename ?? '') ? 'image/png' : null
  })
}
