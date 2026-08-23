# polyflow_agents_push

The host half of the app's notifications. A Hermes plugin, not a service — see
[`../../docs/push-relay.md`](../../docs/push-relay.md) for why, and for the
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
| Artifact produced | `post_tool_call` on `ARTIFACT_TOOLS` | "Artifact ready" |
| Turn finished | `on_session_finalize` | "Turn finished" |
| Cron job output | `deliver=polyflow_agents_push` delivery target | the rendered output |

Smart-mode approvals are skipped: an auxiliary LLM decides those and nobody is
being asked.

## Install

```bash
pip install polyflow-agents-push
polyflow_agents_push install --enable
```

Then restart `hermes serve` (hooks and the registration routes) and, if you want
cron delivery, the messaging gateway.

`install` links the installed package into `~/.hermes/plugins/polyflow_agents_push`, so
`pip install -U` is the whole upgrade. `--copy` copies instead, for hosts where
site-packages and the plugin directory are not on one filesystem. `polyflow_agents_push status` says where it landed and whether Hermes has it enabled.

**Why a second command at all**, when Hermes supports pip-installed plugins
through the `hermes_agent.plugins` entry-point group: that group covers hooks
and platforms. Dashboard backend routes are discovered by *scanning directories*
for `<name>/dashboard/manifest.json` — `_discover_dashboard_plugins()` reads
nothing else — and the backend route is where devices register. So the package
deliberately does **not** declare an entry point (a plugin discovered twice
registers its hooks twice, and every notification arrives twice with it) and
links itself into the directory Hermes scans instead.

**Enabling is not optional.** A user plugin's Python is never imported until its
name is in the `plugins.enabled` allow-list — that is the code-execution vector
GHSA-mcfc-hp25-cjv7 closed. Without it every face is silently absent.

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

## Cron delivery

`deliver=polyflow_agents_push` needs a home channel, which is what
`POLYFLOW_AGENTS_PUSH_HOME_CHANNEL`
is declared for (`cron_deliver_env_var` on the platform registration). Set it to
any non-empty value — the devices come from the registry, not from the channel.
Untested: no cron job has delivered here yet.

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
