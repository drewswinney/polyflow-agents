# Handoff: Hermes Handheld — mobile companion app

## Overview

A React Native / Expo app (iOS + Android) for managing a self-hosted **Hermes agent** running on a Proxmox VM, reached over a Tailscale tailnet. The app is chat-first: you talk to the agent, approve what it wants to do, and configure it. It supports **multiple agents, one at a time** — the whole app scopes to whichever agent is selected.

Built for a single operator (the repo owner), not a team. Source of truth for agent behavior: `docs/architecture.md` in `drewswinney/agent-handheld` (branch `docs/initial-architecture`) — §2.4 events, §5 transport, §7 screens.

## About the design files

`Hermes Handheld.dc.html` is a **design reference created in HTML** — a set of static phone frames showing intended look, layout, and state, not production code to copy. Do not port the HTML or its inline styles.

The task is to **recreate these screens in React Native / Expo** using idiomatic RN primitives (`View`, `Text`, `Pressable`, `FlatList`, `SafeAreaView`), the project's navigation library, and its own StyleSheet/theme layer. Where this document gives exact hex values, type sizes, and spacing, match them.

The HTML file is organized as **turns** (`t2`–`t5`), newest at the top of the page, each containing 2–5 phone frames at 360×790 with a caption under each frame. Turn numbering is conversational history, not app structure — read all of them as one screen set.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, radii, and touch-target sizes. Recreate pixel-accurately, substituting RN equivalents for CSS (see *Platform notes*). No animation is specified beyond what's listed under *Interactions*; motion is deliberately minimal.

## Design system

Polyflow (indigo/violet, Outfit + Inter + Space Mono). Ported to mobile with these rules:

- Every control is **≥44px** tall/wide. Primary buttons 48–52px.
- Headers use the Polyflow navbar treatment: `rgba(255,255,255,0.9)` + 12px blur, 1px bottom border `#dfe3ea`, pinned above a scrolling body.
- Radii step: **6px controls, 10px grouped rows, 12px content cards**, 100px pills, 14px bottom sheets.
- Shadows are diffuse with **no y-offset**: `0 0 6px -1px rgba(0,0,0,0.06)` cards, `0 0 15px -3px rgba(0,0,0,0.2)` popovers, `0 0 25px -5px rgba(0,0,0,0.2)` sheets.
- The **135° gradient (`#1d4ed8 → #6d28d9`) is reserved for the composer send button** and the user's own chat bubbles. It is not used for screen-level primary actions — "New session" is a dashed outline instead.
- All headers sit on a **20px horizontal grid**; right-side header actions are bare icons (17px, `#4b5563`) right-aligned in a 44px tap slot with no chip or border.
- No emoji.

## Design tokens

### Color

| Token | Hex | Use |
| --- | --- | --- |
| primary600 | `#1d4ed8` | gradient start, links, "Install from hub" |
| secondary600 | `#6d28d9` | accent, active tab, agent icons, gradient end |
| secondary700 | `#5b21b6` | text on violet tints |
| secondary300 | `#c4b5fd` | focused input border, dashed button border |
| secondary100 | `#ede9fe` | icon tile bg (strong) |
| secondary50 | `#f5f3ff` | icon tile bg, selected row bg |
| primary50 | `#eff6ff` | icon tile bg (blue) |
| gray900 | `#0b1120` | primary text, device bezel |
| gray800 | `#1f2937` | body text, Stop button fill |
| gray600 | `#4b5563` | secondary text, header icons |
| gray500 | `#6b7280` | metadata text |
| gray400 | `#a3adbd` | placeholder, inactive tab, timestamps |
| border | `#dfe3ea` | all 1px borders |
| divider | `#eef1f5` | row dividers inside cards |
| surface | `#ffffff` | cards, headers, tab bar |
| bg | `#fcfcfd` | screen background |
| bgSubtle | `#f8fafc` | inputs, code blocks, inactive fills |
| success700 | `#15803d` | success text |
| success50 / success200 | `#f0fdf4` / `#bbf7d0` | success chip |
| successDot | `#16a34a` | connected dot |
| warning700 | `#c2410c` | warning text, offline dot |
| warning50 / warning200 | `#fff7ed` / `#fed7aa` | warning banner |
| error700 | `#b91c1c` | destructive text |
| error50 / error200 | `#fef2f2` / `#fecaca` | destructive button |
| highlight | `#fef9c3` | search term highlight |

### Typography

- **Outfit 500** — screen titles 22px/1.1 (letter-spacing -0.02em), sheet titles 18px, sub-screen titles 17px, stat numbers 22px, voice transcript 20px/1.4.
- **Inter** — body 15px/1.65, chat 14.5px/1.5, row labels 15px (400) / 15px (500), secondary 13–14px, section headers 11px 600 uppercase letter-spacing .06em, tab labels 10.5px 500, pill label 12px 500.
- **Space Mono 400** — all machine data: hosts, ports, model ids, latency, token counts, timestamps, command strings, JSON. 10–13px. Status bar time is Space Mono 700 12px.

### Spacing

4px base. Screen padding 16px horizontal (headers 20px). Card padding 13–16px. Gap between list groups 12–13px. Row vertical padding 11–12px.

## Screen inventory

Phone frame is 360×790 (design canvas). Every screen: status bar → header → scrolling body → optional tab bar (`padding: 8px 0 22px`, the 22px being home-indicator safe area).

### Global chrome

**Agent selector pill (centered).** On every top-level screen the selected agent sits **absolutely centered in the header**, pinned to the top of the header row (`top: -6px` against a 52px row whose contents are bottom-aligned), so it rides above the title's optical center. Contents: 5px status dot (`#16a34a` connected / `#a3adbd` idle / `#c2410c` offline) + agent icon (18px slot, 11px glyph, `#6d28d9`) + name (Inter 12px/500) + 9px chevron-down. Pill: `min-height 28px`, `padding 0 9px`, bg `#f8fafc`, 1px `#dfe3ea`, radius 100px, `white-space: nowrap`. Open state: bg `#f5f3ff`, border `#c4b5fd`, chevron-up, text `#5b21b6`.

Sub-screens reached by a back chevron (chat, logs, tools, model, notifications, add-agent, voice) do **not** show the pill — the agent is established by how you got there. They show a back chevron in a left-flush 34px slot (icon center ≈25px from screen edge) + title + optional right icon.

**Per-agent icons:** `home` = home hermes, `car` = garage pi, `flask` = research box, `cloud` = vps hermes. Icons are FontAwesome Solid in the mock — substitute the codebase's icon set, keeping one distinct glyph per agent.

**Tab bar:** 3 tabs — Sessions (`comments`), Activity (`wave-square`), Settings (`sliders`). 18px icon + 10.5px/500 label, active `#6d28d9`, inactive `#a3adbd`, 48px min height each.

> **Superseded in implementation.** Activity was cut (no endpoint backs its tiles) and the tab bar was replaced by a slide-out sidebar opened from a hamburger at the top-left of each top-level header. Kept here as the design handoff's record; see `docs/architecture.md` §7.5 and §7.17.

### 1. Sessions (top-level)

Header: title "Sessions" + centered agent pill + search icon (right).

Body: dashed **New session** button first (48px, transparent, 1px dashed `#c4b5fd`, text `#5b21b6`, plus icon + label, radius 6px), then a pinned session card, then groups by recency (`Today`, `Earlier`) as 12px-radius cards with `#eef1f5` dividers.

Session row: 34px tinted icon tile (8px radius) + title (Inter 15px/500) + relative timestamp (Space Mono 11px, `#a3adbd`) + one-line preview (13px, `#6b7280`, truncated). Rows ≥60px.

Pinned/attention card adds a full-width status strip: bg `#fff7ed`, border `#fed7aa`, radius 6px, 44px, hand icon + "Waiting on your answer" (`#9a3412`) + countdown (`#c2410c`).

### 2. Search (same screen, expanded)

Tapping the header search icon **expands the field in place** — not a route, not a modal. Header becomes: a centered scope label (agent icon + "SEARCHING HOME HERMES", Inter 11px/500 uppercase, `#6b7280`), then a row with the focused field (44px, bg `#f8fafc`, border `#c4b5fd`, magnifier `#6d28d9`, query text, clear ✕) + "Cancel" (Inter 15px/500, `#1d4ed8`). Tab bar stays visible.

Body: match count + scope line ("3 matches in home hermes" / "all time"), then a results card where each row shows title, timestamp, and a context snippet with the query term highlighted (`#fef9c3` bg), then an "All sessions" card listing every session as 52px title + timestamp rows.

### 3. Chat (sub-screen)

Header: back chevron + session title (15.5px/500) + metadata line (Space Mono 10px: `sonnet-4.5 · 18.4k ctx · $0.21`) + "..." overflow icon.

Overflow menu: opaque white popover, 212px, radius 10px, `0 0 15px -3px` shadow, 46px rows — Rename session, Switch model, View raw events. (Stop is **not** here; see composer.)

Transcript (16px padding, 14px gap):
- **User message**: right-aligned, max 80%, 135° gradient fill, white text, radius `12px 12px 6px 12px`, 14.5px/1.5.
- **Thinking**: left pill, 44px, bg `#f5f3ff`, brain icon + "Thought for 6s" + chevron-down, collapsed by default.
- **Agent text**: full-width plain text, 15px/1.65, `#1f2937`. Streaming cursor is an 8×17px `#6d28d9` block appended inline.
- **Tool call card**: white, 1px border, radius 10–12px. Header row ≥52px: 30px tinted tile + tool name (13.5px/500) + argument summary (Space Mono 10px) + duration chip (`#f0fdf4`/`#bbf7d0`/`#15803d`, radius 100px) or a check. Optional output block below: bg `#f8fafc`, Space Mono 11.5px/1.7.

Composer (bg white, 1px top border, `padding 10px 12px 22px`): pill field (48px, radius 100px, bg `#f8fafc`, paperclip + placeholder + 36px mic circle on `#f5f3ff`) and a 48px circular action button. **Three states for that one slot:**
1. *Empty* — arrow-up, bg `#f8fafc`, border `#dfe3ea`, icon `#a3adbd` (disabled).
2. *Typing* — mic disappears from the field, field border `#c4b5fd`, button becomes the 135° gradient with white arrow-up.
3. *Streaming* — button becomes `#1f2937` with a white stop square.

### 4. Approval (blocking bottom sheet)

Transcript dims to 50% opacity; the sheet sits at the bottom: white, radius `14px 14px 0 0`, `0 0 25px -5px` shadow, 38×4px grabber centered.

Contents: 38px `#f5f3ff` shield tile + "Approve this command?" (Outfit 18px) + `shell · sudo · expires 4:52` (Space Mono 11px) → plain-language consequence sentence naming the host → the exact command in a `#f8fafc` code block (Space Mono 11.5px/1.7) → actions: **Allow once** (52px, gradient, white), then a row of **Always allow** (48px outline) and **Deny** (48px, `#fef2f2` / `#fecaca` / `#b91c1c`).

Header subtitle reads "blocked on you" in `#c2410c`. Held tool card shows `held` and a `#fff7ed` tile.

### 5. Voice mode (sub-screen, near-realtime)

Entered from the composer; writes into the same session transcript. Header: chevron-down (dismiss) + "Voice · <session>" + `realtime · 180ms round trip` + a "Type" affordance (keyboard icon + label) to fall back to text.

**State A — listening.** Background `radial-gradient(ellipse 80% 50% at 50% 22%, #ede9fe, #fcfcfd 70%)`. Center graphic (248px square): three blurred blobs (`#c4b5fd` blur 46px opacity .62, `#a5b4fc` blur 48px opacity .55, `#ddd6fe` blur 42px opacity .7), two hairline concentric rings (236px and 188px, `rgba(109,40,217,0.14)` / `0.1`), and a 146px translucent white core (`radial-gradient(circle at 50% 30%, rgba(255,255,255,0.92), rgba(255,255,255,0.42))`, 1px `rgba(255,255,255,0.85)`, `0 0 25px -5px` shadow) holding 6 centered waveform bars (4px wide, 18–66px tall, radius 100px, violet at varying alpha). Below: "Listening" chip with green dot, the live partial transcript (Outfit 20px/1.4, quoted), and `partial · still transcribing`.

Controls: 60px mute (mic-slash) — 76px end call (`#fef2f2`/`#fecaca`, phone-slash) — 60px speaker, plus a reassurance strip: "Everything said here lands in the text transcript".

**State B — agent speaking.** Background shifts to `#e0e7ff` aura. Centered "hermes is speaking" chip with 4 small violet bars. Transcript scrolls: user's utterance as a `#f5f3ff` bubble with `#ddd6fe` border, agent's streaming text, a running tool card (`running` chip, `#eff6ff`/`#bfdbfe`/`#1d4ed8`, "zfs destroy · 63 of 110"), and "speak to interrupt" hint. Center control becomes a dark 76px **hand** button (barge-in); mic icon turns violet.

### 6. Pairing / onboarding

"Step 1 of 2" pill, "Connect to your agent" (Outfit 30px), instruction naming the CLI command (`hermes pair` in an inline mono chip). White card with a 180px QR target on `#f8fafc` and the line "The token never leaves your tailnet." Primary **Open scanner** (52px gradient, camera icon). Then an "or" divider and a manual path: host:port field, masked pairing-token field with eye toggle, and a **Connect** outline button. Background `radial-gradient(ellipse 70% 40% at 50% 0%, #f5f3ff, #fcfcfd 60%)`.

### 7. Activity (top-level)

Header: "Activity" + agent pill + refresh icon.

2×2 stat tiles (12px radius): CPU and memory with 5px progress bars (`#1d4ed8` / `#6d28d9` on `#eef1f5`), spend today with cap, disk with a green delta. Then an alert row when a dependency is down (`#fff7ed`, warning tile, "home-assistant MCP unreachable", `retrying · 6 attempts`, chevron). Then **Event stream**: 52px rows of `HH:MM` (Space Mono 10.5px, 38px column) + event name (`tool.result`, `approval.granted`, `cron.fired`, `session.resumed`) + one-line detail + status glyph.

**Non-Hermes variant:** only the stats that agent reports (round trip, turns today), then an explanatory card — "Host metrics need a Hermes agent" — naming what's unavailable (CPU, memory, disk, cron, spend), then "Recent turns" rows (completed / tool error with token counts). Absent capabilities are stated once, never rendered as blank tiles.

### 8. Settings (top-level)

Header: "Settings" + agent pill.

**Connection card** (12px radius, `radial-gradient(ellipse 70% 80% at 50% 100%, #f5f3ff, #fff)`): 38px icon tile + agent name + `up 4h 12m · 28ms · $1.84 today` + green "Connected" chip; two 44px outline actions (Reconnect, Doctor/Rename).

**Agent** group — Model & providers (`sonnet-4.5`), Skills (`12`), MCP servers (`1 down`, in `#c2410c`), Cron jobs (`3`). **This phone** group — Notifications (`approvals`), Logs & usage. Rows: 52px, 32px tinted icon tile, label 15px/400, value in Space Mono 11px, chevron `#a3adbd`.

The list is **generated from the connected agent's reported capabilities**. A non-Hermes agent shows only Model and Tools, plus a card listing what it doesn't report (Voice, Skills, Cron, MCP, Approvals as 100px-radius chips) and a destructive "Remove this agent" row.

### 9. Tools & integrations (sub-screen)

**MCP servers** are navigation rows, not toggles — each has status, a tool list, and its own failure mode: 60px row, 32px tile colored by health, name + `on · 9 tools · stdio` / `on · unreachable, retrying` / `off`, chevron.

**Approval policy** is one segmented control, not independent switches: "Ask me before" with options **Nothing / Destructive / Every tool** (3px-padded track on `#f8fafc`, selected segment white with 1px border and `0 0 3px` shadow, 38px), plus a "Spend cap per turn" row (`off`, chevron).

**Skills**: 52px rows with version, and an "Install from hub" row in `#1d4ed8`.

### 10. Model & behavior (sub-screen)

Header carries a "Save" text action. Radio list of models (selected row bg `#f5f3ff`, `circle-check` `#6d28d9`; others `circle` outline) with provider/context metadata. Temperature card: label + value in violet mono, 6px track with gradient fill and a 24px white knob, "precise / creative" end labels. System prompt card: mono preview block + `248 chars · edited Sun` + "Edit". Memory: a real toggle (`Persistent memory`, `41 facts · 2.1 MB`) plus "Review what it remembers".

Toggle spec (used only for genuine on/off preferences): 48×28px track, radius 100px, on `#6d28d9`, off `#eef1f5` with 1px border; 22px white knob, 3px inset.

### 11. Notifications (sub-screen)

Toggle list — Approval requests (`always, even in focus`), Agent needs input, Cron results (`failures only`), Every agent message (off). Quiet hours group: "Mute 11pm – 7am" (`approvals still ring`) + notification sound row. Then a **lock-screen preview** card: blurred translucent surface, 38px gradient robot tile, "hermes needs approval", body text, and inline **Allow** / **Deny** action chips (30px).

### 12. Logs & events (sub-screen)

Header: back + "Logs & events" + export icon. Filter chips row (All / Tools / Approvals / Errors; selected `#f5f3ff` + `#c4b5fd` + `#5b21b6`, 34px, radius 100px).

Event rows: 48px, `HH:MM:SS` (Space Mono 10.5px, 42px column) + event name + status token (`ok` green / `once` / `shell` violet / `ECONNREFUSED` red / duration) + chevron. **One row expanded** shows its payload as pretty-printed JSON in a white block inside a `#f8fafc` well (Space Mono 11px/1.7). Footer line: `retained 7 days · 2.4 MB`.

### 13. Agent switcher (popover)

Opens from the centered pill. Opaque white popover, **256px wide, centered** (`left:50%; translateX(-50%)`), `top:10px`, radius 10px, `0 0 25px -5px` shadow, over a `rgba(11,17,32,0.28)` scrim covering the list region only (header stays clear).

Rows are 38px, `padding 0 11px`, gap 9px: status dot (5px) + agent icon (13px slot) + name (13.5px; selected 500) + kind/state token in Space Mono 10.5px (`hermes · 28ms`, `hermes · idle 3d`, `openai-agents`, `hermes · offline`) + check on the current agent. Last row: "Add an agent" in `#1d4ed8`.

**Text must not wrap:** name is `flex:1; min-width:0; white-space:nowrap`, token is `flex:none; white-space:nowrap`.

Offline agents stay listed (dimmed name, `#c2410c` token) rather than disappearing.

### 14. Add an agent (sub-screen)

Close ✕ + "Add an agent". Opening line: "Agents stay separate. Sessions, settings, and history never mix between them."

**Kind first**, because it determines everything after: two selectable cards — "Another Hermes" (`Full support — voice, skills, cron, MCP, approvals`, selected: border `#c4b5fd` + `circle-check`) and "Something else" (`Any agent that speaks OpenAI-compatible streaming`). Then host:port, pairing token (masked, eye toggle), display name. Info strip: reachability is checked before pairing; offline hosts can still be saved. Primary **Pair and connect** (52px gradient).

### 15. Empty state (fresh agent, Sessions)

Dashed New session button, then a centered figure: 132px area with a `#ddd6fe` blur-34 blob, a 124px dashed ring, and the agent's own icon at 34px in `#a78bfa`. Heading "garage pi is paired and idle" (Outfit 20px), body copy (max 264px wide, `text-wrap: pretty`). Then a **"Try asking"** card with three concrete, agent-specific prompts as 52px rows.

### 16. Connection lost mid-turn (chat)

Header subtitle: `reconnecting…` in `#c2410c`.

Warning banner (`#fff7ed` / `#fed7aa`, radius 10px): "Tailnet unreachable" + "The agent keeps working on the VM. This transcript resumes from where it left off." + `retry 3 · next in 8s`.

Transcript keeps the truncated agent sentence, then a dashed **"stream cut here · 9:41"** marker pill, then the in-flight tool card showing `state unknown` with a neutral `?` — the app does not guess the outcome.

Composer: a queued-message notice ("1 message queued — sends on reconnect"), the draft in a dashed-border field, and the action button showing a clock on `#f8fafc` instead of send.

## Interactions & behavior

- **Agent switching** — tap the centered pill → popover; selecting an agent re-scopes the entire app (sessions, activity, settings, history). Nothing is merged across agents: no combined approval queue, no combined spend.
- **Search** — expands in place in the header; Cancel collapses back to the title row. Never navigates.
- **Streaming** — token-by-token agent text with a block cursor; tool calls append cards as they start and update in place on completion; thinking blocks collapsed by default.
- **Composer button** — swaps by state (disabled → gradient send → dark stop) in the same 48px slot.
- **Cancel** — Stop lives in the composer while streaming, not in the overflow menu.
- **Approvals** — modal sheet, blocking, with an expiry countdown; three outcomes (once / always / deny). Push notification carries Allow and Deny actions.
- **Voice** — full-screen while active; barge-in by speaking (or the hand button); "Type" returns to the text composer without ending the session; everything is written into the text transcript.
- **Disconnect** — banner + retry countdown; agent work continues server-side; outgoing messages queue; in-flight tool results are marked unknown until the session resumes.
- **Capability gating** — Settings, Activity, and Voice availability are derived from the agent's reported capabilities; unsupported features are omitted and explained once, never shown disabled.
- **Toggles** are only for true on/off preferences. Objects with their own status or detail (MCP servers, skills) are navigation rows. One decision gets one control (approval policy is a segmented choice).

## State management

- `selectedAgentId` (persisted) — scopes every screen; drives the pill.
- `agents[]` — id, displayName, kind (`hermes` | `other`), host, icon, connection (`connected` | `idle` | `offline`), latency, capabilities[].
- `connection` per agent — socket state, retry count, next-retry countdown, uptime, ping.
- `sessions[]` per agent — id, title, updatedAt, pinned, preview, model, blockedOn.
- `messages[]` per session — role, text, streaming flag, thinking blocks, tool calls (`pending` | `running` | `ok` | `error` | `unknown`).
- `pendingApproval` — tool, command, host, sudo flag, expiresAt.
- `outbox[]` — queued messages while disconnected.
- `voiceSession` — active, mode (`listening` | `speaking`), partial transcript, roundTripMs, muted.
- `searchQuery` + `searchActive`.
- `settings` per agent — model, temperature, systemPrompt, memoryEnabled, approvalPolicy, spendCap; plus device-local notification prefs.
- `events[]` — raw event log with filter state and per-row expansion.

Transport per `docs/architecture.md` §5 (WebSocket, resumable sessions, event stream §2.4). Session state is authoritative on the agent; the app is a reconnecting client that replays from the last event it saw.

## Platform notes for React Native

- `backdrop-filter: blur(12px)` on headers → `expo-blur` `<BlurView intensity>` with a white tint.
- CSS gradients → `expo-linear-gradient`; the 135° gradient is `start={{x:0,y:0}} end={{x:1,y:1}}` with `['#1d4ed8','#6d28d9']`. Radial auras (voice, empty state, connection card) → layered absolutely-positioned circles with opacity, or a static `expo-image` asset; RN has no radial gradient.
- `filter: blur(...)` on the voice blobs → `expo-blur` over colored circles, or pre-rendered PNGs.
- Shadows have no y-offset: iOS `shadowOffset {0,0}` + `shadowRadius`; Android needs `elevation` plus a border, since elevation implies a downward shadow.
- Dashed borders (`New session`, stream-cut marker, empty ring) → `borderStyle: 'dashed'` (Android renders dashes only with `borderRadius: 0` in some versions; consider an SVG rect if it degrades).
- Safe areas: header top padding and the tab bar's 22px bottom padding come from `react-native-safe-area-context`, not fixed values.
- `text-wrap: pretty` has no RN equivalent — ignore.
- Fonts: Outfit and Inter as variable fonts via `expo-font`; Space Mono is available from Google Fonts. Keep the three-way split (Outfit display / Inter UI / Space Mono machine data).
- Icons in the mock are FontAwesome Solid; substitute your icon library, preserving one distinct glyph per agent and per tool type.

## Assets

None to hand off. The mock uses FontAwesome via CDN and Google-hosted Space Mono; Inter and Outfit are the design system's self-hosted variable TTFs. No images, no illustrations — the only graphics are CSS-composed auras and a QR placeholder glyph, all of which should be rebuilt natively.

## Files

- `Hermes Handheld.dc.html` — all 20 phone frames. Search for a caption string (e.g. `Voice · listening`, `Logs ·`, `Empty ·`) to jump to a screen; each frame is a `360×790` container.
- `github.md` — the source repo association (`drewswinney/agent-handheld`, branch `docs/initial-architecture`) and a screen-to-doc map.

## Open items

Not yet designed: the reconnected/resumed state after a drop, an expired-approval state (fired while offline), a full-payload log detail screen, and the flow when a notification arrives for an agent that isn't currently selected (the tap has to switch agents first).
