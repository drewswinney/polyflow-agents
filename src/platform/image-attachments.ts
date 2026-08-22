/**
 * Picking an image off the phone and getting it into a shape the host accepts.
 *
 * Two constraints shape everything here, and neither is negotiable:
 *
 * 1. **The gateway takes six extensions** — `.png .jpg .jpeg .gif .webp .bmp`
 *    (`_allowed_image_extensions`). An iPhone's library hands back HEIC, which
 *    is not one of them, so a picked asset is never uploaded as-picked: every
 *    image is re-encoded through the manipulator to a format we chose.
 * 2. **The pixels beyond 1568px on the long edge buy nothing.** Anthropic's
 *    vision pipeline downsamples to that anyway, so shipping a 12MP photo over
 *    cellular pays for bandwidth the model then throws away.
 *
 * Downscaling is therefore not an optimisation applied to large images — it is
 * the single path every image takes, which is also what makes the format
 * guarantee hold.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

/** Anthropic's vision pipeline downsamples past this; sending more is waste. */
const MAX_EDGE = 1568

/**
 * JPEG quality for re-encoded photos.
 *
 * High enough that screenshot text stays crisp — the agent is often being asked
 * to *read* one — and still a fraction of the original bytes.
 */
const JPEG_QUALITY = 0.85

/** Belt and braces under the gateway's own 25 MB cap on `image.attach_bytes`. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export interface PickedImage {
  /** Local file URI of the re-encoded copy, not of the original asset. */
  uri: string
  /** Filename with an extension the host accepts. */
  name: string
  mimeType: string
  width: number
  height: number
}

export type PickSource = 'library' | 'camera'

/** Thrown when the user declined the OS prompt, so callers can say which one. */
export class PermissionDenied extends Error {
  constructor(readonly source: PickSource) {
    super(
      source === 'camera'
        ? 'Camera access is off for this app. Turn it on in Settings to take a photo.'
        : 'Photo access is off for this app. Turn it on in Settings to attach an image.'
    )
    this.name = 'PermissionDenied'
  }
}

/**
 * Open the picker and return re-encoded, downscaled copies.
 *
 * Resolves empty when the user backs out — cancelling is not an error, and the
 * composer should say nothing about it.
 */
export async function pickImages(source: PickSource, limit = 6): Promise<PickedImage[]> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()

  if (!permission.granted) throw new PermissionDenied(source)

  // `quality: 1` on purpose: the manipulator below does the compressing, and
  // compressing twice would soften the image for no saving.
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: limit,
          quality: 1
        })

  if (result.canceled) return []

  const prepared: PickedImage[] = []

  for (const asset of result.assets) {
    prepared.push(await prepare(asset))
  }

  return prepared
}

/**
 * Re-encode one asset to an accepted format, downscaled to fit `MAX_EDGE`.
 *
 * PNG sources stay PNG: a screenshot is the common one, its flat colour costs
 * little losslessly, and JPEG would both ring the text and drop any alpha to
 * black. Everything else — HEIC included, which is the whole reason this
 * function is not conditional — becomes JPEG.
 */
async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  const png = (asset.mimeType ?? '').toLowerCase() === 'image/png'
  const context = ImageManipulator.manipulate(asset.uri)
  const longEdge = Math.max(asset.width, asset.height)

  if (longEdge > MAX_EDGE) {
    // Resize by the long edge only; the other is derived, preserving the ratio.
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
  }

  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({
    format: png ? SaveFormat.PNG : SaveFormat.JPEG,
    compress: png ? 1 : JPEG_QUALITY
  })

  return {
    uri: saved.uri,
    name: filenameFor(asset.fileName, png),
    mimeType: png ? 'image/png' : 'image/jpeg',
    width: saved.width,
    height: saved.height
  }
}

/**
 * A filename whose extension matches what we actually encoded.
 *
 * The host sniffs magic bytes first and only falls back to this hint, but a
 * `.heic` name on JPEG bytes would still be the wrong label on the row the
 * agent sees, and `_sniff_image_ext` trusts a filename suffix over the bytes
 * when one is present — so a stale extension is the one input that can get an
 * upload rejected.
 */
function filenameFor(original: string | null | undefined, png: boolean): string {
  const extension = png ? '.png' : '.jpg'
  const base = (original ?? '').replace(/\.[^./\\]*$/, '').replace(/[/\\]/g, '_').trim()

  return `${base || 'image'}${extension}`
}
