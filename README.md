# Polyflow Agents

A cross-platform (iOS + Android) mobile client for a [Hermes](https://github.com/) agent,
built so the agent harness behind it can be swapped later.

The design lives in [docs/architecture.md](docs/architecture.md) (behaviour and API backing)
and [docs/design/README.md](docs/design/README.md) (the visual handoff — exact colours,
type, spacing). This file is the short version of how to run it.

## Run it

```bash
npm install
npm start          # then press i / a, or scan the QR with Expo Go
```

**Pinned to Expo SDK 54** (React Native 0.81, React 19.1) so the store build of
Expo Go loads it directly. Expo Go only runs the SDK it was built against, so
this pin is what keeps `npm start` → scan → running on a phone with no build
step. Bump it deliberately, alongside the Expo Go on the device — and note that
Expo Go stops being an option the moment the app needs a native module outside
the SDK, at which point §10.1's EAS development build takes over.

The app boots against a **demo agent** backed by `MockBackend`, so there is
something to run before any host prep exists. The mock streams tokens, opens a
tool card, raises a blocking approval and settles — the whole Chat path without
a server.

To point it at a real agent, use **Connect a server** in the switcher popover:
host, port, and whatever credential the host says it wants — the form probes
`/api/status` and `/api/auth/providers` rather than assuming a bearer token.
Secrets go to the Keychain / Android Keystore, never to AsyncStorage.

The last step asks the host what it *hosts*. One `hermes serve` can run several
profiles, and a profile is an agent — its own model, provider, skills and
memory — so the agents come from `/api/profiles` rather than being typed in. A
non-Hermes host is asked `/v1/models` instead, and a host that reports one
identity skips the picker. A host that will not answer still yields one agent,
so discovery can only ever add. Servers are what you remove; agents that vanish
server-side are marked, not deleted (architecture §4.2, §5.2a).

## Notifications

While the app is open it raises its own notifications. Once it is closed the
phone cannot observe anything — neither OS keeps a WebSocket alive in the
background — so the case that matters, an agent halted on an approval while
your phone is in your pocket, needs the **host** to do the telling. That is a
Hermes plugin, and it lives in this repo at
[host/polyflow_agents_push/](host/polyflow_agents_push/) so it and the app stay
versioned together: they share a contract, and drift between them is invisible
until a notification silently stops arriving.

On the agent host:

```bash
uv tool install polyflow-agents-push      # pip works too, wherever pip exists
polyflow_agents_push install --copy --enable
```

Then restart `hermes serve` — that process loads both the hooks and the
registration route — and the messaging gateway too if you want cron output
pushed. `polyflow_agents_push status` says where it landed and whether Hermes
has it enabled.

**uv rather than pip** because a Hermes host usually has no pip: Hermes builds
its venv with uv, uv does not put pip inside it, and a modern system Python is
likely PEP 668-managed. uv ships with Hermes at `~/.hermes/bin/uv`. Nothing in
the package needs uv specifically.

**`--enable` is not optional flavour.** A user plugin's Python is never
imported until its name is in Hermes's `plugins.enabled` allow-list, so an
installed-but-not-enabled plugin is silently absent rather than broken.

**Profiles matter, and this is the one that bites.** Hermes keeps **one plugin
manager per Hermes home**, and `hermes serve` runs every turn under the
profile's home. A plugin installed only in the default home is registered into
a manager those turns never consult — hooks fire into an empty list and return.
Nothing errors: routes mount, devices register, `status` says installed and
enabled, and not one notification is ever sent. `install` therefore walks
`~/.hermes/profiles/*` as well (`--no-profiles` opts out), and `status` reports
each one:

```
profiles:
  ok   greg
         install: linked -> /home/drew/.hermes/plugins/polyflow_agents_push
         enabled: yes
  GAP  devqa
         install: not installed
         enabled: no
```

A `GAP` is not cosmetic — turns on that profile push nothing. If you add a
profile later, re-run `install --force --enable`.

Nothing else to configure. The app registers this device over the connection it
already has, authenticated by the credential you already gave it — there is no
second endpoint, no second secret, and nothing to type into Settings. The
Notifications screen reports what the host knows, including when it has no
plugin.

Remote push needs a real build. Expo Go dropped it in SDK 53, so `npm start` →
scan gets you local notifications only; `eas build --profile preview` is the
smallest thing that can receive a push.

What the host sends, what it deliberately does not, and the two hooks it is
still unproven against are in [docs/push-relay.md](docs/push-relay.md) and the
plugin's own [README](host/polyflow_agents_push/README.md).

## Checks

```bash
npm run typecheck     # includes the vendored upstream types
npm run check:m0      # the M0 gate, without needing a host
npm run check:images  # image attachments, without needing a host
npm run check:discovery  # agent discovery + the v1→v2 registry migration
npm run check:plugin  # the host plugin's registration route, without a Hermes
npm run spike:m0      # the M0 gate against a live `hermes serve`
```

`check:m0` is the one that matters in CI. It drives the *vendored, unmodified*
upstream gateway client through a fake socket and asserts that real-shaped
Hermes frames normalise into the domain's `SessionUpdate` union.

`check:discovery` covers the two things about connecting a server that types
cannot. A host that *refuses* to list its agents reports an empty list, and so
does a host that genuinely has none — read the first as the second and every
agent on a working server gets marked missing the moment one request fails. And
the `agents/v1` → `v2` migration has to keep each old agent id as its new
server id, because that is the key its credential sits under in the keychain;
minting a fresh one typechecks perfectly and silently loses the password.

`check:plugin` covers the host half. `dashboard/plugin_api.py` is imported by
Hermes with `spec_from_file_location` under a flat module name — no package —
so the `from . import devices` that works in `adapter.py` raises there, and
`push.py` has relative imports of its own that break the same way. The check
drives the real router through that exact import path and round-trips a
registration to the on-disk registry, because a register that returns 200
without landing is a device that will never be pushed to and nothing that says
so. It skips itself when FastAPI is absent, so it costs nothing on a machine
that is only building the app.

`check:images` covers the one thing about sending a picture that types cannot:
`image.attach_bytes` queues a file *on the session* and the next `prompt.submit`
consumes the queue, so a submit that overtakes an attach does not fail — it
sends the text alone and leaves the image for the next message to swallow. The
check drives the real `HermesBackend.prompt()` against a gateway that answers on
a later tick, so an unawaited attach is caught rather than looking correct.

Both run under plain Node via `scripts/node-resolve.mjs`, which teaches it the
`@/` and `@hermes/` aliases and stubs the Expo native modules — so a check
exercises the code that ships rather than a copy of it.

`spike:m0` needs a running backend:

```bash
HERMES_HOST=127.0.0.1:9119 HERMES_TOKEN=… npm run spike:m0
```

## Layout

```
app/                  expo-router routes
  (tabs)/             sessions · activity · settings
  chat/[id].tsx       the live turn
  agents/new.tsx      add an agent
src/
  domain/           ★ AgentBackend, models, capabilities — the harness-swap seam
  backends/
    hermes/           REST client, gateway wiring, event mapping
    mock/             the scripted backend the UI is built against
    openai-compat/    the second agent kind (shape only, so far)
  state/              agent registry, connection lifecycle, session stream
  ui/                 theme tokens, components
  platform/           secure storage, RN polyfills
vendor/hermes/        vendored upstream TypeScript — never edited in place
host/polyflow_agents_push/  the Hermes plugin that pushes to this app (pip)
scripts/              upstream sync, M0 checks
```

★ Nothing Hermes-shaped may appear above `src/domain`. That rule is what makes
swapping the harness possible, and it is worth defending in review.

## Keeping up with upstream

```bash
npm run sync:upstream    # re-pulls vendor/hermes from the agent host
npm run typecheck        # an upstream break must surface here, not in a user's hand
```

See [vendor/hermes/UPSTREAM.md](vendor/hermes/UPSTREAM.md) for the pinned ref, what is
vendored and why the desktop client is reference-only.

## Where this is

Every screen in the design handoff is built: Sessions and search, Chat with
token streaming, tool cards and blocking approvals, Logs & events,
Tools & integrations, Model, Cron, Notifications, Voice, the agent switcher and
add-agent — on top of the domain seam, the vendored Hermes client and its React
Native shims, and a theme layer whose accent follows the selected agent.

Settings are **generated from `/api/config/schema`**, so a setting Hermes adds
appears here on the next fetch rather than in the next app release.

Two things are deliberately not what the design drew, because no API backs them:

- **Voice is push-to-talk, not realtime.** Hermes's audio surface is three
  request/response REST endpoints with no duplex channel, so barge-in has
  nothing to interrupt.
- **Notifications need a host plugin, and answering still happens in the app.**
  Delivery once the app is closed is the plugin above. Resolving an approval
  *from the lock screen* is a further step, deliberately not taken: it would
  replace Hermes's built-in approval prompt for every client on that host,
  including the TUI and the desktop app (`docs/push-relay.md` §6).

Smaller absences — no approval countdown, no CPU/memory/disk tiles, no QR
pairing, no MCP reachability — are §2.6 of the architecture. In each case the
absence is stated once on screen rather than rendered as an empty tile.
