/**
 * The recents row's contract with the media library.
 *
 * Pinned here because each rule guards a real failure: asking again after a
 * refusal nags on every open of the sheet; a `ph://` URI is a tile that draws
 * nothing; and resolving an iCloud-only photo for a tile would start a
 * download for a thumbnail nobody tapped. And on Android, asking for an
 * asset's info reads EXIF, which needs a location permission the app does not
 * hold — so attaching there must go straight from the asset's own URI.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const library = {
  getPermissionsAsync: jest.fn<() => Promise<unknown>>(),
  requestPermissionsAsync: jest.fn<() => Promise<unknown>>(),
  getAssetsAsync: jest.fn<() => Promise<unknown>>(),
  getAssetInfoAsync: jest.fn<(asset: unknown, options?: unknown) => Promise<unknown>>()
}
const prepareImage = jest.fn<(source: unknown) => Promise<unknown>>()
const platform = { OS: 'ios' }

jest.mock('expo-media-library', () => library)
jest.mock('react-native', () => ({ Platform: platform }))
jest.mock('@/platform/image-attachments', () => ({ prepareImage }))

// eslint-disable-next-line import/first
import { attachRecentPhoto, recentPhotos } from '@/platform/recent-photos'

const asset = (id: string, filename = `${id}.heic`) => ({
  id,
  uri: `ph://${id}`,
  filename,
  width: 4000,
  height: 3000
})

beforeEach(() => {
  jest.resetAllMocks()
  platform.OS = 'ios'
  library.getAssetsAsync.mockResolvedValue({ assets: [] })
})

describe('recentPhotos', () => {
  it('asks once while asking can still be answered', async () => {
    library.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true })
    library.requestPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges: 'all' })

    const result = await recentPhotos()

    expect(library.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(result.access).toBe('granted')
  })

  it('does not ask again after a refusal', async () => {
    library.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false })

    const result = await recentPhotos()

    expect(library.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(result).toEqual({ access: 'denied', photos: [] })
  })

  it('reports limited access as limited, not denied', async () => {
    library.getPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges: 'limited' })

    expect((await recentPhotos()).access).toBe('limited')
  })

  it('renders iOS tiles from the local file and skips photos that would download', async () => {
    library.getPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges: 'all' })
    library.getAssetsAsync.mockResolvedValue({ assets: [asset('a'), asset('b')] })
    library.getAssetInfoAsync.mockImplementation(async input => {
      const { id } = input as { id: string }

      return id === 'a' ? { localUri: 'file:///a.heic' } : { localUri: undefined }
    })

    const result = await recentPhotos(2)

    expect(library.getAssetInfoAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { shouldDownloadFromNetwork: false })
    expect(result.photos).toEqual([{ id: 'a', uri: 'file:///a.heic', width: 4000, height: 3000, filename: 'a.heic' }])
  })

  it('uses the asset URI as-is elsewhere', async () => {
    platform.OS = 'android'
    library.getPermissionsAsync.mockResolvedValue({ granted: true })
    library.getAssetsAsync.mockResolvedValue({ assets: [{ ...asset('a'), uri: 'content://a' }] })

    const result = await recentPhotos()

    expect(library.getAssetInfoAsync).not.toHaveBeenCalled()
    expect(result.photos[0]?.uri).toBe('content://a')
  })
})

describe('attachRecentPhoto', () => {
  it('re-resolves the asset on iOS, allowing a download, and keeps a PNG lossless', async () => {
    library.getAssetInfoAsync.mockResolvedValue({ localUri: 'file:///shot.png' })
    prepareImage.mockResolvedValue({ uri: 'file:///out.png' })

    const photo = { id: 'p', uri: 'file:///tile.png', width: 10, height: 20, filename: 'shot.png' }

    await attachRecentPhoto(photo)

    expect(library.getAssetInfoAsync).toHaveBeenCalledWith('p')
    expect(prepareImage).toHaveBeenCalledWith({
      uri: 'file:///shot.png',
      width: 10,
      height: 20,
      fileName: 'shot.png',
      mimeType: 'image/png'
    })
  })

  it('lets everything that is not a PNG become JPEG', async () => {
    library.getAssetInfoAsync.mockResolvedValue({})
    prepareImage.mockResolvedValue({})

    await attachRecentPhoto({ id: 'p', uri: 'file:///tile.heic', width: 1, height: 1, filename: 'IMG_1.HEIC' })

    expect(prepareImage).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///tile.heic', mimeType: null }))
  })

  it('does not ask Android for asset info, which would need a location permission', async () => {
    platform.OS = 'android'
    prepareImage.mockResolvedValue({})

    await attachRecentPhoto({ id: 'p', uri: 'file:///DCIM/IMG_1.jpg', width: 1, height: 1, filename: 'IMG_1.jpg' })

    expect(library.getAssetInfoAsync).not.toHaveBeenCalled()
    expect(prepareImage).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///DCIM/IMG_1.jpg' }))
  })
})
