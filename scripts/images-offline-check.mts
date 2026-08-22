/**
 * Image attachments, minus the host.
 *
 * Sending a picture is two RPCs that have to happen in one order, and the whole
 * feature is that order: `image.attach_bytes` queues a file *on the session*,
 * and the next `prompt.submit` consumes the queue and clears it. A submit that
 * overtakes an attach therefore does not fail — it sends the text alone and
 * leaves the image loaded, to be picked up by whatever the user types next. No
 * type can catch that, and on a device it looks like "the agent ignored my
 * photo, then answered a question about it two messages later".
 *
 * So this drives the real `HermesBackend.prompt()` against a recording gateway
 * and asserts the frames it emits. The gateway *client* is already proven by
 * `check:m0` against a fake socket; what is unproven here is the sequence built
 * on top of it.
 *
 *   npm run check:images
 */

import assert from 'node:assert/strict'

import { HermesBackend } from '../src/backends/hermes/index.ts'
import { splitImageRefs, toTranscriptEntries } from '../src/backends/hermes/normalize.ts'

// --- A gateway that records instead of dialling -----------------------------

interface Frame {
  method: string
  params: Record<string, unknown>
  /** Tick this frame went out on. */
  sentAt: number
  /** Tick the host's reply landed on; absent while still in flight. */
  settledAt?: number
}

/**
 * A gateway that answers on a later tick, and remembers when.
 *
 * The delay is the point. A host answers over a socket, so an unawaited attach
 * is still *sent* before the submit that follows it and a check comparing send
 * order alone would call that correct — while on a real device the submit
 * arrives first and the image misses its turn. Recording when each reply landed
 * is what lets the assertion say "the attach had finished", not merely "the
 * attach had been written".
 */
class RecordingGateway {
  readonly frames: Frame[] = []
  /** Queued replies, by method, so a check can say what the host answers. */
  readonly replies = new Map<string, unknown[]>()

  private clock = 0

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const frame: Frame = { method, params, sentAt: ++this.clock }

    this.frames.push(frame)

    const queued = this.replies.get(method)
    const result = queued?.length ? queued.shift() : {}

    return new Promise(resolve =>
      setTimeout(() => {
        frame.settledAt = ++this.clock
        resolve(result)
      }, 0)
    )
  }

  answer(method: string, ...results: unknown[]): void {
    this.replies.set(method, [...(this.replies.get(method) ?? []), ...results])
  }
}

/** Assert every attach had been answered before the turn that consumes them. */
function assertAttachesSettledBeforeSubmit(gateway: RecordingGateway): void {
  const submit = gateway.frames.find(frame => frame.method === 'prompt.submit')

  assert.ok(submit, 'expected a turn to have been submitted')

  for (const attach of gateway.frames.filter(frame => frame.method === 'image.attach_bytes')) {
    assert.ok(
      attach.settledAt !== undefined && attach.settledAt < submit.sentAt,
      'the host must have answered the attach before the submit goes out — a submit that ' +
        'overtakes one sends the text alone and leaves the image for the next turn to swallow'
    )
  }
}

/**
 * A backend wired to a recording gateway, with the session already resumed.
 *
 * Seeding the id map is not a shortcut around `session.resume` — it is the
 * state a real client is in by the time anyone can press send, since the chat
 * screen resumes on load. Leaving it unseeded would test the resume path
 * instead of the one under test.
 */
function backendFor(gateway: RecordingGateway, stored = 'ses-stored', runtime = 'rt-9') {
  const backend = new HermesBackend({
    host: '127.0.0.1:9119',
    authMode: 'token',
    token: 'test'
  } as never)
  const internals = backend as unknown as {
    gateway: RecordingGateway
    runtimeByStored: Map<string, string>
    storedByRuntime: Map<string, string>
  }

  internals.gateway = gateway
  internals.runtimeByStored.set(stored, runtime)
  internals.storedByRuntime.set(runtime, stored)

  return backend
}

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

// --- 1. A text-only turn is untouched ---------------------------------------

{
  const gateway = new RecordingGateway()
  const result = await backendFor(gateway).prompt('ses-stored', [{ kind: 'text', text: 'hello' }])

  assert.deepEqual(
    gateway.frames.map(frame => frame.method),
    ['prompt.submit'],
    'a turn with no images must not touch the attach path'
  )
  assert.deepEqual(gateway.frames[0].params, { session_id: 'rt-9', text: 'hello' })
  assert.deepEqual(result.images, [], 'a text turn has no images to report')
}

// --- 2. Attach lands before submit ------------------------------------------

{
  const gateway = new RecordingGateway()
  gateway.answer('image.attach_bytes', { attached: true, path: '/home/u/.hermes/images/upload_1.png' })

  const result = await backendFor(gateway).prompt('ses-stored', [
    { kind: 'text', text: 'what is this?' },
    { kind: 'image', uri: PNG, mimeType: 'image/png', name: 'shot.png' }
  ])

  assert.deepEqual(
    gateway.frames.map(frame => frame.method),
    ['image.attach_bytes', 'prompt.submit'],
    'the image must be queued on the session before the turn that consumes it'
  )
  assertAttachesSettledBeforeSubmit(gateway)

  assert.deepEqual(gateway.frames[0].params, {
    session_id: 'rt-9',
    // The `data:` wrapper is the phone's own packaging; the host wants bytes.
    content_base64: 'iVBORw0KGgo=',
    filename: 'shot.png'
  })
  assert.deepEqual(gateway.frames[1].params, { session_id: 'rt-9', text: 'what is this?' })

  assert.deepEqual(
    result.images,
    [{ name: 'upload_1.png', sourceUri: PNG }],
    'the caller needs the name the host chose, paired with the image it came from'
  )
}

// --- 3. A picture with no caption is still a message ------------------------

{
  const gateway = new RecordingGateway()
  gateway.answer('image.attach_bytes', { attached: true, path: '/images/upload_2.jpg' })

  await backendFor(gateway).prompt('ses-stored', [{ kind: 'image', uri: JPEG, name: 'photo.jpg' }])

  const submit = gateway.frames.find(frame => frame.method === 'prompt.submit')

  assert.ok(submit, 'an uncaptioned image must still submit a turn')
  assert.equal(
    submit.params.text,
    'What do you see in this image?',
    'an empty text is nothing to do as far as the host is concerned — say the implied thing'
  )
}

// --- 4. Several images keep their order -------------------------------------

{
  const gateway = new RecordingGateway()
  gateway.answer(
    'image.attach_bytes',
    { attached: true, path: '/images/upload_a.png' },
    { attached: true, path: '/images/upload_b.jpg' }
  )

  const result = await backendFor(gateway).prompt('ses-stored', [
    { kind: 'image', uri: PNG, name: 'a.png' },
    { kind: 'image', uri: JPEG, name: 'b.jpg' },
    { kind: 'text', text: 'compare these' }
  ])

  assert.deepEqual(gateway.frames.map(frame => frame.method), [
    'image.attach_bytes',
    'image.attach_bytes',
    'prompt.submit'
  ])
  assertAttachesSettledBeforeSubmit(gateway)
  assert.deepEqual(
    result.images.map(image => image.name),
    ['upload_a.png', 'upload_b.jpg'],
    'the host names them in the order they were attached'
  )
}

// --- 5. Nothing to send sends nothing ---------------------------------------

{
  const gateway = new RecordingGateway()
  const result = await backendFor(gateway).prompt('ses-stored', [{ kind: 'text', text: '   ' }])

  assert.deepEqual(gateway.frames, [], 'an empty composer must not start a turn')
  assert.deepEqual(result.images, [])
}

// --- 6. An attach the host refuses is not reported as stored ----------------

{
  const gateway = new RecordingGateway()
  gateway.answer('image.attach_bytes', { attached: false })

  const result = await backendFor(gateway).prompt('ses-stored', [
    { kind: 'text', text: 'look' },
    { kind: 'image', uri: PNG, name: 'x.png' }
  ])

  assert.deepEqual(result.images, [], 'no path back means nothing to file a local copy under')
}

// --- 7. Reading the refs back off a stored transcript -----------------------
//
// The host persists a user turn that carried images as the caption followed by
// one `@image:<path>` line each (`_build_persist_message_with_image_refs`).
// Left in the text, that is a wall of host paths under every photo ever sent.

{
  const { text, images } = splitImageRefs('what is this?\n@image:/home/u/.hermes/images/upload_1.png')

  assert.equal(text, 'what is this?')
  assert.deepEqual(images, [{ name: 'upload_1.png' }], 'only the basename is this device\'s business')
}

{
  // Upstream quotes a value containing whitespace (`format_reference_value`),
  // because the unquoted alternative in its own pattern is `\S+`.
  const { text, images } = splitImageRefs('see\n@image:`/home/u/my pictures/a b.png`')

  assert.equal(text, 'see')
  assert.deepEqual(images, [{ name: 'a b.png' }], 'a quoted path must be read whole')
}

{
  const { text, images } = splitImageRefs('@image:/images/only.png')

  assert.equal(text, '', 'an uncaptioned image leaves no text behind')
  assert.deepEqual(images, [{ name: 'only.png' }])
}

{
  const plain = 'nothing to see here'

  assert.deepEqual(splitImageRefs(plain), { text: plain, images: [] }, 'ordinary text is passed through')
}

// A turn whose text is nothing but refs must survive the fold: dropping rows on
// empty text would erase the message that carried the picture.
{
  const entries = toTranscriptEntries([
    { role: 'user', content: '@image:/images/only.png', timestamp: 1_700_000_000, row_id: 7 }
  ] as never)

  assert.equal(entries.length, 1, 'an uncaptioned image is still a message')
  assert.equal(entries[0].kind, 'message')
  assert.deepEqual(entries[0].kind === 'message' ? entries[0].images : null, [{ name: 'only.png' }])
}

// The directive is a *user* convention. An agent quoting it back — explaining
// the syntax, say — is prose, and rewriting prose into an attachment would both
// lose the text and draw an image that was never sent.
{
  const entries = toTranscriptEntries([
    { role: 'assistant', content: 'write @image:/path/x.png to attach one', timestamp: 1_700_000_000, row_id: 8 }
  ] as never)

  assert.equal(entries.length, 1)
  assert.equal(
    entries[0].kind === 'message' ? entries[0].text : '',
    'write @image:/path/x.png to attach one',
    'an agent message is left exactly as written'
  )
  assert.equal(entries[0].kind === 'message' ? entries[0].images : undefined, undefined)
}

console.log('Image check passed: attach precedes submit, and stored `@image:` refs read back as attachments.')
