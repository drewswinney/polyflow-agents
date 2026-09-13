# Store listing copy

What goes in App Store Connect's *App Information* and version pages, and the
Google Play equivalents where they differ. The limits in brackets are Apple's;
`npm run check:listing` (below) counts them. Kept here so the copy is versioned
with the app it describes, and so the constraints in
[`review-notes.md`](review-notes.md) ("what the app does not do") are one
folder away when someone edits it.

The rule for all of it: every sentence must be true of the demo agent or of a
real Hermes host today. Nothing about OpenAI-compatible hosts, share links, or
QR pairing (see review-notes.md).

## App Information

| Field                  | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Name [30]              | Polyflow Agents                                                                    |
| Subtitle [30]          | Your Hermes agent, remote                                                          |
| Primary category       | Productivity                                                                       |
| Secondary category     | Developer Tools                                                                    |
| Content rights         | Does not contain, show, or access third-party content                              |
| Age rating             | 4+ — answer *None* to every questionnaire item; there is no web browser, no gambling, no UGC of ours (see note below) |
| Copyright              | 2026 Drew Swinney                                                                  |
| Support URL            | https://github.com/polyflowlabs/polyflow-agents/issues                             |
| Marketing URL          | https://github.com/polyflowlabs/polyflow-agents                                    |
| Privacy policy URL     | the published copy of [`privacy-policy.md`](privacy-policy.md)                     |
| Sign-in required?      | No — the demo agent needs no credentials (review-notes.md has the tap-path)        |

**Age rating note.** The questionnaire asks about "unrestricted web access" and
"user-generated content". Answer no to both: the app renders only what the
user's own host returns, and there is no community, feed, or sharing between
users. If a reviewer treats the agent's replies as AI-generated content, the
honest answer is that they are — produced by software the user runs themself,
on their own computer, with a provider they chose.

Subtitle alternatives, if the first reads as too narrow:

- `Remote control for your agent` (29)
- `Talk to the agent you host` (26)

## Version page

### Promotional text [170]

Shown above the description; editable any time without a new build, so it is
also where a release gets announced later without rewriting the description.

> A window onto the AI agent running on your own machine. Talk to it, see what it makes, and approve what it asks — no account, no middleman, just your host.

### Description [4000]

> Polyflow Agents is a phone client for an AI agent that runs on a computer you own. If you run Hermes — the open-source agent host — this puts that agent in your pocket: the same sessions, the same tools, the same memory, reachable from wherever you are.
>
> There is no account to create and no server of ours in the middle. The app connects straight to your host, over your own network or a private tailnet, and sends everything you do to it and nowhere else.
>
> TALK TO YOUR AGENT
> Type a message, dictate one, or send a photo. Replies stream in as the agent writes them, with each tool it uses shown as it runs. Sessions are persistent: pick one up from the list, search across them, rename, pin, or delete.
>
> APPROVE THE RISKY BITS
> When the agent needs permission — to run a command, say — it stops and asks. With the host plugin installed you get a push notification, and Allow or Deny is one tap from the lock screen. Deny sends it back to think again; nothing runs until you say so.
>
> EVERYTHING IT MAKES, KEPT
> Reports, pages, images, and files the agent produces land in Artifacts, ready to open on the phone. Versions are kept when a file is rewritten, so you can see what changed.
>
> SEE WHAT IT IS DOING
> Scheduled jobs, with their last result and next run. Tools and integrations. The model and provider it is set up to use. Logs and events, when you want to know why.
>
> SEVERAL AGENTS, ONE AT A TIME
> A host can run more than one agent. Add a server once and the app asks what it hosts; switch between agents and the whole app re-scopes to the one you picked.
>
> WHAT YOU NEED
> A Hermes host you can reach from your phone — on the same network, or through a tailnet such as Tailscale. Push notifications need a small plugin on the host; the app walks you through installing it, or can send the instructions to the agent to do itself.
>
> No host yet? Tap "Try the demo agent" on the first screen. It answers with a scripted conversation, asks for a permission, and produces an artifact, so you can see every screen before you set anything up.
>
> WHAT WE DO NOT DO
> We do not run analytics. We do not collect crash reports. We do not see your conversations, your files, or your credentials — they go to your host and stay there. Your sign-in is kept in the phone's keychain and sent only to the host you gave it to.
>
> Polyflow Agents is open source, MIT licensed.

### Keywords [100]

Comma-separated, no spaces after commas (Apple counts them). Do not repeat
words already in the name or subtitle — Apple indexes those separately.

> hermes,ai,assistant,self-hosted,llm,chat,approvals,tailscale,remote,mcp,automation,cron

### What's New [4000]

For 0.1.0:

> First release. Talk to the agent on your own Hermes host, approve what it asks from a notification, and open what it makes in Artifacts. Try the demo agent on the first screen if you do not have a host yet.

### Screenshots

Take them from the demo agent so nothing private appears (review-notes.md).
Suggested order, one screen per point in the description:

1. Chat, mid-stream, a tool card open
2. Approval card, Allow / Deny visible
3. Artifacts list
4. Sessions list
5. Scheduled
6. Welcome screen with the three points

## Google Play, where it differs

| Field                       | Value                                        |
| --------------------------- | -------------------------------------------- |
| Short description [80]      | Talk to the AI agent on your own computer. No account, no server in between. |
| Full description [4000]     | The description above, unchanged; Play allows the same plain-text sections. |
| App category                | Productivity                                 |
| Tags                        | AI assistant, Developer tools, Productivity  |
| Content rating              | IARC questionnaire — no to everything; Everyone |

## Checking the limits

```bash
npm run check:listing
```

reads this file and fails if any bracketed field is over its limit or the
keywords contain a space after a comma.
