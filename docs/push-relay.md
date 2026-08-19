# Notifications — the host-side plugin

**Status:** not built. This is the one part of the notification system that
cannot be built in the app, and it is the difference between notifications that
are *usually noticed* and notifications that are *reliably delivered*.

**Supersedes the sidecar design.** This document previously specified a
standalone service running beside `hermes serve`, holding its own WebSocket per
agent and exposing its own HTTP API. That is no longer the recommended shape.
Reading the Hermes source on the host turned up two plugin systems and one fact
that removes most of the sidecar's reason to exist — see §2. What survives from
the old design is the contract's *substance*: what gets delivered, what must
never travel in a payload, and the fact that answering from the lock screen
needs a real endpoint.

## 1. Why it is needed

Two facts from `architecture.md` still hold:

- **Hermes has no push support.** Nothing in the API sends anything to a device.
- **Only one agent holds a live socket** (§5.2). A notification for an agent the
  app is not connected to cannot originate in the app.

And one from the OS: neither iOS nor Android keeps a WebSocket alive in the
background indefinitely (§10.3). Once the process is gone the app cannot observe
`approval.request` or `background.complete`, no matter how it is written.

What the app ships today is the half that works without host support:
`src/state/notification-tap.ts` raises **local** notifications while the app is
running but not foregrounded. That covers "I looked away for a minute". It does
not cover "my phone was in my pocket for an hour", which is the case that
actually matters — the agent is halted on an approval and stays halted.

## 2. What the host actually offers

Verified against the pinned upstream tree (`hermes:~/.hermes/hermes-agent`, ref
`c86197e`), not assumed. Three findings, in descending order of importance.

### 2.1 The app is already a gateway platform

`Platform.API_SERVER = "api_server"` (`gateway/config.py`) is implemented by
`gateway/platforms/api_server.py` — the same file that emits the
`"approval.request"` event this app consumes over `/api/ws`. The phone's sessions
therefore run *inside* the gateway, alongside Telegram's and Discord's.

This is what kills the sidecar. The old design assumed a notifier would need its
own socket because nothing inside Hermes could see a phone-started session. It
can: an approval raised in one of our sessions goes through
`_await_gateway_decision(..., surface: str = "gateway")` in `tools/approval.py`,
in-process, where a plugin hook is already firing.

### 2.2 Two plugin systems, both file-drop, neither needing a core patch

**Platform plugins** — `~/.hermes/plugins/<name>/{plugin.yaml, adapter.py}` with a
`register(ctx)` entry point calling `ctx.register_platform()`. Documented
upstream in `gateway/platforms/ADDING_A_PLATFORM.md`, whose opening line is
"Plugin Path (Recommended for Community/Third-Party) … **zero changes to core
Hermes code**". `gateway/platform_registry.py` is a real self-registration table,
and `Platform._missing_()` mints enum members for registered plugins, so
`Platform("push")` resolves without touching the enum.

**Lifecycle hooks** — `hermes_cli/plugins.py` defines `VALID_HOOKS`, fired by
`invoke_hook(name, **kwargs)` from the agent core. Registered with
`ctx.register_hook(name, fn)`. Observers only: return values are ignored, and a
broken callback is caught and logged rather than allowed to break the pipeline.

There is a **third** hook mechanism — `~/.hermes/hooks/` with `HOOK.yaml` +
`handler.py`, firing `agent:start|step|end` and `session:*`. It is not used here:
those emits come only from `gateway/run.py` and `gateway/slash_commands.py`, so
they cover messaging-platform traffic and not the API server's sessions.

### 2.3 A registered platform inherits real delivery machinery

Not just message formatting:

- `gateway/delivery_ledger.py` — a durable per-send obligation row in `state.db`
  (`pending → attempting → delivered | failed`), with `sweep_recoverable()`
  redelivering rows whose owning process died. Built precisely because "a final
  agent response generated but not yet confirmed-delivered is the one artifact
  the gateway can lose without a trace".
- `gateway/dead_targets.py` — a persistent registry of targets proven
  unreachable, self-healing on the next successful send.
- `gateway/delivery.py` — routing for cron output and agent responses across
  explicit targets, platform home channels and origin.

Reimplementing that in a sidecar is the kind of work that looks small and is not.

## 3. The design

**One plugin with two faces.** Hooks for the events that fire in-process; a
registered platform for the delivery path that cron uses. Both live in the same
plugin directory and share one Expo push client.

```
~/.hermes/plugins/handheld-push/
  plugin.yaml          # metadata, requires_env, optional_env (drives the setup wizard)
  adapter.py           # register(ctx): register_hook × N, register_platform × 1
```

The platform face registers with:

- `cron_deliver_env_var` — names the `*_HOME_CHANNEL` env var so `deliver=handheld`
  routes here without editing `cron/scheduler.py`'s hardcoded sets.
- `standalone_sender_fn` — **required**, not optional. Cron jobs can run in a
  process separate from the gateway; without this, a `deliver=` job fires
  correctly and then fails the send with `No live adapter for platform '<name>'`.

## 4. Event coverage

| Event | Mechanism | Payload we get |
|---|---|---|
| Approval request | `pre_approval_request` hook | `command`, `description`, `pattern_key(s)`, `session_key`, `surface`, `session_id`, `turn_id`, `tool_call_id` |
| Approval resolved | `post_approval_response` hook | the above plus `choice` (`once`/`session`/`always`/`deny`/`timeout`) |
| Agent question | `pre_tool_call` on the `clarify` tool | `tool_name`, `args` (question, choices) |
| Artifact generated | `post_tool_call` | `tool_name`, `args`, `result` |
| Turn finished | `on_session_finalize` / `post_llm_call` | session identifiers |
| Cron job run | platform delivery target | the job's rendered output |

Notes that change behaviour rather than decorate it:

- **`surface` discriminates where the approval came from** — `"cli"`, `"gateway"`
  or `"smart"`. Ours are `"gateway"`. A smart-mode approval decided by the
  auxiliary LLM also fires both hooks, with `decided_by="aux_llm"`; those should
  not notify, since nobody is being asked for anything.
- **`post_approval_response` is what clears a stale notification.** An approval
  answered on the desktop must not leave a live banner on the phone.
- **Clarify has no answered-signal.** There is no post-hook and no dedicated
  clarify hook; `clarify` is simply a registered tool
  (`registry.register(name="clarify")`), so `pre_tool_call` fires before it
  blocks. Clearing those notifications is the app's job on reconnect.
- **"Artifact" is our word, not Hermes's.** There is no first-class artifact
  concept — it is tool output, matched by tool name (`write_file`, image/video
  generation). The bundled `disk-cleanup` plugin already does exactly this
  pattern against `write_file` and `terminal` results.
- **Cron delivery does not distinguish success from failure.** The app's existing
  preference is *failures only* (`src/state/notification-prefs.ts`), so the
  filtering is ours to do before sending.
- **Hooks cannot answer.** They are observers by design; a plugin cannot veto or
  pre-answer an approval. That is a correctness property, not a limitation to
  work around — see §6.

## 5. The device half

Nothing here is built yet; the app currently has no push-token code at all.

1. **EAS project.** `app.json` carries no `extra.eas.projectId`, so
   `getExpoPushTokenAsync({ projectId })` has nothing to resolve. `eas init` first.
2. **A real build.** Remote push does not work in Expo Go — it was removed in SDK
   53. Testing needs a development build; `eas.json` already carries the profile.
   iOS additionally needs an APNs key and Android an FCM sender, both via EAS
   credentials.
3. **Register the token**, idempotently, on every launch: Expo push tokens rotate.
4. **Route the tap.** `agentId` is load-bearing: a notification can arrive for an
   agent that is not selected, and tapping it must switch agents *before* opening
   the target screen, because the whole app re-scopes on switch (§5.2). Still an
   open design item in the handoff.
5. **New preference rows.** `notification-prefs.ts` covers approvals, turn
   complete and cron failures with quiet hours. Clarify and artifacts are new.

The registration endpoint is the plugin's, not a separate service's. Shape kept
from the previous design because the app is written to it:

```
POST   /devices                 { agentId, expoPushToken, platform }
DELETE /devices/{expoPushToken}
```

## 6. The open question: answering from the lock screen

The design's **Allow / Deny** chips (§7.12) must resolve the approval without
opening the app. Hooks cannot do this, so something must accept an inbound
request and call `tools.approval.resolve_gateway_approval`.

Two candidates, neither verified:

1. **Hermes's webhook gateway** — `/api/webhooks` is real inbound-HTTP
   infrastructure with per-route HMAC secrets, redacted on read and surfaced
   once on create. Whether a plugin can register a route, and whether a payload
   can carry the `request_id` through to a handler, is the next thing to check.
2. **A listener owned by the plugin** — more control, but it reintroduces the
   sidecar's port, supervision and TLS questions on a smaller scale.

Platform adapters also already define `send_exec_approval(chat_id, command,
session_key, description, ...)` — "render dangerous-command approval as
Approve/Deny buttons", with taps routed to `resolve_gateway_approval`. The
button semantics we want exist; what is unclear is how a push notification's
action, rather than a chat platform's, gets back into that path.

## 7. Constraints worth respecting

- **Never put the pairing token in a push payload.** It would be logged by
  Apple's and Google's infrastructure. The plugin holds the credential; the
  device holds only its own push token.
- **Supervision is inherited, not invented.** The plugin runs inside the process
  that runs the turn — `hermes serve` / the gateway, already systemd-managed
  (§11). This is strictly better than a sidecar with its own lifecycle, and it is
  the second reason to prefer this shape.
- **Plugin capabilities do not gate network egress.**
  `hermes_cli/plugin_capabilities.py` governs tool and LLM-provider overrides;
  calling Expo's push service needs no grant.
- **A broken plugin must not break approvals.** The hook dispatcher already
  swallows per-callback errors, and `tools/approval.py` logs and moves on when
  dispatch itself fails — "approval flow is safety-critical, plugin
  observability is not". Keep the plugin's own failure modes inside that
  contract: never block, never retry inline.

## 8. Still unverified

Listed so the next person does not mistake this document for a finished spec:

- Whether a plugin can register an inbound HTTP route (§6).
- Which process a hook fires in for **cron-driven** turns specifically. Kanban
  workers are documented as separate `hermes -p <profile> chat -q` subprocesses;
  cron may be similar, which is exactly why `standalone_sender_fn` exists.
- Whether `on_session_finalize` is the right "turn finished" signal for an
  api_server session, or whether `background.complete` on our own socket is
  better and the hook is redundant.
- Multi-agent fan-out: with one plugin per host, each Hermes pushes for itself,
  which dissolves the old design's "one socket per agent" problem. Worth
  confirming against a second agent before relying on it.
