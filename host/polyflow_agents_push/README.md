# polyflow_agents_push

The host half of the app's notifications. A Hermes plugin, not a service — see
[`../../docs/push-relay.md`](https://github.com/polyflowlabs/polyflow-agents/blob/main/docs/push-relay.md) for why, and for the
verified hook inventory this is built on.

**Status: registration proven offline, never yet run against a live host in
this shape.** `npm run check:plugin` drives the real router against the real
on-disk registry. The hooks are unchanged from the version that loaded on the
live host; no push has ever reached a real device, because there is no app build
to register one yet.

## What it does

| Event | Mechanism | Notification |
|---|---|---|
| Approval blocking a turn | `pre_approval_request` hook | "Approval needed" + the command |
| Approval answered anywhere | `post_approval_response` hook | data-only, so the app can dismiss a stale banner |
| Agent question | `pre_tool_call` on `clarify` | the question |
| Artifact produced | `post_tool_call` on `ARTIFACT_TOOLS` | "Artifact ready", naming the file — and the file is kept (below) |
| Turn finished | `post_llm_call` hook | "Turn finished" + the start of the reply |
| Cron job output | `deliver=polyflow_agents_push` delivery target | the rendered output |

Smart-mode approvals are skipped: an auxiliary LLM decides those and nobody is
being asked.

## Install

```bash
uv tool install polyflow-agents-push
polyflow_agents_push install --copy --enable
```

Then restart `hermes serve` (hooks and the registration routes) and, if you want
cron delivery, the messaging gateway.

**uv rather than pip, because a Hermes host usually has no pip.** Hermes builds
its own venv with `uv` and uv does not install pip into it, so
`.../venv/bin/pip` does not exist; a modern system Python is likely
PEP 668-managed on top of that. uv ships with Hermes (`~/.hermes/bin/uv`), so it
is the installer that is definitely present. Plain `pip install
polyflow-agents-push` works anywhere pip does — nothing here needs uv
specifically.

`uv tool install` is the right verb rather than `uv pip install --python <the
Hermes venv>`: this package exists to provide a command, and nothing about the
plugin needs to live in Hermes's own environment. Hermes loads a plugin **by
file path** from `~/.hermes/plugins/`, never by importing it from
site-packages — so an isolated tool environment keeps the plugin's lifetime
independent of a venv that Hermes owns and may rebuild on upgrade. uv puts the
executable in `~/.local/bin`.

**`--copy` rather than the symlink default**, for the same reason: a symlink
into a tool or venv environment dangles if that environment is rebuilt, and the
plugin then stops loading with nothing to say why except `polyflow_agents_push
status` reporting missing files. Copying costs an explicit re-run on upgrade:

```bash
uv tool upgrade polyflow-agents-push
polyflow_agents_push install --copy --force
```

Use the symlink default (drop `--copy`) when the environment is one you control
and do not rebuild — then `upgrade` alone is enough.

**Enabling is not optional.** A user plugin's Python is never imported until its
name is in the `plugins.enabled` allow-list — that is the code-execution vector
GHSA-mcfc-hp25-cjv7 closed. Without it every face is silently absent.
`--enable` shells out to `hermes plugins enable`; if the CLI is not on PATH it
prints the command instead.

**Why a second command at all**, when Hermes supports pip-installed plugins
through the `hermes_agent.plugins` entry-point group: that group covers hooks
and platforms. Dashboard backend routes are discovered by *scanning directories*
for `<name>/dashboard/manifest.json` — `_discover_dashboard_plugins()` reads
nothing else — and the backend route is where devices register. So the package
deliberately does **not** declare an entry point (a plugin discovered twice
registers its hooks twice, and every notification arrives twice with it) and
puts itself in the directory Hermes scans instead.

`polyflow_agents_push status` says where it landed, whether each file Hermes
looks for is present, and whether Hermes has it enabled.

## Device registration

The app POSTs to `/api/plugins/polyflow_agents_push/devices` on the port it already
talks to, authenticated by the credential it already holds. Nothing to
configure, nothing to type, no secret of its own.

That is new, and it replaced the worst part of this design. Until Hermes mounted
plugin routers, a plugin could not own an HTTP route, so registration went
through the messaging gateway's **webhook** server: a second endpoint on a
second port, a second HMAC secret generated on the host and retyped on the
phone, and JSON riding behind a `#handheld:` sentinel because `deliver_only`
renders a template and the rendered text *is* the message. Three costs for one
missing route. `_mount_plugin_api_routes()` in `hermes_cli/web_server.py` mounts
`dashboard/plugin_api.py`'s router in the same process that serves `/api/ws`,
and all three are gone — along with the three blocks of `config.yaml` that used
to be required.

| Route | Does |
|---|---|
| `POST /devices` | register or refresh, idempotent by token |
| `DELETE /devices` | stop pushing to one device |
| `GET /devices` | list, with tokens redacted to a tail |
| `POST /test` | push a test notification to every device |

`POST /test` earns its place: the delivery path — registry, Expo, APNs or FCM,
the phone's own notification settings — is otherwise only exercised by an
approval firing at an unpredictable moment, which is a miserable way to find out
that step four of six was misconfigured.

Two things worth knowing about the auth:

- The route is behind `auth_middleware`, which the app clears with
  `Authorization: Bearer` (token mode) or the session cookie it already carries
  (password/OAuth mode). Both are already sent by `HermesRestClient.request()`.
- `?token=` will **not** work. `_has_valid_query_token` is scoped to
  `_QUERY_TOKEN_API_PATHS`, which is `/api/files/download` and nothing else, so
  the trick that authenticates the WebSocket upgrade does not authenticate this.

And one about the network: `host_header_middleware` rejects a request whose
`Host` does not match the interface Hermes was bound to (GHSA-ppp5-vxwm-4cf7).
Over Tailscale that means binding to the tailnet address and having the phone
address the host by that same name — the same rule the socket already follows,
but now it can fail at registration too.

## Artifacts

The plugin also keeps what the agent produces. On every `post_tool_call` for a
tool in `ARTIFACT_TOOLS` — `write_file` and the image and video generators —
the file is copied into a store under the process Hermes home, and the push
carries its id so a tap opens it. Source code the agent writes is skipped
(`artifacts.is_source_code`): artifacts are what it made for a person to read,
and the `.py` it edited on the way is not that. The app files the pictures it
sends through the same store, which is how a sent picture comes back on a
different phone.

```
~/.hermes/polyflow_agents_push/artifacts/
  artifacts.db          # SQLite index
  files/<id>.<ext>      # the bytes, copied — never a link to the agent's path
```

| Route | Does |
|---|---|
| `GET /artifacts?session=&kind=&limit=&offset=` | newest first |
| `GET /artifacts/{id}` | one row |
| `GET /artifacts/{id}/content` | the bytes, inline; `?download=1` for a save-as |
| `GET /artifacts/{id}/thumbnail` | a first-page PNG, rendered on first ask with Pillow / `pdftoppm` / Chromium / LibreOffice, whichever this host has; 404 otherwise |
| `POST /artifacts` | the app filing a sent picture: `{name, mimeType, sessionId, dataUrl}` |
| `DELETE /artifacts/{id}` | row and bytes |
| `POST /artifacts/{id}/share` | mint or return a share token; `{expiresInHours?}` |
| `DELETE /artifacts/{id}/share` | revoke |
| `GET /share/{token}` | the bytes, by token alone |

Same auth as the device routes, which is the catch for `/share/{token}`: every
`/api/*` path is behind the host's gate, and the public allow-list is a fixed
upstream tuple with no registration API, so the link works for anyone who can
already sign in to the host and nobody else. The route is already shaped for a
public path — it authenticates by the token alone — so exposing it needs only
the gate to let that one prefix through. Design and the rest of the contract:
[`docs/artifacts.md`](https://github.com/polyflowlabs/polyflow-agents/blob/main/docs/artifacts.md).

Per-file cap of 25 MB, matching the gateway's own `image.attach_bytes` ceiling.
A rewrite of the same path in the same session updates the row and bumps its
`version` rather than adding a row.

## Cron delivery

`deliver=polyflow_agents_push` needs a home channel, which is what
`POLYFLOW_AGENTS_PUSH_HOME_CHANNEL`
is declared for (`cron_deliver_env_var` on the platform registration). Set it to
any non-empty value — the devices come from the registry, not from the channel.

The scheduler wraps each delivery in a `Cronjob Response: <name>` header and a
"to stop or manage" footer (unless `cron.wrap_response: false`). The
standalone sender reads the wrapper off: the job's name becomes the
notification title, its own output the body, and the job id travels in the
push data as `jobId`. Hermes calls the sender positionally and requires a
`success` or `error` key in the answer — `scripts/plugin-api-check.py` pins
both, because the first version got both wrong and every delivery went out
empty and was logged as failed.

## Known weak points

- **Cron success and failure are indistinguishable.** Delivery targets carry no
  status, so `_looks_like_failure()` greps the rendered output for `error`,
  `failed`, `traceback`. The app's preference is failures-only, so a job whose
  normal output says "0 errors" will notify and a failure that says none of
  those words will not. This is the weakest thing in the plugin.
- **A turn that ends seconds after the app is backgrounded is announced
  twice.** The app's socket usually outlives the switch away by a little, and
  it raises a local banner from `message.complete` before this push lands.
  The ledger stops the socket repeating a push the app has *seen*; it cannot
  stop a push the OS presents without asking, which is every push that arrives
  while the app is not in the foreground. Once the socket is gone — the normal
  case a minute in — only this push fires.
- **Subagent and cron turns are deliberately silent** (`SILENT_TURN_PLATFORMS`,
  matched on the hook's `platform`). A turn on any other platform pushes, so a
  desktop or TUI session on the same host rings the phone too. That is by
  design — it is the same agent — but it is worth knowing.
- **The registry is read from the *process* Hermes home, deliberately.**
  `hermes serve` runs each turn under a per-task profile override
  (`tui_gateway/compute_host.py` calls `set_hermes_home_override`), while the
  registration route runs with none. Resolving the store with
  `get_hermes_home()` therefore wrote to `~/.hermes/polyflow_agents_push/` and
  read `~/.hermes/profiles/<name>/polyflow_agents_push/` — a directory that
  does not exist. Every push returned early on an empty registry, silently, so
  registration looked perfect and nothing was ever delivered. `devices.py` now
  uses `get_process_hermes_home()`. One phone is one host, not one profile.
- **A short-lived process used to drop its push entirely.** `notify()` hands the
  send to a daemon thread, and the CLI hard-exits through `os._exit`
  (`hermes_cli/main.py`), which kills threads without running finalizers — so a
  `-z` one-shot, or a cron/kanban worker exiting straight after its turn,
  started the POST and vanished mid-flight. Silently: the thread never got far
  enough to log a failure. `notify(flush=…)` now lets a caller wait for the
  send, and the end-of-turn and cron paths pass `FLUSH_SECONDS`. Verified A/B
  against a real `os._exit(0)` — lost without it, delivered with it. Approvals
  and clarify questions stay non-blocking by design: they halt the agent, and
  only ever run under `hermes serve`, which lives for hours.
- **Preferences live per device in the registry**, not in the app alone. A
  closed app cannot filter its own push, so the host has to know. That means the
  app must re-register when preferences change, and a device whose registration
  is stale gets notifications it has since turned off.
- **Approvals ignore preferences by design** (`devices.wants`). A halted agent
  nobody is told about is a worse failure than an unwanted banner.
- **Artifacts are captured from tool results, not from the filesystem.** A
  file the agent produced through `terminal` — `echo > out.txt`, a script that
  writes — is not seen. `write_file` and the generators are; those are the
  calls whose result names what was made.
- **A `write_file` into a sandbox is invisible.** The hook copies the path the
  tool reports, from the process it runs in. If the agent's terminal backend is
  a container or a remote box, that path may not exist on the host, and the
  capture logs a miss rather than an artifact.
- **The store follows the process home, like the device registry.** Under
  `hermes serve` that is `~/.hermes/polyflow_agents_push/artifacts/`, which is
  also what the routes read. A `hermes -p <profile> chat` one-shot or a cron
  worker runs with the *profile* home as its process home and writes there
  instead, where the app never looks. Same property, same reason, as devices.
- **The plugin's name is a contract.** Hermes mounts a router under the `name`
  in `dashboard/manifest.json` (falling back to the directory basename), so
  `polyflow_agents_push` is baked into the app's `PUSH_ROUTE`. Change one
  without the other and registration 404s with nothing to say why.
- **One name, four places.** The pip distribution is `polyflow-agents-push`;
  the import package, the plugin Hermes mounts, and the gateway platform are all
  `polyflow_agents_push`. Only the distribution differs, because PyPI normalises
  to hyphens. Nothing here derives a name from another, so changing one means
  changing them together.

## Not implemented

Answering from the lock screen. `register_approval_transport` is the API for it
(`docs/push-relay.md` §6) and a plugin route is now the return channel it was
missing — the transport can push, block, and be resolved by an inbound POST. It
would still replace the built-in prompt for the whole profile, including the TUI
and the desktop app, so it remains a deliberate second step. This plugin only
notifies; the app answers.
