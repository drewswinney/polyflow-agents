# Handoff: Kanban card editing in the mobile app (t_924ce825)

> Written 2026-08-29 by the `greg` session as a complete, self-contained handoff
> for a new session to pick up this work. Everything below is verified against
> the live sources (paths + line numbers from 2026-08-29); re-verify line numbers
> if Hermes upstream moved.

## 1. Deliverable & scope

Ticket: `t_924ce825` ("Kanban card editing in mobile app"). Make the Boards
screen (mobile) able to **create** cards, **edit title/body**, and **move cards
between columns** (status) on the native Hermes kanban board. Acceptance
criteria live on the ticket. Risk: **medium** (host plugin is a security-relevant
surface) → devreviewer review required before merge.

Decisions already made (do not re-litigate):

- **Editable fields:** title, body, status (move). Priority is out of scope.
- **Create cards from the phone:** yes (acceptance says "user can create").
- **Mutation mechanism:** in-process `hermes_cli.kanban_db` transition
  functions inside the host plugin — **not** subprocess `hermes kanban` (no
  CLI command exists for title/body edits anyway) and **not** raw
  `UPDATE tasks SET status` for status moves (raw writes orphan in-flight
  runs and skip audit/parent-gating). Title/body do go through a direct row
  update inside `kanban_db.write_txn` + a `task_events` audit row, exactly as
  the first-party dashboard plugin does.

## 2. Current branch / PR / board state

- Repo: `/home/drew/agent-handheld` (GitHub `drewswinney/polyflow-agents`).
- Branch: `feat/kanban-card-editing`, already pushed.
- Draft **PR #43** is open for that branch (scaffold commit `3d34827` — an
  empty-allow commit, PR machinery only).
- **WIP committed on the branch (not on main yet):**
  - `src/domain/models.ts` — added `KanbanCardCreate`, `KanbanMoveTarget`,
    `KanbanCardUpdate` interfaces (already pushed; see `git log`).
- Working tree must be clean when you start.
- Board: ticket `t_924ce825` is **blocked** with reason
  "In active session (greg): branch feat/kanban-card-editing + draft PR #43 open".
  **First action for the new session:** unblock it
  (`hermes kanban unblock t_924ce825`), do the work in that session, and re-block
  it with the new session's reason while it runs (dispatcher double-run guard).
- After merge: `hermes kanban complete t_924ce825`, then
  `eas update --branch main --auto --message "Kanban card editing"` (mobile
  change → production channel). Native builds only from `main`.

## 3. Reference implementation (read this first)

The first-party Hermes kanban dashboard plugin is the canonical, blessed
implementation of exactly these routes. Mirror it:

- `/home/drew/.hermes/hermes-agent/plugins/kanban/dashboard/plugin_api.py`
  - `POST /tasks` — create, line ~623.
  - `PATCH /tasks/{task_id}` — update (title/body/status), line ~869.
  - `_set_status_direct` line ~1120 — the drag-drop fallback: direct status
    write **with** run-closing (`outcome='reclaimed'`), descendant invalidation
    on parent reopen, and a `status` event row.
  - `_reopen_if_review` line ~856 — routes any move OUT of `review` through
    `kanban_db.reopen_review_task` (proper stale-run recovery + re-gating).
  - `_parents_blocking_ready` line ~1075 — names the not-done parents for an
    actionable 409 when a move to `ready` is parent-gated.
- Domain layer: `/home/drew/.hermes/hermes-agent/hermes_cli/kanban_db.py`
  - `VALID_STATUSES` line 102: `triage, todo, scheduled, ready, running,
    blocked, review, done, archived`.
  - `connect(db_path=None, *, board=None)` line 2327 — **WAL + auto
    init_db + cross-process init lock**; `kanban_db_path(board)` line 713
    resolves `HERMES_KANBAN_DB` env → active board →
    `default → <root>/kanban.db`, others `<root>/kanban/boards/<slug>/kanban.db`.
  - Mutators: `create_task` 3158, `get_task` 3631, `complete_task` 5352,
    `block_task` 6246, `request_review` 6490, `unblock_task` 6890,
    `reopen_review_task` 6951, `archive_task` 7513, `claim_task` (search
    `def claim_task`), `write_txn` 3044, `notify_task_updated` 262.

## 4. Architecture map (app side)

- Host plugin: `host/polyflow_agents_push/dashboard/plugin_api.py` (412 lines,
  read-only today). Existing kanban GET section:
  - `_native_board_slug()` line 267, `_native_db_path()` line 284,
    `_board_display_name()` line 295, `_read_native_board()` line 322,
    route `@router.get("/kanban")` line 376.
  - Column mapping `_COLUMN_FOR_STATUS` line 209:
    `triage/todo/scheduled/ready → backlog`, `running → in_progress`,
    `review → testing`, `done → done`, `blocked → blocked`, else `other`.
  - Route prefix for the app: `/api/plugins/polyflow_agents_push/kanban`
    (`KANBAN_ROUTE` in `src/backends/hermes/rest.ts` line 117).
- Backend contract: `src/domain/backend.ts` — `listKanbanBoard()` line 109 on
  `AgentBackend`. Add `updateKanbanCard` + `createKanbanCard` next to it.
  **Four implementers** must satisfy the new interface methods:
  - `src/backends/hermes/rest.ts` — add methods next to `kanbanBoard()` line 286
    using `this.request<T>(path, { method, body })`.
  - `src/backends/hermes/index.ts` — wrapper next to `listKanbanBoard()` line 643.
  - `src/backends/mock/index.ts` — `listKanbanBoard()` line 391 returns a static
    board; the new methods must mutate that state in-memory (see §7).
  - `src/backends/openai-compat/index.ts` — `listKanbanBoard()` line 143;
    new methods: throw a clear "not supported by OpenAI-compat backend"
    (matches how that backend treats native-Hermes-only features).
- State: `src/state/boards.ts` — `kanbanBoardKey(scope)`, `useKanbanBoard()`.
  After every mutation: `queryClient.invalidateQueries({ queryKey:
  kanbanBoardKey(scope) })`.
- UI: `app/boards.tsx` (BoardsScreen), `src/ui/components/KanbanCardDetail.tsx`
  (card detail sheet), `src/ui/kanban.ts` (helpers: `statusTone`, labels).

## 5. Host plugin: write routes (the core of the work)

### 5.1 CRITICAL PITFALL — lazy import only

`scripts/plugin-api-check.py` (run by `npm run check:plugin`) loads
`plugin_api.py` **standalone** via `spec_from_file_location` in a bare python
where `hermes_cli` is **NOT importable** (verified: "NO hermes_cli on this
python"). A top-level `from hermes_cli import kanban_db` will crash that check
and the standalone import contract.

**Rule:** every `hermes_cli.kanban_db` reference goes **inside** handler
functions / module-level helpers that are only called at request time
(`from hermes_cli import kanban_db` at the top of the function body), exactly
like the existing `import sqlite3` inside `_read_native_board` (line 323).
`py_compile` will not catch this — the standalone check is the only thing that
does. Run `npm run check:plugin` after every plugin edit.

### 5.2 Connection helper (mirror reference `_conn`)

```python
def _kanban_write_conn() -> "sqlite3.Connection":
    """Writable connection to the ACTIVE board's native DB, via kanban_db.
    Resolves the same slug the GET route shows the phone, so a write always
    lands on the board the user is looking at."""
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli
    slug = _native_board_slug()       # existing helper, line 267
    conn = kanban_db.connect(board=slug)  # WAL + auto-init + init lock
    return conn
```

`kanban_db.connect(board=...)` uses the same `HERMES_KANBAN_*` env resolution
the GET route's `_native_db_path()` mirrors, so there is no second copy of
path logic. (If the plugin's `HERMES_KANBAN_HOME` override semantics must stay
identical to `_hermes_root()` in all edge cases, set nothing — both honor the
same env vars; the only divergence to double-check is that
`_native_board_slug()` and `get_current_board()` read the same
`<root>/kanban/current` file, which they do by construction.)

### 5.3 Routes to add (under the same `router` as the GET `/kanban`)

| Route | Payload | Does |
|---|---|---|
| `POST /kanban/cards` | `{"title": str, "body"?: str}` | `kanban_db.create_task(conn, title=..., body=..., created_by="mobile-app")`. Returns new task id; status will be `ready` (parentless) which the app renders as Backlog — fine, document it. |
| `PATCH /kanban/cards/{task_id}` | `{"title"?: str, "body"?: str, "move"?: {"status": column_id} \| {"kind":"archive"}}` | See 5.4. Returns `{"ok": true}` or the updated card summary. |

Validate `title` non-empty after strip (400). Return 404 for unknown task ids
(`get_task` is None). 409 for invalid transitions (message should be
user-readable — it is surfaced verbatim by the app). 400 for malformed
payloads / unknown status values.

### 5.4 Status-move dispatch (app column → native status)

The app only knows its 5 columns. Map each requested **move** to a native
transition, following the reference PATCH exactly:

| move to column | native call |
|---|---|
| `backlog` | If current status is `review` → `kanban_db.reopen_review_task(conn, task_id)` (via the reference's `_reopen_if_review` pattern). Else `_set_status_direct(conn, task_id, "todo")` (copy that helper from the reference plugin ~line 1120; it handles run-closing + events). |
| `testing` | If current status is `blocked` → `kanban_db.unblock_task` first is NOT sufficient (unblock returns the task to its pre-block state). Preferred: if task is `running`/`ready` → `kanban_db.request_review(conn, task_id, force=True)` (dashboard-style human action, never trips unblock-loop detection). If blocked → unblock, then `request_review` if the resulting state allows; else 409 with the current status named. |
| `in_progress` | **Rejected with 400**: "cannot assign a worker from the phone — the dispatcher claims cards". (There is no legitimate human claim path in this app; see open questions on the ticket if Drew wants to revisit.) |
| `done` | `kanban_db.complete_task(conn, task_id)` — valid from running/ready/blocked/review. |
| `blocked` | `kanban_db.block_task(conn, task_id, reason="Blocked from the mobile app")` (optionally accept a `blockReason` string in the payload for future use). |
| archive (payload `move: {kind:"archive"}`) | `kanban_db.archive_task(conn, task_id)`. Optional — skip if UI doesn't expose it (recommend: yes, put an "Archive" action in the card detail sheet; it's the only way to clean the board from the phone). |

If a mutator returns `False` → 409 with
`f"status transition to {col!r} not valid from current state ({current.status})"`.
For `ready`-family moves only: add the `_parents_blocking_ready` 409
enrichment (copy from reference ~line 1075).

### 5.5 Title/body update (direct row, per reference)

```python
with kanban_db.write_txn(conn):
    conn.execute("UPDATE tasks SET title = ? WHERE id = ?", (title.strip(), task_id))  # and/or body
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, 'edited', NULL, ?)",
        (task_id, int(time.time())),
    )
kanban_db.notify_task_updated(conn, task_id, ["title", "body"], board=slug)  # post-commit observer (RFC #58548)
```

(If the `task_events` columns differ in this deployment, check
`init_db`'s schema in `kanban_db.py` — the reference uses exactly these four
columns.)

### 5.6 Housekeeping

- `created_by="mobile-app"` on creates (audits who wrote it).
- Close the connection in `finally` (reference pattern).
- Keep the module top-level imports untouched except stdlib `time` (add if
  absent). No top-level `hermes_cli` import, ever.

## 6. Backend contract + implementations

- `src/domain/models.ts`: types already committed (`KanbanCardCreate`,
  `KanbanMoveTarget` (`{kind:'column';status:KanbanStatus} | {kind:'archive'}`),
  `KanbanCardUpdate` (`{title?, body?, move?}`)). Confirm `KanbanStatus` is
  the 5-column union; extend it only if the plugin exposes `other`.
- `src/domain/backend.ts` (next to `listKanbanBoard` line 109):
  ```ts
  updateKanbanCard(id: string, update: KanbanCardUpdate): Promise<void>
  createKanbanCard(card: KanbanCardCreate): Promise<void>
  ```
  (`Promise<void>` is fine — the app just invalidates the board query.)
- `src/backends/hermes/rest.ts` (next to line 286):
  - `createKanbanCardCard...` → `this.request(`${KANBAN_ROUTE}/cards`, { method: 'POST', body })`
  - `updateKanbanCard` → `this.request(`${KANBAN_ROUTE}/cards/${id}`, { method: 'PATCH', body })`
  - Keep the 15s timeout pattern. `HermesRestError` already carries the host's
    409 detail text — surface it in the UI.
- `src/backends/hermes/index.ts` line ~643: two one-line wrappers.
- `src/backends/mock/index.ts`: give the class mutable in-memory board state
  (lift the static literal from `listKanbanBoard()` into a field/Map).
  `createKanbanCard` adds a card to `backlog`; `updateKanbanCard` patches
  title/body and moves the card between column arrays (relabeling
  `status`/`statusLabel`/`checked` per the column). This makes the app fully
  usable without a host and exercises the UI paths.
- `src/backends/openai-compat/index.ts`: `throw new Error(...)` for both new
  methods, matching its stance on native-Hermes features.

## 7. UI

- **`src/ui/components/KanbanCardDetail.tsx`:**
  - Status row becomes a set of buttons/chips for the 5 columns (highlight
    current); tapping a different one fires the move mutation. Reuse
    `statusTone` from `src/ui/kanban.ts` for colors.
  - Edit affordance: tap title → inline `TextInput` (or a small modal with
    title + body `TextInput` multiline). Save on blur/confirm; cancel
    reverts. Call `updateKanbanCard(id, {title?, body?})`.
  - Optional "Archive" row at the bottom.
  - Error state: show the host's 409 message (it's already user-readable).
- **`app/boards.tsx`:**
  - A `+` affordance (per column header or a single FAB) opens a create
    sheet: title (required) + body (optional) → `createKanbanCard`.
  - Both mutations go through a single pattern:
    `useMutation` (or the app's existing mutation helper — check how
    `app/cron.tsx` toggles jobs) with
    `onSuccess: () => queryClient.invalidateQueries({ queryKey: kanbanBoardKey(scope) })`.
  - Acceptance criterion "Boards screen reflects external (CLI) changes on
    refresh" is already satisfied by the existing query (polling/refetch on
    focus) — just make sure the invalidate doesn't clobber a concurrent
    refetch (TanStack handles this; no extra work).
- Keep the existing visual language (Text variants, Icon, IconButton,
  `statusTone`); no new dependencies.

## 8. Gates (run ALL, in this order, and show real output)

1. `npm run typecheck`
2. `npm run lint` — 0 errors
3. `npm test -- --runInBand` — includes `scripts/plugin-api-check.py`
   behavior? (Check package.json; if plugin check is a separate script, run
   `npm run check:plugin` explicitly — it is the only gate that catches the
   §5.1 import pitfall.)
4. `python3 -m py_compile host/polyflow_agents_push/dashboard/plugin_api.py`
5. Manual smoke (device or Expo dev client against the live host):
   - create a card, edit its title/body, move it around all columns, archive it.
   - verify the same transitions show up in `hermes kanban list` (audit trail).
   - verify an external `hermes kanban` change appears on pull-to-refresh.
6. **devreviewer** review (medium risk) — post the PR, get the review,
   address findings.
7. Merge: `gh pr ready 43 && gh pr merge 43 --merge --delete-branch`.
8. `hermes kanban complete t_924ce825`
9. `eas update --branch main --auto --message "Kanban card editing: create, edit, move cards"`

## 9. Commit/PR hygiene

- Work on `feat/kanban-card-editing` (already exists, PR #43 open).
- Commit cadence: host routes → backend → UI → tests/docs, small commits.
- Do NOT push to `main` directly; do NOT run `eas update` from the branch.

## 10. Open questions (ask Drew only if they block you)

- Should "In Progress" be assignable at all (claim from phone)? Current plan:
  reject with a clear message.
- Archive from the phone: recommended yes (card detail sheet); trivial to
  drop if unwanted.
- `blockReason` text input for moves to Blocked: optional, not required by
  acceptance criteria.
