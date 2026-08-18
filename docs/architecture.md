# Agent Handheld — Architecture

A cross-platform (iOS + Android) mobile client for a [Hermes](https://github.com/) agent,
designed so the agent harness behind it can be swapped later.

**Status:** design draft, reconciled against the visual design handoff.
**Decisions locked:** React Native + Expo · Tailscale transport · both platforms from
day one · multi-agent, one active at a time.

> Section numbers §1–§7 are referenced by `docs/design/github.md`. Keep them stable.

---

## 1. Goals

| # | Goal | Notes |
|---|------|-------|
| G1 | Chat with the agent across multiple, persistent sessions | List, resume, search, rename, pin, delete |
| G2 | Manage the agent from Settings | Model, providers, skills, MCP servers, cron, profiles |
| G3 | Connect to the agent host remotely | Tailscale; SSH retained for admin only |
| G4 | Allow the harness to be swapped later | Hermes today; an OpenAI-compatible agent as the second tier |
| G5 | One codebase, two platforms | No iOS-only or Android-only feature paths |
| G6 | Manage several agents, one active at a time | The whole app re-scopes on switch; nothing merges across agents |

### Non-goals (v1)

- Hosting the agent on-device. The phone is a **client**; the agent runs on the host.
- Replacing the Hermes desktop app. This targets phone-shaped, on-the-go use.
- Local inference or offline agent turns. Offline = read cached transcripts, queue sends.
- A combined cross-agent view. No merged approval queue, no merged spend (§7.13).

---

## 2. What Hermes already gives us

This is the single most important finding, and it drives every decision below.
Hermes is **not** a CLI we have to screen-scrape. It ships a real backend and a
reusable client.

### 2.1 The backend

`hermes serve` is, per its own `--help`:

> Run the Hermes backend server — the JSON-RPC/WebSocket gateway the desktop app
> and remote clients connect to. Headless: it never opens a browser UI.

- Default bind: `127.0.0.1:9119`
- **REST** at `/api/*` — a broad, already-complete surface (see §2.3)
- **WebSocket** at `/api/ws` — JSON-RPC framing, carries the live agent event stream
- Auth is mandatory on any non-loopback bind (the old `--insecure` bypass is a
  documented no-op as of the June 2026 hardening)
- `--ssh-session-token-file` / `--ssh-owner-nonce` exist specifically for the
  desktop-over-SSH case, confirming remote clients are a supported pattern

Implication: **we do not design a protocol.** We implement a client for one that exists.

### 2.2 The reusable TypeScript client

Three pieces in the Hermes tree, all free of React/JSX:

| Path | What it is | Why it matters |
|---|---|---|
| `apps/shared` (`@hermes/shared`) | Package with **zero runtime dependencies** — only devDep is TypeScript. Contains `json-rpc-gateway.ts`, `websocket-url.ts`, `backend-scope.ts` | Vendors into React Native as-is |
| `apps/desktop/src/types/hermes.ts` | The complete API type surface | Free, accurate types |
| `apps/desktop/src/hermes.ts` | ~2,160 lines wrapping every `/api/*` endpoint. Zero React references | Free, maintained API client |

This is the core argument for the TypeScript stack: in Swift or Kotlin we would
hand-port ~2,800 lines of client code, then re-port on every Hermes release.
Hermes is actively developed. Here we vendor and diff instead. See §9.

### 2.3 The REST surface (abridged)

Discovered by extracting endpoint paths from `apps/desktop/src/hermes.ts`:

- **Sessions** — `/api/sessions`, `/api/sessions/{id}`, `/api/sessions/search`
- **Config** — `/api/config`, `/api/config/schema`, `/api/config/defaults`, `/api/env`
- **Model** — `/api/model/{info,set,options,auxiliary,moa,recommended-default}`
- **Providers** — `/api/providers/{oauth,validate,custom-endpoints}`
- **Skills** — `/api/skills`, `/api/skills/content`, `/api/skills/hub/{search,preview,install,sources,scan}`
- **MCP** — `/api/mcp/{servers,catalog,catalog/install,oauth/flows}`
- **Cron** — `/api/cron/{jobs,blueprints,delivery-targets}`
- **Profiles** — `/api/profiles`, `/api/profiles/sessions`, `/api/profiles/sessions/sidebar`
- **Memory / learning** — `/api/memory`, `/api/learning`, `/api/learning/graph`
- **Ops** — `/api/ops/{doctor,backup,security-audit,debug-share}`, `/api/logs`, `/api/analytics/usage`
- **Auth** — `/api/pairing`, `/api/pairing/{approve,revoke}`, `/api/auth/ws-ticket`
- **Messaging** — `/api/messaging/platforms`
- **Audio** — `/api/audio/{speak,transcribe,elevenlabs/voices}`

`/api/config/schema` deserves special attention: the server describes its own
configuration. The Settings UI should **render from that schema** rather than
hardcoding a form per setting, so the app doesn't need a release every time
Hermes adds a toggle. This is the single highest-leverage decision in the app.

### 2.4 The event stream

From `apps/shared/src/json-rpc-gateway.ts`, the `GatewayEventName` union:

```
gateway.ready     session.info      session.usage
message.start     message.delta     message.interim    message.complete
thinking.delta    reasoning.delta   reasoning.available
status.update
tool.start        tool.progress     tool.complete      tool.generating
clarify.request   approval.request  sudo.request       secret.request
background.complete
error             skin.changed
```

Events arrive as JSON-RPC notifications with `method: "event"` and
`params: { type, session_id, payload }`.

Client→server calls observed in the desktop app:

```
prompt.submit
approval.respond   clarify.respond    sudo/secret via *.respond
config.set
process.kill
reload.mcp
wake.feed / wake.pause / wake.resume
```

Three consequences for the UI:

1. **Streaming is token-level.** `message.delta` / `thinking.delta` need a render
   path that does not re-render the whole transcript per token (§7.3).
2. **The agent can block on the user.** `approval.request`, `clarify.request`,
   `sudo.request`, `secret.request` all mean "the turn is halted until you
   answer." On a phone this is the *defining* interaction — a laptop user is
   already looking at the screen; a phone user is not. This drives the
   notification design (§10.2).
3. **`background.complete`** exists, meaning turns can finish while the app is
   backgrounded. This is what makes push notifications worth building.

### 2.5 Current host state

Observed on the `hermes` host (`10.0.0.68`, Debian 13 on Proxmox, key auth via
`~/.ssh/hermes`):

- Hermes installed at `~/.local/bin/hermes`, source tree at `~/.hermes/hermes-agent`
- `hermes serve` **not currently running** — only port 22 is listening
- Tailscale **not installed**
- A messaging gateway is configured (`gateway.pid`, `channel_directory.json`, Discord threads)

Both gaps are addressed in §12.

### 2.6 What Hermes does *not* provide

The visual design (`docs/design/`) specifies four things the API cannot back
today. Each was checked against the Hermes source, not assumed. These are the
main reason the design and this document disagree anywhere.

| Design element | Reality | Resolution |
|---|---|---|
| Voice mode: `realtime · 180ms round trip`, barge-in | Audio is three request/response REST endpoints — `/api/audio/transcribe`, `/api/audio/speak`, `/api/audio/elevenlabs/voices`. No duplex channel exists | **Descoped to push-to-talk** (§7.9) |
| Activity: CPU / memory / disk tiles | No `/api/monitoring`, `/metrics`, `/system` or `/host` endpoint. `hermes monitoring` is OTLP export to an operator endpoint, explicitly "content-free by construction" | **Tiles dropped**; ship what is backed (§7.5) |
| Approval countdown, `expires 4:52` | `expires_at` appears only on OAuth types (`OAuthProviderStatus`, `OAuthPollResponse`). Approval requests carry no TTL | **No countdown** until the API grows one (§7.6) |
| QR pairing, `hermes pair` | `hermes pairing` is `list / approve / revoke / clear-pending`. No `pair` subcommand, no token issuance, no QR flow | **Manual host + token only** (§7.8) |

---

## 3. Architecture

Four layers, strictly one-directional. The rule that makes G4 achievable is that
**no Hermes-shaped type may appear above the Domain layer.**

```
┌───────────────────────────────────────────────────────────┐
│  UI                     screens, components, navigation   │
│                         React Native + Expo               │
├───────────────────────────────────────────────────────────┤
│  State                  TanStack Query (server state)     │
│                         Zustand (local/ephemeral)         │
├───────────────────────────────────────────────────────────┤
│  Domain    ★            AgentBackend interface            │
│                         Agent, Session, Message, ToolCall │
│                         ← the harness-swap seam           │
├───────────────────────────────────────────────────────────┤
│  Backends               HermesBackend    (REST + WS)      │
│                         OpenAiCompatBackend               │
│                         MockBackend      (tests, demos)   │
├───────────────────────────────────────────────────────────┤
│  Vendored               @hermes/shared, hermes types      │
└───────────────────────────────────────────────────────────┘
```

★ = the seam. Everything above it is harness-agnostic.

---

## 4. The `AgentBackend` seam

Two backends ship in v1, matching the two agent kinds the design offers when
adding an agent (§7.14):

- **`hermes`** — full support: sessions, streaming, tools, approvals, skills, cron, MCP
- **`other`** — any agent that speaks **OpenAI-compatible streaming**; deliberately
  reduced to model and tools

An earlier draft built this seam on **ACP** (Agent Client Protocol) vocabulary.
That was over-engineering for v1: ACP is a richer protocol than the second tier
actually needs, and OpenAI-compatible streaming is what an arbitrary agent is
overwhelmingly likely to already speak. ACP remains a natural *third* backend —
`hermes acp` exists, and the interface below is close enough to ACP's session
model that adding it later is additive.

```ts
export interface AgentBackend {
  readonly capabilities: Capabilities

  connect(signal?: AbortSignal): Promise<void>
  disconnect(): void
  readonly connectionState: Observable<ConnectionState>

  // Sessions
  listSessions(query?: SessionQuery): Promise<SessionSummary[]>
  createSession(opts: NewSessionOptions): Promise<SessionId>
  loadSession(id: SessionId): Promise<SessionTranscript>
  deleteSession(id: SessionId): Promise<void>
  renameSession(id: SessionId, title: string): Promise<void>

  // Turns
  prompt(id: SessionId, content: ContentBlock[]): Promise<void>
  cancel(id: SessionId): Promise<void>

  // The agent asking us something
  respondToPermission(reqId: string, outcome: PermissionOutcome): Promise<void>
  respondToClarify(reqId: string, answer: string): Promise<void>

  // Live stream
  subscribe(id: SessionId, sink: (u: SessionUpdate) => void): Unsubscribe
}
```

`SessionUpdate` is a **normalised** discriminated union — not Hermes's raw event
names:

```ts
type SessionUpdate =
  | { kind: 'agent_message_chunk';   text: string }
  | { kind: 'agent_thought_chunk';   text: string }
  | { kind: 'tool_call';             call: ToolCall }
  | { kind: 'tool_call_update';      id: string; status: ToolStatus; output?: string }
  | { kind: 'permission_request';    req: PermissionRequest }
  | { kind: 'clarify_request';       req: ClarifyRequest }
  | { kind: 'turn_complete';         stopReason: StopReason }
  | { kind: 'usage';                 usage: Usage }
  | { kind: 'error';                 error: AgentError }

type ToolStatus = 'pending' | 'running' | 'ok' | 'error' | 'unknown'
```

`HermesBackend` maps Hermes events onto this (`message.delta` →
`agent_message_chunk`, `tool.start`/`tool.progress`/`tool.complete` → `tool_call`
+ `tool_call_update`, and so on). The mapping table lives in one file and is the
only place that knows Hermes's event names.

`unknown` is a first-class `ToolStatus`, not an error: when a socket drops
mid-turn the app must not guess whether a tool completed (§5.4, §7.16).

### 4.1 Capability negotiation

Not every harness has cron jobs, skills or MCP servers. The backend declares what
it supports and the UI omits what isn't there. The design draws this explicitly —
a non-Hermes agent's Settings lists what it *doesn't* report as chips, and
Activity explains the absence in a card rather than rendering blank tiles.

```ts
interface Capabilities {
  sessions: { search: boolean; rename: boolean; pin: boolean }
  settings: { schemaDriven: boolean; model: boolean; providers: boolean }
  extras:   { cron: boolean; skills: boolean; mcp: boolean; profiles: boolean }
  approvals:{ requests: boolean; policy: boolean }
  activity: { spend: boolean; events: boolean }
  media:    { images: boolean; audioIn: boolean; audioOut: boolean }
}
```

`HermesBackend` reports nearly everything true. `OpenAiCompatBackend` reports
sessions plus prompt and little else. The governing rule, taken from the design:

> Absent capabilities are stated once, never rendered as blank tiles — and never
> shown disabled.

### 4.2 Anti-goals for this layer

- No leaking `snake_case` Hermes fields into components. Normalise at the boundary.
- No `if (backend instanceof HermesBackend)` anywhere in UI or State.
- No Hermes-specific strings in navigation, i18n keys, or analytics events.

---

## 5. Agents, transport & auth

### 5.1 Why Tailscale

Chosen over an in-app SSH tunnel. The reasoning:

| | Tailscale | In-app SSH tunnel | LAN direct |
|---|---|---|---|
| Client code | none — plain HTTPS/WSS | embed SSH lib, run forwarder in-process | none |
| Works off-LAN | yes | yes | no |
| Survives app backgrounding | yes | poorly — iOS suspends the forwarder | yes |
| New infra | Tailscale on host + phone | none | none |
| Reconnect complexity | normal WS reconnect | WS reconnect *on top of* tunnel re-establishment | normal |

iOS has no OS-level port forwarding, so "SSH tunnel" means embedding an SSH
library and running a forwarder inside the app process — which iOS then suspends
on background, forcing a tunnel rebuild *and* a WS reconnect on every resume.
Tailscale removes that entire failure class for the cost of one install.

SSH stays in the picture for **host administration** (starting `hermes serve`,
reading logs), not as the app's data path.

### 5.2 The Agent is the unit

**Agent** is the single user-facing noun. It owns the backend kind, the
connection and the profile, so the harness is a *property* of an agent rather
than a concept the user ever meets.

```ts
interface Agent {
  id: string
  displayName: string           // "home hermes", "garage pi"
  kind: 'hermes' | 'other'      // never shown in UI as a label
  icon: string                  // one distinct glyph per agent
  host: string                  // hermes.tailnet.ts.net:9119
  authMode: 'token' | 'oauth'
  profile?: string              // Hermes multi-profile support
  connection: 'connected' | 'idle' | 'offline'
  capabilities: Capabilities
}
```

```
Phone (Tailscale)  ──── WSS/HTTPS ────►  hermes host (Tailscale)
                                          hermes serve
                                          bound to tailnet addr :9119
```

Three rules follow, and all three are drawn in the design:

1. **Sessions are agent-scoped.** Session IDs are only unique within a backend, so
   the sessions list, search, activity and settings all filter by
   `selectedAgentId`. This is the part that is genuinely painful to retrofit.
2. **One live socket at a time.** Holding a socket per agent costs battery and
   loses to background limits anyway. Connect lazily on switch. The consequence:
   background completion for *non-selected* agents can only arrive by push, which
   is why §10.2 picks the server-side relay.
3. **Nothing merges across agents.** No combined approval queue, no combined spend.

Secrets go in `expo-secure-store` (Keychain / Android Keystore), never in
AsyncStorage or Zustand-persisted state.

### 5.3 Auth flow

Hermes offers three shapes; we support two:

1. **Token** — bearer token on REST; `?token=` on the WS upgrade. Simple, good for v1.
2. **OAuth-gated** — REST uses the OAuth session; WS needs a **single-use ticket**
   minted via `POST /api/auth/ws-ticket`, TTL **30 seconds**, consumed on upgrade.
3. *(Not used)* the process-lifetime internal credential — server-spawned children only.

The 30-second TTL has a hard design consequence: **mint the ticket immediately
before opening the socket, never cache it, and re-mint on every reconnect.**
A phone that wakes from background after an hour has a stale everything; the
reconnect path must be mint-then-dial, in that order. `resolveGatewayWsUrl()` in
`@hermes/shared` already implements exactly this — another argument for vendoring.

Device enrolment uses `hermes pairing`: the user runs `hermes pairing approve` on
the host, and `hermes pairing revoke` gives a real "lost my phone" story. Note
that there is **no QR flow and no token-issuance command** (§2.6) — enrolment is
host + token, typed (§7.8).

### 5.4 Reconnect

`JsonRpcGatewayClient` ships backoff and a 15s connect timeout (chosen upstream
specifically so a sleep/wake reconnect doesn't hang the composer). We reuse it
rather than reinventing, and add mobile-specific triggers:

- App foreground → verify socket, reconnect if needed
- `NetInfo` transition (cell ↔ wifi ↔ tailnet) → force reconnect
- On reconnect: re-fetch the active session transcript to close any gap in the
  delta stream. **Never** assume the stream resumes losslessly.

The design specifies the user-visible half of this, and it is better than a bare
retry. Session state is authoritative on the agent; the app is a reconnecting
client that replays from the last event it saw:

- Outgoing messages **queue in an outbox** and send on reconnect
- The transcript keeps the truncated sentence and marks a **stream-cut point**
- In-flight tool calls become `unknown` — the app does not guess the outcome
- The agent keeps working on the VM regardless; the banner says so

---

## 6. Project structure

```
agent-handheld/
├── app/                        # expo-router routes
│   ├── (tabs)/
│   │   ├── index.tsx           sessions (+ in-place search)
│   │   ├── activity.tsx
│   │   └── settings.tsx
│   ├── chat/[id].tsx
│   └── agents/new.tsx
├── src/
│   ├── domain/                 ★ AgentBackend, Agent, models, capabilities
│   ├── backends/
│   │   ├── hermes/             REST client, gateway wiring, event mapping
│   │   │   └── adapters/       wrappers over vendored code (never patches)
│   │   ├── openai-compat/
│   │   ├── mock/
│   │   └── registry.ts         the one live backend (§5.2)
│   ├── state/                  TanStack Query hooks, Zustand stores, stream tail
│   ├── ui/                     components, theme tokens
│   └── platform/               secure storage, RN polyfills
├── vendor/hermes/              vendored upstream TS (see §9)
├── scripts/                    upstream sync, M0 checks
└── docs/
    ├── architecture.md         this file
    └── design/                 visual handoff (README, canvas, screen map)
```

The directory and the remote are both `agent-handheld`, matching
`docs/design/github.md`. `main` is the default branch.

---

## 7. Screens

Identical information architecture on both platforms; only the chrome differs.
`docs/design/README.md` is the authoritative visual spec — exact hex values, type
sizes, spacing and touch targets. This section covers **behaviour and API
backing**; it deliberately does not duplicate the tokens.

Three tabs: **Sessions · Activity · Settings**. Everything else is a sub-screen
reached by a back chevron.

| # | Screen | Kind | Backed by |
|---|---|---|---|
| 7.1 | Sessions | tab | `/api/sessions` |
| 7.2 | Chat | sub | `/api/ws`, `prompt.submit`, `process.kill` |
| 7.3 | *(streaming performance)* | — | — |
| 7.4 | Settings | tab | `/api/config/schema`, `/api/model/*` |
| 7.5 | Activity | tab | `/api/analytics/usage`, `/api/logs` |
| 7.6 | Approval sheet | modal | `approval.request` → `approval.respond` |
| 7.7 | Search | in-place | `/api/sessions/search` |
| 7.8 | Pairing / onboarding | sub | `hermes pairing approve` (manual) |
| 7.9 | Voice (push-to-talk) | sub | `/api/audio/transcribe`, `/api/audio/speak` |
| 7.10 | Tools & integrations | sub | `/api/mcp/servers`, `/api/skills` |
| 7.11 | Model & behavior | sub | `/api/model/*`, `/api/memory` |
| 7.12 | Notifications | sub | device-local + push relay (§10.2) |
| 7.13 | Agent switcher | popover | local state |
| 7.14 | Add an agent | sub | local + reachability probe |
| 7.15 | Logs & events | sub | `/api/logs` |
| 7.16 | Connection lost | state | — |

### 7.1 Sessions

List with title, last-message preview, relative time, model badge, pinned state,
grouped by recency. Backed by `/api/sessions`, **filtered by `selectedAgentId`**.
Search via `/api/sessions/search` (server-side — the store is SQLite with FTS5,
so don't filter client-side). Swipe actions for pin/delete/rename.

A session blocked on the user surfaces a status strip on its card ("Waiting on
your answer"). The design pairs that with a countdown, which has no backing field
(§2.6) — ship the strip without the timer.

An **empty state** for a freshly paired agent offers three concrete, agent-specific
starter prompts rather than a bare "no sessions" message.

### 7.2 Chat

The core screen and the one that earns the app.

- Streaming assistant text with token-level updates and a block cursor
- Collapsed **thinking/reasoning** blocks, expandable
- **Tool calls as first-class cards** — name, argument summary, duration, status,
  collapsible output. Do not render tool traffic as chat text; on a phone it
  drowns the conversation
- Composer: text, attachment, push-to-talk mic (§7.9)
- One 48px action slot with three states — disabled → send → **stop**. Cancel
  (`process.kill`) lives in the composer while streaming, *not* in the overflow menu
- Overflow menu: rename session, switch model, view raw events
- Usage/cost readout from `session.usage`

### 7.3 Streaming performance

The one genuine technical risk in a React Native chat client. Mitigations,
in order of application:

1. Accumulate deltas in a **ref**, flush to state on a ~60ms timer — never
   `setState` per token.
2. Only the **last** message bubble subscribes to the streaming store; completed
   messages are `memo`'d and never re-render.
3. `FlashList` over `FlatList` for the transcript.
4. Markdown parsing debounced during streaming; parse fully on `message.complete`.

If this proves insufficient, the fallback is a native streaming text component
behind the same interface — contained, not architectural.

### 7.4 Settings

Sections: **Connection**, **Agent** (model & providers, skills, MCP servers, cron),
**This phone** (notifications, logs & usage), **About**.

Rendered from `/api/config/schema` (§2.3) and gated on `capabilities` (§4.1). A
non-Hermes agent shows only Model and Tools, plus a card naming what it doesn't
report and a destructive "Remove this agent" row. Destructive actions require
explicit confirmation.

### 7.5 Activity

Spend today against cap (`/api/analytics/usage`), uptime and round-trip latency
(measured client-side), a dependency-down alert row, and an **event stream** of
`tool.result` / `approval.granted` / `cron.fired` / `session.resumed` rows.

The design's 2×2 grid also shows CPU, memory and disk. **Those three are cut** —
no endpoint backs them (§2.6). Applying the design's own rule, the absence is
stated once rather than rendered as blank tiles. If host metrics become
worthwhile later, they need a companion service on the VM, not a Hermes change.

### 7.6 Approval sheet

Blocking bottom sheet over a dimmed transcript. Shield icon, plain-language
consequence sentence naming the host, the exact command in a mono code block,
then three outcomes: **Allow once** / **Always allow** / **Deny** →
`approval.respond`. The held tool card shows `held`.

No expiry countdown (§2.6). If the API grows a TTL, the countdown is additive.

### 7.7 Search

Expands **in place** in the header — not a route, not a modal. Scope label names
the current agent. Results show title, timestamp and a context snippet with the
query term highlighted, followed by an all-sessions list. Cancel collapses back.

### 7.8 Pairing / onboarding

Two steps. Manual enrolment only: host:port, masked pairing token with an eye
toggle, display name. The design leads with a QR scanner and names `hermes pair`;
neither exists (§2.6), so the manual path is promoted to primary until it does.

### 7.9 Voice — push-to-talk

**Descoped from the designed realtime mode.** Hermes has no duplex audio channel,
so barge-in and a 180ms round trip are not buildable today (§2.6). v1 is:

record → `/api/audio/transcribe` → normal turn → optional `/api/audio/speak`.

Everything still lands in the text transcript, and "Type" still returns to the
composer without ending the session — both preserved from the design. The
designed listening/speaking screens are kept in `docs/design/` for a later
realtime pass; building them would require new server-side work alongside §10.2.

### 7.10 Tools & integrations

MCP servers are **navigation rows, not toggles** — each has status, a tool list
and its own failure mode. Approval policy is a **single segmented control**
(Nothing / Destructive / Every tool), not independent switches. Skills list with
versions plus an install-from-hub row.

Governing rule from the design: toggles are only for genuine on/off preferences;
objects with their own status are navigation rows; one decision gets one control.

### 7.11 Model & behavior

Radio list of models with provider and context metadata, temperature slider,
system-prompt preview with edit, and a persistent-memory toggle backed by
`/api/memory`. Header carries a Save action.

### 7.12 Notifications

Toggle list (approval requests, agent needs input, cron results, every message),
quiet hours, and a lock-screen preview showing inline **Allow** / **Deny** action
chips. Those chips must round-trip `approval.respond`, which is only possible via
the push relay in §10.2.

### 7.13 Agent switcher

Popover from the centered header pill. Rows show status dot, icon, name and a
kind/state token (`hermes · 28ms`, `hermes · idle 3d`, `openai-agents`,
`hermes · offline`), with a check on the current agent and an "Add an agent" row.
Offline agents stay listed and dimmed rather than disappearing. Selecting one
re-scopes the entire app (§5.2).

### 7.14 Add an agent

**Kind first**, because it determines everything after: "Another Hermes" (full
support) or "Something else" (any agent speaking OpenAI-compatible streaming).
Then host:port, token, display name. Reachability is probed before pairing;
offline hosts can still be saved. Opening line sets the model: *"Agents stay
separate. Sessions, settings, and history never mix between them."*

### 7.15 Logs & events

Filter chips (All / Tools / Approvals / Errors), 48px event rows with timestamp,
name and status token, one expandable to pretty-printed JSON. Backed by
`/api/logs`.

### 7.16 Connection lost mid-turn

Warning banner with retry countdown, a dashed **stream-cut marker** in the
transcript, in-flight tool cards showing `unknown`, and a composer that queues the
draft ("1 message queued — sends on reconnect"). See §5.4.

---

## 8. Design system

`docs/design/README.md` is authoritative. Summary of what binds implementation:

- **Polyflow** — indigo/violet. Three typefaces with a strict split:
  **Outfit** (display: titles, stat numbers), **Inter** (UI: body, rows, labels),
  **Space Mono** (all machine data: hosts, ports, model ids, latency, token
  counts, timestamps, commands, JSON). Keep the three-way split.
- Every control **≥44px**; primary buttons 48–52px.
- Radii step: 6px controls, 10px grouped rows, 12px content cards, 100px pills,
  14px bottom sheets.
- Shadows are diffuse with **no y-offset** — on Android this needs `elevation`
  plus a border, since elevation implies a downward shadow.
- The 135° gradient (`#1d4ed8 → #6d28d9`) is reserved for the **composer send
  button and the user's own chat bubbles**. Not for screen-level primary actions.
- No emoji.

Two implementation notes carried from the handoff: the `.dc.html` is a **visual
reference, not code to port** — rebuild in RN primitives with the project's own
StyleSheet layer; and RN has no radial gradient, so the voice/empty-state auras
become layered absolute circles or a static asset.

**Open: the design is light-mode only.** No dark palette is specified anywhere in
the token set, and mobile users will expect one. Deciding this early is much
cheaper than retrofitting — every token above needs a dark counterpart, and the
gradient and tinted icon tiles need checking on a dark ground.

---

## 9. Staying in sync with upstream

The payoff of the TypeScript choice — but only if managed deliberately.

- Vendored code lives in `vendor/hermes/`, **never edited in place**
- A `scripts/sync-upstream.ts` pulls the three paths from a pinned Hermes ref
- The pinned ref is recorded in `vendor/hermes/UPSTREAM.md` alongside the sync date
- Adaptations (e.g. Electron-bridge escape hatches that don't exist on mobile)
  live in `src/backends/hermes/adapters/`, wrapping vendored code rather than
  patching it
- CI typechecks against the vendored types, so an upstream break surfaces as a
  red build, not a runtime crash in the user's hand

### 9.1 What M0 actually found

The spike is done, and it corrected this section in three places. All three are
recorded in `vendor/hermes/UPSTREAM.md`.

**`hermes.ts` is not vendorable — it is the Electron bridge.** The plan above
assumed all three paths would be vendored *and compiled*. Reading it changed
that: every REST call goes through `window.hermesDesktop.api(...)`, and its
connection descriptor comes from `window.hermesDesktop.getConnection()`. It is
not an HTTP client with an Electron dependency; it is the IPC bridge itself, so
on a phone there is nothing in it to run. `src/backends/hermes/rest.ts` is our
own client instead, typed against the vendored types. The file is still vendored
under `vendor/hermes/reference/`, excluded from the build, so `sync-upstream`
can diff endpoint shapes against it — the "diff instead of re-port" argument
holds; only the mechanism changed.

The **types** are where the value actually was: 1,500 lines that change with
every API addition, kept in sync for free.

**Two React Native gaps in the vendored gateway client**, both real, both
shimmed in `src/platform/polyfills.ts` rather than patched in `vendor/`:

| Gap | Where | Effect if unshimmed |
|---|---|---|
| `URL` is a stub — no `protocol` | `connect()` validates with `new URL(wsUrl)` | Every connect throws *"requires a ws:// or wss:// URL string"* against a valid URL |
| `DOMException` is not a global | `request()` rejects an abort with `new DOMException(…)` | An abort throws `ReferenceError` instead of rejecting |

`WebSocketLike` is typed as the DOM `WebSocket`; React Native provides one with
`addEventListener` and `WebSocket.OPEN`. **Confirmed compatible as-is** — no shim.

**Upstream's `index.ts` cannot be the entry point.** Modules behind that barrel
import siblings as `./billing-policy.js` (NodeNext convention); Metro resolves
`.js` literally and the bundle fails. The barrel also drags in billing, charge
settlement, cron triggers and skins, none of which a phone client touches.
`src/backends/hermes/adapters/shared.ts` re-exports the three modules we use —
all three have no imports at all — and `tsconfig` maps `@hermes/shared` to it, so
call sites still read as if they import the upstream package.

---

## 10. Platform specifics

### 10.1 Build & release

Expo with EAS Build — cloud builds for both platforms, which also sidesteps the
**missing local Xcode** blocker (this Mac has only CommandLineTools: no
`xcodebuild`, no `simctl`). Android needs no local toolchain either. EAS Update
for JS-only fixes without a store round-trip.

Fonts: Outfit and Inter as variable fonts via `expo-font`; Space Mono from Google
Fonts. Also needed: `expo-blur` (headers, voice), `expo-linear-gradient`,
`expo-secure-store`, `react-native-safe-area-context`, `@shopify/flash-list`.

### 10.2 Notifications

The feature that makes a phone client meaningfully different from the desktop app.
`approval.request` and `background.complete` (§2.4) are the triggers: the agent
is blocked on you, or it finished while you were away.

This requires a small server-side piece — Hermes has no push support today. **Use
a relay on the host** that watches the event stream and posts to Expo's push
service. Two facts from this document force that choice over reusing the
messaging gateway:

- Only one agent holds a live socket (§5.2), so notifications for *other* agents
  cannot come from the app at all
- The lock-screen **Allow / Deny** chips (§7.12) must round-trip
  `approval.respond`, which needs a real endpoint, not a chat message

Until it exists, the app can only surface these while foregrounded — acceptable
for v1, but it should be v1.1.

**Design open item:** a notification for an agent that isn't currently selected
must switch agents before opening the target screen.

### 10.3 Background behaviour

Neither OS will keep a WebSocket alive indefinitely in background. The design
assumes disconnection is normal: reconnect on foreground, re-fetch the transcript,
reconcile. Do not treat a dropped socket as an error state the user must see.

### 10.4 Divergences to accept

Keep these few and contained: share sheet, back-gesture semantics, notification
permission timing, Android's dashed-border and elevation quirks, and Tailscale's
per-OS VPN behaviour. Everything else is shared.

---

## 11. Host prerequisites

Before the app can connect to `10.0.0.68`:

1. Install Tailscale on the host and the phone; join both to the tailnet
2. Run `hermes serve` bound to the tailnet address (it is not running today)
3. Configure an auth provider — a public bind requires one and cannot be bypassed
4. Supervise `hermes serve` (systemd) so it survives reboot
5. Approve the phone via `hermes pairing approve`

---

## 12. Risks & open questions

| Risk | Severity | Mitigation |
|---|---|---|
| Streaming render perf in RN | Medium | §7.3 ladder; native component as contained fallback |
| Vendored client drifts from upstream | Medium | Pinned ref + CI typecheck (§9) |
| Hermes API is undocumented and may change | Medium | It's the desktop app's own API — breaking it breaks their product too |
| No push support in Hermes today | Medium | §10.2, deferred to v1.1 |
| Four designed features have no API (§2.6) | Medium | Descoped in §7.5, §7.6, §7.8, §7.9 |
| ~~Design is light-mode only~~ | Low | Every colour goes through theme tokens, so dark mode is a palette swap (§12 q1) |
| Exact WS RPC params unverified | Low | Read from `hermes.ts`; confirm in spike |
| No local Xcode | Low | EAS cloud builds (§10.1) |

**Open questions**

1. ~~Dark mode in v1, or light-only and accept the retrofit cost later?~~
   **Deferred, cheaply.** The app ships the light palette exactly as drawn, but
   every colour resolves through `src/ui/theme.ts` and a provider — no component
   names a hex value. Dark mode becomes a second palette rather than a refactor,
   so the retrofit cost the risk table warned about is largely paid off already.

   The provider also resolves **accent per agent**: `Agent.accent` overrides the
   six accent tokens, so a glance at any screen can say which agent you are in.
   The baseline Polyflow accent is used when an agent declares none — what the
   per-agent palettes should actually be is a design decision, not one made in
   code.
2. Do we need Hermes multi-profile support in v1, or is one profile per agent enough?
3. Is the OpenAI-compatible backend a v1 deliverable, or does v1 ship Hermes-only
   with the seam proven by `MockBackend`?
4. Not yet designed (from the handoff): the resumed state after a drop, an expired
   approval, full-payload log detail, and notification-taps that must switch agents.

---

## 13. Milestones

| M | Deliverable | Proves | Status |
|---|---|---|---|
| **M0** | Spike: vendor `@hermes/shared`, connect to `/api/ws`, print events | The whole thesis — that upstream TS runs unmodified on RN | **done** (§9.1) |
| **M1** | Host prep (§11) + pairing/onboarding (§7.8) | Real remote connection over Tailscale | host prep is the owner's; the app side ships in M5's add-agent |
| **M2** | Sessions list + read-only transcript + search | REST layer, normalisation, agent scoping | **done** |
| **M3** | Live chat: streaming, tool cards, approvals, cancel, reconnect | The core product | **done** |
| **M4** | Settings from `/api/config/schema` + capability gating | G2, and the seam holding up | capability gating done; schema-driven forms open |
| **M5** | Activity, logs, agent switcher, add-agent | G6 | switcher + add-agent done; activity and logs open |
| **M6** | Android parity pass + EAS pipeline for both | G5 | both platforms bundle; no EAS pipeline yet |
| **M7** | Push relay + notification actions | G1 on a phone, properly | open |

**M0 was the gate**, and it held: the vendored client runs outside Electron, with
two small shims and one correction to how much of it is vendorable (§9.1).
`npm run check:m0` keeps that honest in CI without needing a host — it drives the
vendored client through a fake socket and asserts the event normalisation.

M2 and M3 are built against `MockBackend`, whose scripted turn exercises every
branch Chat has to survive: streaming, a thinking block, a settling tool call, a
blocking approval, usage ticks and cancellation. Pointing the same screens at a
real host is a matter of §11 host prep and a pairing token — no app changes.
