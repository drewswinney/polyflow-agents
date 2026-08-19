# Notifications — the host-side plugin

**Status:** not built. This is the one part of the notification system that
cannot be built in the app, and it is the difference between notifications that
are *usually noticed* and notifications that are *reliably delivered*.

**Supersedes the sidecar design.** This document previously specified a
standalone service running beside `hermes serve`, holding its own WebSocket per
agent and exposing its own HTTP API. That is no longer the recommended shape.
Reading the Hermes source on the host turned up two plugin systems and one fact
that removes most of the sidecar's reason to exist — see §2. What survives from
the old design is the contract's *substance*: what gets delivered and what must
never travel in a payload. Answering from the lock screen turned out to be a
solved problem upstream — see §6.

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

### 2.1 The app's approvals take the gateway surface, in `hermes serve`'s process

**Corrected.** An earlier revision of this document said the app talks to
`gateway/platforms/api_server.py` (`Platform.API_SERVER`) and that its sessions
run inside the messaging gateway. That is the wrong file and the wrong process.
The real path is:

```
app ──/api/ws──► hermes serve ──► hermes_cli/web_server.py ──► in-process tui_gateway
```

`tui_gateway/server.py` serves the JSON-RPC the app speaks — `prompt.submit`,
`session.resume`, `config.set`. `gateway/platforms/api_server.py` is the
*messaging* gateway's own API platform: a different surface this app does not
use.

**The conclusion survives the correction**, for a different reason than stated.
Before running a turn, `tui_gateway` calls `_enable_gateway_prompts()`, which
sets `HERMES_GATEWAY_SESSION=1`, `HERMES_EXEC_ASK=1` and `HERMES_INTERACTIVE=1`
— exactly the env `tools/approval.py` reads to choose
`surface="gateway" if (is_gateway or is_ask) else "cli"`. So an approval raised
in one of our sessions is a **gateway-surface** approval, `pre_approval_request`
fires for it, and plugins are discovered in that process (approval.py's
`get_plugin_manager()` calls `discover_plugins()` before resolving a transport).

What the sidecar was for — a second socket, because nothing inside Hermes could
observe a phone-started session — is still unnecessary. The hooks fire where the
turn runs.

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

**One plugin with two faces, loaded by two processes.** Hooks for the events that
fire wherever the turn runs — for this app, `hermes serve` — and a registered
platform for the delivery path cron uses, which lives in the *messaging gateway*
process. One plugin directory, discovered independently by each process, each
registering what is relevant there. They share source and an Expo push client;
they do not share memory, so anything stateful (the device registry) has to live
on disk rather than in a module global.

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
  pre-answer an approval from one. That is a correctness property, not a
  limitation to work around — answering is a different API entirely (§6).

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

**Device registration has no channel yet.** The previous design assumed the
plugin would expose `POST /devices`, which assumed the plugin can serve HTTP —
still unverified (§6 resolved *answering*, not registration). The obvious
shortcut does not work either: `config.set` on the app's own gateway is a
curated if/elif over known keys and ends in `return _err(rid, 4002, f"unknown
config key: {key}")`, so the app cannot write `plugins.handheld_push.devices`
through it.

Options, in the order they should be tried:

1. **A loopback listener owned by the plugin.** Small, and the host is already
   reached over Tailscale or a tunnel, so no new exposure — but it is the
   sidecar's port question returning at reduced scale.
2. **A route on Hermes's webhook gateway** (`/api/webhooks`, per-route HMAC),
   if a plugin can register one.
3. **Out-of-band for now**: the deploy script writes the token into the plugin's
   config. Fine for one or two known devices, wrong the moment tokens rotate —
   and Expo push tokens rotate.

This is the last unanswered question in the design, and it is smaller than the
one §6 closed.

## 6. Answering from the lock screen — `register_approval_transport`

The earlier version of this document listed this as the open question, on the
assumption that hooks are observers and something else would have to accept an
inbound HTTP call. That assumption was wrong. Hermes has a first-class API for
exactly this: `PluginContext.register_approval_transport(name, present_fn)`,
contract in `hermes_cli/approval_transport.py`.

A transport is **handed the request and returns the human's decision**:

```python
ApprovalPresentFn = Callable[[ApprovalRequest], ApprovalDecision | Awaitable[ApprovalDecision]]
```

`ApprovalRequest` is immutable and already redacted (`redact_sensitive_text(...,
force=True)` runs before the plugin sees it), carrying `request_id`, `digest`,
`command`, `description`, `pattern_key(s)`, `surface`, `timeout_seconds` and
`allowed_choices`. The plugin pushes, waits however it likes, and returns
`request.respond("once" | "session" | "always" | "deny")`.

**The host owns every failure, and every failure is a denial.** From
`invoke_approval_transport`: worker capacity exhausted (8 concurrent) → `deny`,
timeout → `deny`, callback raised → `deny`, wrong return type → `deny`,
`request_id`/`digest` mismatch → `deny` ("stale"), choice outside
`allowed_choices` → `deny`, interrupted → `deny`. A late result is discarded and
"cannot authorize another request". The digest binding is what makes a push
round-trip safe: a decision cannot be replayed against a different request.

### 6.1 Selection is profile-wide config, not per-client

```yaml
security:
  approval:
    transport: handheld-push     # default "builtin"
    transport_fallback: builtin  # optional; anything else means fail closed
```

`_present_with_selected_transport` runs **before** the built-in prompt on both
call sites in `tools/approval.py`, with `surface` set to `"gateway"` or `"cli"`.
This is the consequence to design around: selecting our transport takes over
approvals for the whole profile, including the TUI, the desktop app and any
other client. The in-app approval sheet as it works today — `approval.request`
over `/api/ws`, answered with `approval.respond` — would no longer be the thing
being asked, because the built-in gateway prompt never runs.

`transport_fallback: builtin` is the safety valve: on any transport failure the
host falls through to the built-in prompt instead of denying. Without it, a
plugin that is down denies every command on the host. **Set it.**

### 6.2 Two coherent shapes

**A — transport-owned (full lock-screen resolve).** The plugin is the single
presenter: push out, decision back, `resolve_gateway_approval` never enters the
picture. The app's approval sheet is rewired to answer through the plugin rather
than `approval.respond`. This is what the API is built for and the only shape
that resolves an approval without opening the app. Cost: it changes the app's
existing approval path and takes over other clients on that host.

**B — hooks only (notify, answer in-app).** Keep `approval.request` /
`approval.respond` exactly as they are and use `pre_approval_request` purely to
raise the push. Tapping opens the app and the existing sheet answers. No
takeover, no protocol change, and no true lock-screen action.

B is the smaller step and is fully specified by §4 alone. A is the destination.
They share the plugin, the push client and the device registry, so B does not
have to be thrown away to get to A.

## 7. The approval timeout is real, and the design's countdown is buildable

`_get_approval_timeout()` reads `approvals.timeout`, **default 300 seconds**,
and its docstring names our exact case: "Gateway approvals arrive as push
notifications the user may not see for a couple of minutes; 60s proved too tight
in practice (Telegram taps landed after the wait had already failed closed)."

This corrects `architecture.md` §2.6, which reads the absence of an `expires_at`
field on the wire as meaning approvals have no TTL and the design's `expires
4:52` chip has nothing behind it. The event carries no expiry — that part
stands — but the host does enforce one, `approvals.timeout` is part of
`DEFAULT_CONFIG` and therefore visible through `/api/config/schema`, which the
app already reads. A countdown anchored to receipt time plus the configured
timeout is honest, and it is the same deadline the transport is racing.

Two practical consequences: a push notification worth acting on has a **five
minute** default life, not an indefinite one; and if a transport is selected,
that timeout is the budget for the whole round trip — delivery, lock-screen tap,
and the answer getting back to the plugin.

## 8. Constraints worth respecting

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

## 9. Still unverified

Listed so the next person does not mistake this document for a finished spec:

- **Device registration (§5)** — the one open question in the design.
- How the app's approval card answers a transport-presented request in shape A
  (§6.2) — the plugin owns that channel, and nothing about it is designed yet.
- Whether a plugin can serve HTTP at all, which both of the above turn on.
- Which process a hook fires in for **cron-driven** turns specifically. Kanban
  workers are documented as separate `hermes -p <profile> chat -q` subprocesses;
  cron may be similar, which is exactly why `standalone_sender_fn` exists.
- Whether `on_session_finalize` is the right "turn finished" signal for an
  api_server session, or whether `background.complete` on our own socket is
  better and the hook is redundant.
- Multi-agent fan-out: with one plugin per host, each Hermes pushes for itself,
  which dissolves the old design's "one socket per agent" problem. Worth
  confirming against a second agent before relying on it.
