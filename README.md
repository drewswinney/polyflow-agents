# Agent Handheld

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

To point it at a real agent, use **Add an agent** in the switcher popover: host,
port and a pairing token approved on the host with `hermes pairing approve`.
Tokens go to the Keychain / Android Keystore, never to AsyncStorage.

## Checks

```bash
npm run typecheck    # includes the vendored upstream types
npm run check:m0     # the M0 gate, without needing a host
npm run spike:m0     # the M0 gate against a live `hermes serve`
```

`check:m0` is the one that matters in CI. It drives the *vendored, unmodified*
upstream gateway client through a fake socket and asserts that real-shaped
Hermes frames normalise into the domain's `SessionUpdate` union.

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
- **Notifications are local-only.** Delivery once the app is closed needs a
  relay on the agent host; its contract is written up in
  [docs/push-relay.md](docs/push-relay.md).

Smaller absences — no approval countdown, no CPU/memory/disk tiles, no QR
pairing, no MCP reachability — are §2.6 of the architecture. In each case the
absence is stated once on screen rather than rendered as an empty tile.
