/**
 * This device's copy of the images it has sent.
 *
 * The host stores an attached image under its own filename and persists the
 * user's turn as `@image:<host path>` — and serves no endpoint to read those
 * bytes back. So on reopening a session, the transcript knows an image was sent
 * and its name, and has no way to get the picture. Every client that renders
 * one is rendering a copy it kept.
 *
 * Keyed by the *host's* filename rather than the picked asset's, because that
 * is the only name a reloaded transcript carries. Which means nothing can be
 * filed here until `prompt()` comes back and says what the agent called it.
 *
 * The filesystem is the index — a lookup is "does this path exist" — so there
 * is no map to keep in sync with the files it describes, and a copy that fails
 * to write is simply a lookup that misses.
 */

import { Directory, File, Paths } from 'expo-file-system'

const ROOT = 'attachments'

/**
 * Strip a name down to one path segment.
 *
 * The name arrives from the host, and a lookup builds a path out of it. Nothing
 * about the flow is adversarial today, but `../` in a filename resolving to a
 * write outside the cache is not a thing to leave to good manners.
 */
function safeName(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').replace(/^\.+/, '')

  return base.slice(0, 120) || 'image'
}

function sessionDirectory(sessionId: string): Directory {
  return new Directory(Paths.document, ROOT, safeName(sessionId))
}

/**
 * Keep a copy of a sent image under the name the agent filed it as.
 *
 * Best-effort by design: this runs after the prompt is already away, and a full
 * disk must cost a thumbnail, never the message.
 */
export function cacheSentImage(sessionId: string, hostName: string, sourceUri: string): string | null {
  try {
    const directory = sessionDirectory(sessionId)

    if (!directory.exists) directory.create({ intermediates: true, idempotent: true })

    const source = new File(sourceUri)
    const destination = new File(directory, safeName(hostName))

    if (destination.exists) return destination.uri

    source.copy(destination)

    return destination.uri
  } catch {
    return null
  }
}

/** The local copy of an image the host named `hostName`, if this device still has one. */
export function cachedImageUri(sessionId: string, hostName: string): string | undefined {
  try {
    const file = new File(sessionDirectory(sessionId), safeName(hostName))

    return file.exists ? file.uri : undefined
  } catch {
    return undefined
  }
}

// Nothing prunes this yet, deliberately: the app has no delete-session path to
// hang a cleanup off, and a size-capped evictor invented here would be a policy
// nobody asked for. The images are downscaled before they are ever sent, so the
// store grows by a few hundred KB per sent image. Worth revisiting alongside
// session deletion.
