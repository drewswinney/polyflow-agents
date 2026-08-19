# The push relay — what the host still needs

**Status:** not built. This is the one part of the app that cannot be built in the
app, and it is the difference between notifications that are *usually noticed*
and notifications that are *reliably delivered*.

## Why it is needed

Two facts from `architecture.md` force it:

- **Hermes has no push support.** Nothing in the API sends anything to a device.
- **Only one agent holds a live socket** (§5.2). A notification for an agent that
  is not the selected one cannot come from the app at all — the app is not
  connected to that agent.

And one from the OS: neither iOS nor Android keeps a WebSocket alive in the
background indefinitely (§10.3). Once the process is gone, the app cannot
observe `approval.request` or `background.complete`, no matter how it is written.

What the app ships today is the half that works without a relay:
`src/state/notification-tap.ts` raises **local** notifications while the app is
running but not foregrounded. That covers "I looked away for a minute". It does
not cover "my phone was in my pocket for an hour", which is the case that
actually matters — the agent is halted on an approval and stays halted.

## What it has to do

A small service on the agent host, beside `hermes serve`:

1. Hold its own WebSocket to `/api/ws` — one per agent it serves, permanently.
2. Watch for `approval.request`, `background.complete`, and failed `cron.*`.
3. Post to Expo's push service for each device registered against that agent.
4. Expose an endpoint the notification's action buttons can call, which
   round-trips `approval.respond` over its own socket.

Step 4 is the part that is easy to forget and hard to add later: the design's
lock-screen **Allow / Deny** chips have to resolve the approval without opening
the app, and a chat message cannot do that — it needs a real endpoint.

## The contract the app expects

The app is written to fit this shape; nothing here is implemented on the device
yet beyond the local path.

```
POST /devices                    { agentId, expoPushToken, platform }
DELETE /devices/{expoPushToken}
POST /approvals/{requestId}      { choice: 'once' | 'always' | 'deny', sessionId }
```

Notification payload:

```jsonc
{
  "title": "home hermes needs approval",
  "body": "zfs destroy -r tank/backup@repl-*",
  "categoryId": "approval",            // carries the Allow / Deny actions
  "data": {
    "agentId": "…",                    // the app switches agents before routing
    "sessionId": "…",
    "requestId": "…",
    "kind": "approval"
  }
}
```

`agentId` is load-bearing. A notification can arrive for an agent that is not
selected, and tapping it has to switch agents *before* opening the target screen
— the whole app re-scopes on switch (§5.2). This is listed as an open design
item in the handoff and is still undesigned.

## Constraints worth respecting

- **Never put the pairing token in a push payload.** It would be logged by
  Apple's and Google's infrastructure. The relay holds the credential; the
  device holds only its own push token.
- **The relay's socket is the reliability boundary.** If it drops, nobody gets
  notified and nothing says so. It needs its own supervision (systemd, like
  `hermes serve` itself — §11) and a visible health signal.
- Expo push tokens rotate. `POST /devices` has to be idempotent and callable on
  every launch.
- Remote push does **not** work in Expo Go on Android, and the project is
  currently pinned to Expo Go (see the README). Testing this needs an EAS
  development build — `eas.json` already carries the profile.
