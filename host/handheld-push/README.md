# handheld-push

The host half of the app's notifications. A Hermes plugin, not a service — see
[`../../docs/push-relay.md`](../../docs/push-relay.md) for why, and for the
verified hook inventory this is built on.

**Status: written, not yet run.** Nothing here has executed against a live
Hermes. Every claim below is read off the upstream source at ref `c86197e`; the
first deploy is the first test.

## What it does

| Event | Mechanism | Notification |
|---|---|---|
| Approval blocking a turn | `pre_approval_request` hook | "Approval needed" + the command |
| Approval answered anywhere | `post_approval_response` hook | data-only, so the app can dismiss a stale banner |
| Agent question | `pre_tool_call` on `clarify` | the question |
| Artifact produced | `post_tool_call` on `ARTIFACT_TOOLS` | "Artifact ready" |
| Turn finished | `on_session_finalize` | "Turn finished" |
| Cron job output | `deliver=handheld` delivery target | the rendered output |

Smart-mode approvals are skipped: an auxiliary LLM decides those and nobody is
being asked.

## Install

```
./scripts/deploy-plugin.sh hermes
```

Then restart the processes that load plugins — `hermes serve` for the hooks,
the messaging gateway for the platform face. They are separate processes and
each discovers the plugin independently; the registry on disk is what they
share.

## Device registration

The plugin owns no port. Registration arrives through **Hermes's webhook
gateway**, whose `deliver_only` mode skips the agent entirely and hands the
rendered payload straight to a delivery target — and delivery targets may be
plugin-registered platforms (`platform_registry.is_registered(deliver_type)` in
`gateway/platforms/webhook.py`). So the app POSTs to a webhook route that
delivers to us, and we treat the message as a control frame.

Add the route under `platforms.webhook.extra.routes` in `config.yaml`:

```yaml
handheld-register:
  secret: "<generate one; the app signs with it>"
  deliver: handheld
  deliver_only: true
  prompt: '#handheld:{"action":"{{ payload.action }}","token":"{{ payload.token }}","platform":"{{ payload.platform }}","label":"{{ payload.label }}"}'
```

The app then POSTs `{action, token, platform, label}` to
`https://<host>:<webhook-port>/webhooks/handheld-register`, HMAC-signed.

This reuses the webhook server's HMAC validation, rate limiting, idempotency
cache and body-size caps rather than reimplementing them. What it costs:

- **A second endpoint.** The webhook server is the messaging gateway's, on its
  own port — not the `hermes serve` port the app already talks to. The app needs
  both reachable.
- **A second secret on the device**, the route's HMAC key, stored in
  `expo-secure-store` like the pairing token. It is not the pairing token and
  must never be sent in a push payload.
- **A text channel carrying structured data.** `deliver_only` renders a template
  and the result is "the message", so registration rides a JSON line behind a
  `#handheld:` sentinel. It works and it is explicit, but it is a control frame
  on a channel designed for prose.

If a plugin ever gains a way to register an HTTP route directly, that replaces
all three costs and this becomes a footnote.

## Known weak points

- **Cron success and failure are indistinguishable.** Delivery targets carry no
  status, so `_looks_like_failure()` greps the rendered output for `error`,
  `failed`, `traceback`. The app's preference is failures-only, so a job whose
  normal output says "0 errors" will notify and a failure that says none of
  those words will not. This is the weakest thing in the plugin.
- **`on_session_finalize` may be the wrong "turn finished" signal.** It is
  unverified against an app session, and may be redundant with
  `background.complete`, which the app already sees on its own socket.
- **Preferences live per device in the registry**, not in the app alone. A
  closed app cannot filter its own push, so the host has to know. That means the
  app must re-register when preferences change, and a device whose registration
  is stale gets notifications it has since turned off.
- **Approvals ignore preferences by design** (`devices.wants`). A halted agent
  nobody is told about is a worse failure than an unwanted banner.

## Not implemented

Answering from the lock screen. `register_approval_transport` is the API for it
(`docs/push-relay.md` §6) and it would replace the built-in prompt for the whole
profile — including the TUI and the desktop app — so it is a deliberate second
step, not an oversight. This plugin only notifies; the app answers.
