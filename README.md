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

Built: the scaffold, the vendored client and its React Native shims, the domain
seam with Hermes and mock backends, the theme layer, Sessions with in-place
search, and Chat with token streaming, tool cards, approvals, cancel and
reconnect.

Not built yet: settings rendered from `/api/config/schema`, the Activity event
stream, logs, push-to-talk voice, and the push relay. Four designed features have
no API to back them and are descoped rather than faked — see §2.6 of the
architecture.
