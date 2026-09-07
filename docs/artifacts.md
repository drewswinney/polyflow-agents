# Artifacts — what the agent produced, kept where the phone can reach it

**Status:** built and proven offline (`npm run check:plugin`, `npm test`), and
the same check passes under the host's own Python and FastAPI. On the live host
the routes mount and the hooks register in `hermes serve`; the capture path has
not yet been driven by a real turn from the app, so that is the next thing to
watch: `grep artifact ~/.hermes/logs/agent.log` after sending a picture or
asking for a file.

An *artifact* is a file that passed through a conversation: something the agent
wrote or generated, or an image the phone sent it. Hermes has no such noun —
upstream there is only tool output, and an uploaded image survives only as an
`@image:<host path>` reference in the transcript (`architecture.md` §7.2). This
document is the contract between the host plugin that keeps them and the app
that shows them.

## 1. Why

Three things the app could not do before this, in the order they hurt:

1. **Find what the agent made.** A file written by `write_file` or an image from
   `image_generate` exists on the host's disk under whatever path the agent
   chose, and the only trace in the app is a tool card. There was no list, no
   preview, and no way to get the bytes onto the phone.
2. **See a sent image again.** The host stores an attachment under its own
   filename and serves no endpoint to read it back, so a reopened session showed
   a name-only chip for every picture this device had not kept a copy of — and
   *only ever* this device, since the copy lived in `attachment-cache.ts`.
   Another phone, or the same phone after a reinstall, saw nothing.
3. **Hand something to someone else.** A generated report or image had no route
   off the host except the agent pasting it into a reply.

## 2. The shape

```
hermes serve ──post_tool_call──► adapter.py ──► artifacts.py (store)
                                                   ▲            │
app ── POST /artifacts (sent images) ──────────────┘            │
app ◄── GET /artifacts, /artifacts/{id}/content ────────────────┘
anyone ◄── GET /share/{token}  (see §5 for what "anyone" means today)
```

Same plugin, same store pattern as devices: **one host, one store**, under the
*process* Hermes home (`devices._hermes_home()`), because a hook fires under a
per-task profile override and the route runs with none — the device registry
learned that the hard way (plugin README, "Known weak points").

```
~/.hermes/polyflow_agents_push/artifacts/
  artifacts.db          # SQLite, WAL. The index.
  files/<id>.<ext>      # The bytes, copied — never a link to the agent's path.
```

SQLite rather than the registry's JSON-with-atomic-replace: the hooks fire from
`hermes serve`'s worker threads, cron and kanban workers are separate processes,
and the app writes through the route. A JSON document under that many writers
is a lost-update waiting to happen; SQLite's locking is the cheapest correct
answer and it is stdlib, so the plugin stays dependency-free.

**Copied, not linked.** The agent may overwrite or delete the file it wrote a
minute later. An artifact is the snapshot the conversation produced. A rewrite
of the same path in the same session *updates* the artifact in place and bumps
its `version`, so the list does not fill with twelve revisions of one file.

## 3. What is captured

| Source | Trigger | What is stored |
|---|---|---|
| `write_file` | `post_tool_call` hook, in the process that ran the turn | the file at `args.path` (or `result.resolved_path`), if it exists and is under the size cap |
| `image_generate` / `image_gen` / `video_gen` and kin | same hook | every `url` / `image` / `video` in the result: a local absolute path is copied, an `http(s)` URL is fetched (10s, size-capped) |
| A picture the phone sent | the app, after `prompt()` returns the host's filename | the downscaled bytes the phone actually uploaded, under the host's name |

Nothing is captured from `terminal`, `patch` or `execute_code`. The bundled
`disk-cleanup` plugin shows the terminal-output path-grep pattern is workable,
but it produces guesses; a file the agent explicitly *wrote* is a fact.

The hook never blocks the agent: the copy happens on the same daemon-thread
path the push does, wrapped so nothing can raise into the tool loop.

### Size cap

25 MB, matching the gateway's own `image.attach_bytes` ceiling. Over that, a
log line and no artifact. A cap is preferable to a store that quietly grows by
gigabytes because an agent wrote a database dump.

## 4. The routes

Mounted under `/api/plugins/polyflow_agents_push/` like the device routes, behind
the same auth the app already clears.

| Route | Does |
|---|---|
| `GET /artifacts?session=&kind=&limit=&offset=` | newest first |
| `GET /artifacts/{id}` | one row |
| `GET /artifacts/{id}/content` | the bytes, inline; `?download=1` for attachment |
| `GET /artifacts/{id}/thumbnail` | a first-page PNG, rendered on first ask (§4.1); 404 when nothing on the host can |
| `POST /artifacts` | the app filing a sent image: `{name, mimeType, sessionId, dataUrl}` |
| `DELETE /artifacts/{id}` | row and bytes |
| `POST /artifacts/{id}/share` | mint (or return) a share token; `{expiresInHours?}` |
| `DELETE /artifacts/{id}/share` | revoke |
| `GET /share/{token}` | the bytes, by token alone |

One row:

```json
{
  "id": "a1b2c3…",
  "name": "report.md",
  "kind": "document",
  "mimeType": "text/markdown",
  "size": 4312,
  "sessionId": "20260907_132822_3b37eb",
  "origin": "agent",
  "tool": "write_file",
  "sourcePath": "/home/greg/report.md",
  "createdAt": 1757250000000,
  "updatedAt": 1757250000000,
  "version": 1,
  "share": { "url": "http://host:9119/api/plugins/polyflow_agents_push/share/…", "expiresAt": null, "createdAt": 1757250100000 }
}
```

### 4.1 Thumbnails

A card in the chat should look like the thing it opens, and a phone cannot
rasterise a PDF or a Word file. The host can, with tools it very likely has:

| Kind | Renderer | Absent → |
|---|---|---|
| image | Pillow | 404; the app draws the picture itself |
| PDF | `pdftoppm`, first page | 404; glyph |
| HTML | headless Chromium screenshot (`POLYFLOW_ARTIFACT_CHROMIUM`, PATH, or Hermes's Playwright cache), else LibreOffice → PDF | 404; glyph |
| Word, Excel, PowerPoint, ODF, RTF, EPUB | LibreOffice → PDF → `pdftoppm` | 404; glyph |
| text, code, data | Pillow draws the first page in a monospace font | 404; glyph |

Rendered lazily on the first request, kept as `files/<id>.thumb.png` beside a
marker holding the sha it came from — a rewrite re-renders, a delete removes
both. A failed render is remembered for an hour so a broken file does not
cost a Chromium launch on every scroll. Renders run off the event loop, one at
a time per artifact. Every renderer is optional: the plugin still imports
nothing beyond the stdlib, and probes each tool when it is needed.

`kind` is derived from the MIME type and extension on the host, once, so every
client agrees on what is an image. `sessionId` is the **stored** id — the one
`/api/sessions` lists and the app opens a chat by — because that is what
`agent.session_id` carries in the hook (`push-relay.md` §4 on `post_llm_call`).

## 5. Sharing, and the honest limit

A share token is a random 128-bit string kept on the row, optionally expiring.
`GET /share/{token}` looks the artifact up by token (a unique index over 128
random bits; guessing is not a strategy), checks the expiry, and streams it
inline with `nosniff`. Revoking deletes the
token; the link dies.

**What the link does not do today: get past the host's auth gate.** Every
`/api/*` path on `hermes serve` is gated, and the exceptions are a hardcoded
upstream allow-list — `hermes_cli/dashboard_auth/public_paths.py` for exact
paths, `_GATE_PUBLIC_PREFIXES` in `dashboard_auth/middleware.py` for prefixes
— with no registration API a plugin can call (verified at ref `c86197e`). So a
share link works for anyone who can already authenticate to the host and for
nobody else. The plugin does not monkeypatch its way around that: the gate is
the host's security boundary and the same one that protects device
registration.

Two consequences shape the app:

- **"Share file" is the action that reaches outsiders now.** The app downloads
  the bytes over its own authenticated connection and hands them to the OS
  share sheet — AirDrop, Messages, Mail, Drive. That is a real file on the
  recipient's side, not a link that 401s.
- **"Copy link" is offered, labelled for what it is.** Useful between people who
  share a host (a household, a team on one tailnet) and as the contract for
  when the gate grows a hook. The copy on the screen says so.

The route is already the right shape for a public path: it authenticates by
the token alone and touches nothing else on the host, so exposing it needs only
the gate to let it through. An upstream `register_public_prefix()` — or a
reverse proxy that satisfies the gate for that one prefix — is the whole gap.

## 6. The app

- **Capability:** `artifacts: { store, share }`. True of the Hermes *kind*, like
  `push.register` — the route exists once the plugin is installed. A host
  without it answers 404, which the Artifacts screen reports as "not set up on
  this host" rather than as a failure.
- **Screen:** `/artifacts`, in the sidebar between Sessions and Boards. Grouped
  by day; images as tiles, everything else as rows. Filter by kind. A chat's
  header links to the same screen scoped to that session.
- **Detail:** `/artifacts/[id]`. Preview, provenance, *Open session*, *Share
  file*, *Copy link* / *Stop sharing*, *Delete*.
- **In the chat itself:** each file the agent produced appears as a tile in the
  transcript, slotted by time under the work section that made it and above
  the reply that mentions it (`withArtifactRows` in `transcript-rows.ts`). The
  tile is the thing at its own proportions — the host's thumbnail (§4.1) via
  `ArtifactPreview`, which every tile in the app draws through, with nothing
  painted behind it — then the filename and *Open*. A glyph stands in when the
  host could not render one. Several files from one stretch of work sit in a
  strip you scroll sideways. Tap to open the detail. The header's artifacts button carries a count, and opens
  the session-scoped list. The chat re-reads the session's artifacts when a
  producing tool settles and when the turn ends. Pictures the user sent are not
  carded: they already show in the user's bubble.
- **Bytes on the phone:** `platform/artifact-cache.ts`, keyed by server, id and
  version under the cache directory — the OS may evict it, and a miss is one
  download. Fetched with the app's own `fetch` so it carries whichever
  credential the host wants (bearer or cookie); an `<Image>` given a bare URL
  would carry neither on Android.
- **Sent images come back.** `session-stream.ts` files each sent picture to the
  host after `prompt()` names it, and a reloaded transcript resolves name-only
  images against the session's upload artifacts before falling back to the
  chip. The device cache is still consulted first — it is free.
- **Push:** the existing `artifacts` notification now carries `artifactId`, and
  tapping it opens the artifact rather than the session.

## 7. Not done, deliberately

- No capture from `terminal` output (guessing, see §3).
- No de-duplication across sessions: the same file written in two sessions is
  two artifacts, because it was two events.
- No quota or eviction on the host beyond the per-file cap. Delete is a route.
- No thumbnails. The phone downscaled its uploads already; agent images are
  fetched full-size and cached once.
