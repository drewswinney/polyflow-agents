# Agent Handheld — Architecture

A cross-platform (iOS + Android) mobile client for a [Hermes](https://github.com/) agent,
designed so the agent harness behind it can be swapped later.

**Status:** design draft. No implementation yet.
**Decisions locked:** React Native + Expo · Tailscale transport · both platforms from day one.

---

## 1. Goals

| # | Goal | Notes |
|---|------|-------|
| G1 | Chat with the agent across multiple, persistent sessions | List, resume, search, rename, pin, delete |
| G2 | Manage the agent from Settings | Model, providers, skills, MCP servers, cron, profiles |
| G3 | Connect to the agent host remotely | Tailscale; SSH retained for admin only |
| G4 | Allow the harness to be swapped later | Hermes today; another ACP-speaking agent tomorrow |
| G5 | One codebase, two platforms | No iOS-only or Android-only feature paths |

### Non-goals (v1)

- Hosting the agent on-device. The phone is a **client**; the agent runs on the host.
- Replacing the Hermes desktop app. This targets phone-shaped, on-the-go use.
- Local inference or offline agent turns. Offline = read cached transcripts only.

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
Hermes is actively developed. Here we vendor and diff instead. See §8.

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
   notification design (§9.2).
3. **`background.complete`** exists, meaning turns can finish while the app is
   backgrounded. This is what makes push notifications worth building.

### 2.5 Current host state

Observed on the `hermes` host (`10.0.0.68`, Debian 13, key auth via `~/.ssh/hermes`):

- Hermes installed at `~/.local/bin/hermes`, source tree at `~/.hermes/hermes-agent`
- `hermes serve` **not currently running** — only port 22 is listening
- Tailscale **not installed**
- A messaging gateway is configured (`gateway.pid`, `channel_directory.json`, Discord threads)

Both gaps are addressed in §10.

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
│                         Session, Message, ToolCall, ...   │
│                         ← the harness-swap seam           │
├───────────────────────────────────────────────────────────┤
│  Backends               HermesBackend  (REST + WS)        │
│                         AcpBackend     (future)           │
│                         MockBackend    (tests, demos)     │
├───────────────────────────────────────────────────────────┤
│  Vendored               @hermes/shared, hermes types      │
└───────────────────────────────────────────────────────────┘
```

★ = the seam. Everything above it is harness-agnostic.

---

## 4. The `AgentBackend` seam

Modelled on **ACP** (Agent Client Protocol) vocabulary rather than Hermes's REST
shapes. ACP is what Zed and VS Code use to drive Claude Code, Gemini CLI, and
others — and Hermes already speaks it via `hermes acp`. Designing to ACP's
semantics means a future `AcpBackend` is a genuine drop-in, not a rewrite.

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
```

`HermesBackend` maps Hermes events onto this (`message.delta` →
`agent_message_chunk`, `tool.start`/`tool.progress`/`tool.complete` → `tool_call`
+ `tool_call_update`, and so on). The mapping table lives in one file and is the
only place that knows Hermes's event names.

### 4.1 Capability negotiation

Not every harness has cron jobs, skills, or MCP servers. Rather than assume, the
backend declares what it supports and the UI hides what isn't there:

```ts
interface Capabilities {
  sessions: { search: boolean; rename: boolean; pin: boolean }
  settings: { schemaDriven: boolean; model: boolean; providers: boolean }
  extras:   { cron: boolean; skills: boolean; mcp: boolean; profiles: boolean }
  media:    { images: boolean; audioIn: boolean; audioOut: boolean }
}
```

`HermesBackend` reports nearly everything true. A minimal `AcpBackend` reports
sessions + prompt only, and Settings degrades to "connection + model" — no dead
buttons, no crashes.

### 4.2 Anti-goals for this layer

- No leaking `snake_case` Hermes fields into components. Normalise at the boundary.
- No `if (backend instanceof HermesBackend)` anywhere in UI or State.
- No Hermes-specific strings in navigation, i18n keys, or analytics events.

---

## 5. Transport & auth

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

### 5.2 Connection model

```
Phone (Tailscale)  ──── WSS/HTTPS ────►  hermes host (Tailscale)
                                          hermes serve
                                          bound to tailnet addr :9119
```

A **Connection** is the user-configurable unit, stored encrypted on-device:

```ts
interface Connection {
  id: string
  label: string              // "home hermes"
  baseUrl: string            // https://hermes.tailnet.ts.net:9119
  authMode: 'token' | 'oauth'
  profile?: string           // Hermes multi-profile support
}
```

Multiple connections are supported from day one — it costs little now and is
painful to retrofit. Secrets go in `expo-secure-store` (Keychain / Android
Keystore), never in AsyncStorage or Zustand-persisted state.

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

Device enrolment uses `hermes pairing`: the app shows a pairing code, the user
approves it on the host (`hermes pairing approve`), and revocation is
`hermes pairing revoke`. This gives a real "lost my phone" story.

### 5.4 Reconnect

`JsonRpcGatewayClient` ships backoff and a 15s connect timeout (chosen upstream
specifically so a sleep/wake reconnect doesn't hang the composer). We reuse it
rather than reinventing, and add mobile-specific triggers:

- App foreground → verify socket, reconnect if needed
- `NetInfo` transition (cell ↔ wifi ↔ tailnet) → force reconnect
- On reconnect: re-fetch the active session transcript to close any gap in the
  delta stream. **Never** assume the stream resumes losslessly.

---

## 6. Project structure

```
agent-handheld/
├── app/                        # expo-router routes
│   ├── (tabs)/
│   │   ├── sessions.tsx
│   │   ├── chat/[id].tsx
│   │   └── settings/
│   └── onboarding/
├── src/
│   ├── domain/                 ★ AgentBackend, models, capabilities
│   ├── backends/
│   │   ├── hermes/             REST client, WS client, event mapping
│   │   ├── acp/                (future)
│   │   └── mock/
│   ├── state/                  TanStack Query hooks, Zustand stores
│   ├── ui/                     components, theme
│   └── platform/               notifications, secure storage, haptics
├── vendor/hermes/              vendored upstream TS (see §8)
└── docs/architecture.md        this file
```

The directory should be renamed from `agent-handheld-ios` → `agent-handheld`,
since iOS is no longer the whole story.

---

## 7. Screens

Identical information architecture on both platforms; only the chrome differs.

### 7.1 Sessions

List with title, last-message preview, relative time, model badge, pinned state.
Backed by `/api/sessions`, search via `/api/sessions/search` (server-side — the
store is SQLite with FTS5, so don't filter client-side). Swipe actions for
pin/delete/rename. Pull to refresh. Grouped by recency.

### 7.2 Chat

The core screen and the one that earns the app.

- Streaming assistant text with token-level updates
- Collapsed **thinking/reasoning** blocks, expandable
- **Tool calls as first-class cards** — name, status, collapsible output. Do not
  render tool traffic as chat text; on a phone it drowns the conversation
- **Inline approval prompts** for `approval.request` / `sudo.request` /
  `secret.request` — big, unmissable, one-tap Allow/Deny
- Composer: text, image attach, voice input via `/api/audio/transcribe`
- Cancel button while a turn is running (`process.kill`)
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

Sections: **Connection**, **Model & Providers**, **Skills**, **MCP Servers**,
**Cron**, **Profiles**, **Ops** (doctor, logs, usage), **About**.

Model/provider and most config render from `/api/config/schema` (§2.3). Sections
are gated on `capabilities` (§4.1). Destructive actions (revoke pairing, reset
memory, delete session) require explicit confirmation.

---

## 8. Staying in sync with upstream

The payoff of the TypeScript choice — but only if managed deliberately.

- Vendored code lives in `vendor/hermes/`, **never edited in place**
- A `scripts/sync-upstream.ts` pulls the three paths from a pinned Hermes ref
- The pinned ref is recorded in `vendor/hermes/UPSTREAM.md` alongside the sync date
- Adaptations (e.g. Electron-bridge escape hatches that don't exist on mobile)
  live in `src/backends/hermes/adapters/`, wrapping vendored code rather than
  patching it
- CI typechecks against the vendored types, so an upstream break surfaces as a
  red build, not a runtime crash in the user's hand

Known adaptation points: `hermes.ts` imports `@/global` (`HermesConnection`) and
`@/store/transcript-tail`, both Electron-renderer concepts. These get mobile
shims. `WebSocketLike` is typed as the DOM `WebSocket`, which React Native
provides — likely compatible as-is, to be confirmed in the spike (§11).

---

## 9. Platform specifics

### 9.1 Build & release

Expo with EAS Build — cloud builds for both platforms, which also sidesteps the
**missing local Xcode** blocker (this Mac has only CommandLineTools: no
`xcodebuild`, no `simctl`). Android needs no local toolchain either. EAS Update
for JS-only fixes without a store round-trip.

### 9.2 Notifications

The feature that makes a phone client meaningfully different from the desktop app.
`approval.request` and `background.complete` (§2.4) are the triggers: the agent
is blocked on you, or it finished while you were away.

This requires a small server-side piece — Hermes has no push support today. Two
options, deferred to the implementation doc:

- **(a)** A tiny relay on the host that watches the event stream and posts to
  Expo's push service. Simple, one more moving part.
- **(b)** Reuse the existing Hermes **messaging gateway** (already configured on
  the host) as the delivery channel. Less new code, but couples notification
  delivery to a chat platform.

Until this exists, the app can only surface these while foregrounded — acceptable
for v1, but it should be v1.1.

### 9.3 Background behaviour

Neither OS will keep a WebSocket alive indefinitely in background. The design
assumes disconnection is normal: reconnect on foreground, re-fetch the transcript,
reconcile. Do not treat a dropped socket as an error state the user must see.

### 9.4 Divergences to accept

Keep these few and contained: share sheet, back-gesture semantics, notification
permission timing, and Tailscale's per-OS VPN behaviour. Everything else is shared.

---

## 10. Host prerequisites

Before the app can connect to `10.0.0.68`:

1. Install Tailscale on the host and the phone; join both to the tailnet
2. Run `hermes serve` bound to the tailnet address (it is not running today)
3. Configure an auth provider — a public bind requires one and cannot be bypassed
4. Supervise `hermes serve` (systemd) so it survives reboot
5. Approve the phone via `hermes pairing approve`

---

## 11. Risks & open questions

| Risk | Severity | Mitigation |
|---|---|---|
| Streaming render perf in RN | Medium | §7.3 ladder; native component as contained fallback |
| Vendored client drifts from upstream | Medium | Pinned ref + CI typecheck (§8) |
| Hermes API is undocumented and may change | Medium | It's the desktop app's own API — breaking it breaks their product too |
| No push support in Hermes today | Medium | §9.2, deferred to v1.1 |
| Exact WS RPC params unverified | Low | Read from `hermes.ts`; confirm in spike |
| No local Xcode | Low | EAS cloud builds (§9.1) |

**Open questions**

1. Do we need multi-profile support in v1, or is one profile enough to start?
2. Should Settings be full-parity with the desktop app, or a deliberate subset?
3. Is voice input (`/api/audio/transcribe`) a v1 feature or later?
4. Notification path (a) or (b) from §9.2?

---

## 12. Milestones

| M | Deliverable | Proves |
|---|---|---|
| **M0** | Spike: vendor `@hermes/shared`, connect to `/api/ws` from Expo, print events | The whole thesis — that upstream TS runs unmodified on RN |
| **M1** | Host prep (§10) + onboarding/pairing flow | Real remote connection over Tailscale |
| **M2** | Sessions list + read-only transcript | REST layer, normalisation |
| **M3** | Live chat: streaming, tool cards, approvals, cancel | The core product |
| **M4** | Settings from `/api/config/schema` + capability gating | G2, and the seam holding up |
| **M5** | Android parity pass + EAS pipeline for both | G5 |
| **M6** | Push notifications | G1 on a phone, properly |

**M0 is the gate.** It is a day of work and it validates or kills the stack
choice before anything is built on top of it. Do not skip it.
