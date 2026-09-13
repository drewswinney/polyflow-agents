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
  artifacts.db          # SQLite, WAL. The index, and the versions a rewrite replaced.
  files/<id>.<ext>      # The bytes, copied — never a link to the agent's path.
  files/<id>.v<n>.<ext> # The bytes version n had, kept when a rewrite replaced them (§4.2).
```

SQLite rather than the registry's JSON-with-atomic-replace: the hooks fire from
`hermes serve`'s worker threads, cron and kanban workers are separate processes,
and the app writes through the route. A JSON document under that many writers
is a lost-update waiting to happen; SQLite's locking is the cheapest correct
answer and it is stdlib, so the plugin stays dependency-free.

**Titled, not just named.** `name` is the filename, and the key a rewrite is
matched on; `title` is what a person calls the thing (§4.3) — read off the
file where it says, made from the filename where it does not, and replaceable
by hand. Everywhere the app labels an artifact, the label is the title.

**Copied, not linked.** The agent may overwrite or delete the file it wrote a
minute later. An artifact is the snapshot the conversation produced. A rewrite
of the same path in the same session *updates* the artifact in place and bumps
its `version`, so the list does not fill with twelve revisions of one file —
and keeps the bytes it replaced (§4.2), so the revision before is still there
to read.

## 3. What is captured

| Source | Trigger | What is stored |
|---|---|---|
| `write_file` | `post_tool_call` hook, in the process that ran the turn | the file at `args.path` (or `result.resolved_path`), if it exists, is under the size cap, and is not source code |
| `image_generate` / `image_gen` / `video_gen` and kin | same hook | every `url` / `image` / `video` in the result: a local absolute path is copied, an `http(s)` URL is fetched (10s, size-capped) |
| A picture the phone sent | the app, after `prompt()` returns the host's filename | the downscaled bytes the phone actually uploaded, under the host's name |

**Code is not an artifact.** An artifact is something the agent produced for a
person to look at — a report, a page, a picture, a spreadsheet. A coding task
writes dozens of source files on the way to its result, and none of them is
that; a store that filed each one would bury the report under the `.tsx` files
that built it. So a `write_file` whose kind would be `code` (`is_source_code`,
the same judgement `record` uses for `kind`) is logged and skipped. Data files
— a CSV, a JSON export — are kept, since those are as often the deliverable as
the plumbing. The `code` kind stays in the taxonomy for rows stored before this
rule.

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
| `GET /artifacts/{id}/versions` | the earlier versions the host kept, newest first (§4.2) |
| `GET /artifacts/{id}/content` | the bytes, inline; `?download=1` for attachment; `?v=n` for a kept earlier version |
| `GET /artifacts/{id}/thumbnail` | a first-page PNG, rendered on first ask (§4.1); 404 when nothing on the host can; `?v=n` as above |
| `POST /artifacts` | the app filing a sent image: `{name, mimeType, sessionId, dataUrl, title?}` |
| `PATCH /artifacts/{id}` | rename: `{title}`; `null` or empty hands naming back to the file (§4.3) |
| `DELETE /artifacts/{id}` | row and bytes |
| `POST /artifacts/{id}/share` | mint (or return) a share token; `{expiresInHours?}` |
| `DELETE /artifacts/{id}/share` | revoke |
| `GET /share/{token}` | the bytes, by token alone |

Both bytes routes answer with `Cache-Control: private, max-age=86400` and the
file's sha256 as the ETag, on the promise that the bytes for one id and
version never change. The app requests them as `…/content?v={version}` and
`…/thumbnail?v={version}` — originally only because the HTTP cache under
`fetch` (OkHttp on Android, NSURLCache on iOS) keys on the whole URL, and
without the version it answers a rewritten artifact with the previous file
for the rest of the day. Since §4.2 the host reads `v` too: absent, or the
current version, is the artifact; an earlier one is served from what was
kept, and 404s when it was not — never the current bytes under an old
number, which that same cache would then keep for a day as that version.

One row:

```json
{
  "id": "a1b2c3…",
  "name": "report.md",
  "title": "Findings from the scrub",
  "titleCustom": false,
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

### 4.2 Versions

A rewrite used to overwrite: version 3 was the only version, and the two
drafts before it were gone the moment the agent wrote the third. Now the
bytes a rewrite replaces are copied to `files/<id>.v<n>.<ext>` first and
described by a row in `artifact_versions` — name, kind, MIME, size, sha,
tool, when they were written and when they were replaced. The same bytes
written again (a fresh timestamp, no new version) keep nothing.

`GET /artifacts/{id}/versions` lists them, newest first, each in the shape of
§4's row *at that version* — same `id`, the version's own `name`, `size`,
`mimeType`, `version`, `createdAt`/`updatedAt` (when those bytes were
written), `share: null`, the artifact's `title` (a title names the artifact,
not a draft of it — §4.3), plus `archivedAt` for when they stopped being
current. The current version is not among them; it is the artifact. That
shape is deliberate: everything in the app that draws, caches or opens an
artifact does so by `(id, version)`, so an earlier version is one it can take
unchanged — the bytes through `…/content?v=n`, the thumbnail (rendered and
cached on its own, under `<id>.v<n>`) through `…/thumbnail?v=n`.

**Bounded.** `MAX_ARCHIVED_VERSIONS` (10) per artifact; past that the oldest
kept version goes, bytes and thumbnail with it. Ten drafts back is further
than anyone looks, and an agent rewriting a file in a loop should cost the
store eleven files, not one per iteration. Versions written before this
existed were not kept, so an artifact at version 4 may list fewer than
three; the app says so when asked for one it cannot have. Deleting the
artifact deletes every kept version.

A re-sent picture under the same name is a rewrite like any other, and there
is no route to delete one version alone: the artifact is the unit.

### 4.3 Titles

`name` was the only label an artifact had, and it is the filename: fine for
`report.md`, less so for `q3-report-final-v2.md`, and no help at all for the
`generated-3f9a1c0b2d.png` this plugin names a data-URL generation or the
`upload_20260907_132822_1.png` the gateway files a sent picture under. So an
artifact also has a **title** — what a person calls it — and the app labels
it by that everywhere the filename used to stand in.

The host derives it when the bytes land, from what the file says about
itself first and its name second (`artifacts.derive_title`):

| File | Title from |
|---|---|
| HTML | `<title>`, else the first `<h1>`; tags stripped, entities unescaped |
| Markdown | a front-matter `title:`, else the first `#` heading |
| anything else | the filename: extension off, `-` and `_` to spaces, first letter up — `q3-report_final-v2` → `Q3 report final v2` |
| a data-URL generation (`generated-<sha>`) | `Generated image` |
| a gateway upload (`upload_<date>_<time>[_n]`) | `Sent picture` |

One line, whitespace collapsed, at most 120 characters, never empty. Only the
first 64 KB of a text file is read for it: a heading is at the top or it is
not the title.

**Renaming.** `PATCH /artifacts/{id}` with `{title}` sets it by hand and marks
the row `titleCustom`; from then on a rewrite changes the bytes and the
version but not the title. Until then, a rewrite re-derives — a report whose
heading changed is listed under its new heading. Sending `null` (or an empty
string) clears the custom title: the host reads the current bytes again and
answers with whatever they say, so the app can offer "back to the file's own
name" without ever knowing what that is. `POST /artifacts` takes an optional
`title` for the same reason, though the app does not send one today: the
gateway's upload name says nothing, and "Sent picture" is the honest title.

**Backfill.** Rows from before this existed have no title column. `_migrate`
adds the two columns the first time the new module opens the store and titles
every untitled row from its bytes — the report's heading, not just its name
— so an existing store comes up fully titled with nothing to run by hand.
The check is repeated on every open (one cheap miss when there is nothing to
do), so a row that lands untitled somehow is titled the next time anything
opens the database.

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
  by day; images as tiles, everything else as rows labelled by title (§4.3).
  Filter by kind. A chat's header links to the same screen scoped to that
  session.
- **Detail:** `/artifacts/[id]`. The title as the heading, then preview,
  provenance — with the filename as a *File* row, since the title has taken
  its place up top — *Rename* (a row that becomes a text field in place;
  clearing it hands naming back to the file), *Open session*, *Share file*,
  *Copy link* / *Stop sharing*, *Delete*. For a type the sheet renders,
  a *View the page* / *View as formatted text* / *View as a table* / *View the
  PDF* row (and the page preview itself) opens the sheet from here. Below
  the provenance, **Earlier versions** — when the host kept any (§4.2): one
  row per version with its thumbnail, size, and when it was written and
  replaced. Each opens `/artifacts/[id]?v=n`: the same screen showing that
  version — its own preview, size and dates, *Share file* for those bytes —
  but no link, no delete and no version list, since those belong to the
  artifact, not to a draft of it, and a row back to the current one. A `v`
  the host has nothing for says why (never kept, or since let go) rather
  than showing the wrong bytes.
- **Preview sheet:** what can be shown as the thing it is opens in a sheet
  instead — half the screen, dragged up to all of it (`PreviewSheet`,
  `previewMode` in `ui/artifacts.ts`). HTML renders in a WebView from the
  cached file; markdown as prose through the chat's renderer; CSV and TSV as a
  table sized to its columns, the first 500 rows. A PDF takes the same sheet
  on iOS, whose WebView draws one; Android's has no viewer, so a PDF there
  keeps the detail screen and its share button. Everything else — plain text,
  code, images, Office files — is the detail screen. The sheet's heading is
  the title, and a long press on it renames, the way a board card's or a
  scheduled job's does. The header also carries an info button opposite its
  close button: the sheet leaves and the detail screen arrives, so a page, a
  report or a table — the types the agent produces most — is never a dead
  end with no way to its provenance, its link, its versions or its delete.
- **In the chat itself:** each file the agent produced appears as a tile in the
  transcript, slotted by time under the work section that made it and above
  the reply that mentions it (`withArtifactRows` in `transcript-rows.ts`). The
  tile is the thing at its own proportions — the host's thumbnail (§4.1) via
  `ArtifactPreview`, which every tile in the app draws through, with nothing
  painted behind it — then the title and *Open*. A glyph stands in when the
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
  tapping it opens the artifact rather than the session. Its body is the
  title — "Q3 report" reads on a lock screen the way `q3-report-final-v2.md`
  does not.
- **Older hosts:** a row without `title` (a plugin from before §4.3) is shown
  under its filename, as it always was; `renameArtifact` against such a host
  fails the way any missing route does.

## 7. Not done, deliberately

- No capture from `terminal` output (guessing, see §3).
- No de-duplication across sessions: the same file written in two sessions is
  two artifacts, because it was two events.
- No quota or eviction on the host beyond the per-file cap and the per-artifact
  bound on kept versions (§4.2). Delete is a route.
- No deleting one version on its own, and no restoring an earlier version as
  the current one: the agent's file is the agent's, and "make it like it was"
  is a thing to ask the agent, not the store.
- No title per kept version. A title names the artifact; a draft of it is
  listed by its version number and, when it differs, its filename.
- No title from a PDF's or an Office file's own metadata. Both carry one, but
  reading it means a parser the plugin does not ship; the filename is the
  agent's summary of the file and is what it gets.
