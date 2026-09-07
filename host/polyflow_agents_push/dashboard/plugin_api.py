"""Device registration, on the port the app already talks to.

This is the third face of the plugin, and the one that removed the worst part of
the design. `hermes_cli/web_server.py` discovers `dashboard/manifest.json`,
imports the file named by its `api` field, and mounts the `router` below under
`/api/plugins/polyflow_agents_push/` — in the *same* process and on the *same*
port
that serves `/api/ws`. So the app registers over the connection it already has,
with the credential it already has.

What that deleted (all three costs enumerated in `docs/push-relay.md` §5):

- **The second endpoint.** Registration used to go to the messaging gateway's
  webhook server on its own port. The app needed both reachable; now it needs
  one.
- **The second secret.** A webhook route is authenticated by its own HMAC key,
  generated on the host and retyped on the phone. These routes sit behind
  `auth_middleware`, which the app's existing bearer token (token mode) or
  session cookie (password/OAuth mode) already clears. Nothing new to hold.
- **The control frame on a prose channel.** `deliver_only` renders a template,
  so a registration used to ride a JSON line behind a `#handheld:` sentinel.
  This is an ordinary POST body.

Two things about how this module is loaded, both load-bearing:

**It is imported standalone, not as part of a package.** The loader calls
`importlib.util.spec_from_file_location` with a flat module name, so
`from . import devices` — what `adapter.py` does — raises here. `_sibling()`
below rebuilds the parent as a real package so the shared modules import
normally, including *their* relative imports.

**Its `devices` may be a second copy of the module** already loaded by the
platform face in this process. That is harmless and by design: the registry
lives on disk precisely because the plugin's faces load in different processes
and can never share memory (see `devices.py`).
"""

from __future__ import annotations

import base64
import importlib
import importlib.util
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# The plugin root, one level up from `dashboard/`.
_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
# Deliberately *not* the installed package's own name. When this plugin is
# pip-installed, `polyflow_agents_push` is already importable from
# site-packages, and registering a second module under that name in
# `sys.modules` would shadow it. The suffix keeps the two apart — and the
# file-path load below is what makes this work for a `--copy` install or a
# scp'd working copy, where there is no installed package to import at all.
_PACKAGE = "polyflow_agents_push_plugin"


def _sibling(name: str) -> Any:
    """Import a module from the plugin root as part of a synthetic package.

    Registering the parent with `submodule_search_locations` is what makes
    `push.py`'s own `from . import devices` resolve. Loading each file flat
    would import `devices` twice under two names and give `push` a broken
    relative import.
    """
    if _PACKAGE not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            _PACKAGE,
            _PLUGIN_ROOT / "__init__.py",
            submodule_search_locations=[str(_PLUGIN_ROOT)],
        )

        if spec is None or spec.loader is None:
            raise ImportError(f"could not load {_PACKAGE} from {_PLUGIN_ROOT}")

        module = importlib.util.module_from_spec(spec)
        # Before exec: a submodule importing its own package must find it.
        sys.modules[_PACKAGE] = module

        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(_PACKAGE, None)
            raise

    return importlib.import_module(f"{_PACKAGE}.{name}")


devices = _sibling("devices")
push = _sibling("push")
artifacts = _sibling("artifacts")


def _redacted(device: Dict[str, Any]) -> Dict[str, Any]:
    """One device, without the thing that can be used to push to it.

    A push token is a bearer credential for someone's lock screen. This endpoint
    exists so a person can confirm their phone registered, which needs a tail,
    not the token.
    """
    token = str(device.get("token") or "")

    return {
        "tokenTail": token[-8:].rstrip("]") if token else "",
        "agentId": device.get("agentId", ""),
        "platform": device.get("platform", ""),
        "label": device.get("label", ""),
        "prefs": device.get("prefs", {}),
        "registeredAt": device.get("registeredAt", 0),
    }


@router.get("/devices")
async def list_devices() -> Dict[str, Any]:
    """What this host would push to. Tokens are redacted."""
    return {"devices": [_redacted(d) for d in devices.load()]}


@router.post("/devices")
async def register_device(body: dict) -> Dict[str, Any]:
    """Add or refresh one device.

    Idempotent by token, because the app calls this on every launch: Expo
    rotates push tokens, and a registry keyed on a stale one pushes into the
    void with no error anyone sees.
    """
    token = str(body.get("token") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="token is required")

    prefs = body.get("prefs")

    registered = devices.register(
        token,
        # The *app's* id for this agent, not anything this host knows. It rides
        # every push so a tap can re-scope the app before opening the session.
        agent_id=str(body.get("agentId") or ""),
        platform=str(body.get("platform") or ""),
        label=str(body.get("label") or ""),
        prefs=prefs if isinstance(prefs, dict) else None,
    )

    if not registered:
        # `devices.register` only refuses a token that is not an Expo push
        # token, which is a bad request rather than a host failure.
        raise HTTPException(status_code=400, detail="not an Expo push token")

    return {"ok": True, "devices": len(devices.load())}


@router.delete("/devices")
async def unregister_device(body: dict) -> Dict[str, Any]:
    """Stop pushing to one device.

    Half a revocation, like credential removal: delivery stops, but nothing
    about the host's own state is invalidated by a phone forgetting.
    """
    token = str(body.get("token") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="token is required")

    return {"ok": devices.unregister(token)}


# ---------------------------------------------------------------------------
# Native Hermes kanban board (SQLite) — the single source of truth for the
# Boards screen. The old Obsidian markdown board is retired; tickets are
# created and completed with `hermes kanban ...`, so the phone reads the
# same rows.
#
# Board/DB resolution mirrors hermes_cli.kanban_db:
#   DB path:   HERMES_KANBAN_DB env (pins the file, highest precedence)
#   active:    HERMES_KANBAN_BOARD env -> <root>/kanban/current -> "default",
#              each layer validated (slug shape + board exists); malformed or
#              stale values fall through to the next layer, never a crash.
#   DB file:   "default" -> <root>/kanban.db (back-compat)
#              others    -> <root>/kanban/boards/<slug>/kanban.db
#   metadata:  ALL boards -> <root>/kanban/boards/<slug>/board.json
#
# Hermes root: HERMES_KANBAN_HOME (explicit override) else the directory two
# levels above <HERMES_HOME> when the active home is <root>/profiles/<name>,
# else HERMES_HOME itself (Docker / custom deployments).
# ---------------------------------------------------------------------------

_HERMES_ROOT_ENV = "HERMES_KANBAN_HOME"
_DB_PATH_ENV = "HERMES_KANBAN_DB"
_BOARD_ENV = "HERMES_KANBAN_BOARD"
_CURRENT_BOARD_FILE = "current"
_DEFAULT_BOARD = "default"

# Mirrors hermes_cli.kanban_db._BOARD_SLUG_RE: strict enough to stop
# traversal (`..`) and embedded path separators, loose enough for kebab-case.
_BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")

# Native task status -> (app column id, column label).
# triage/todo/scheduled/ready are all "waiting to be picked up" from the
# app's point of view; review is our human-gate (testing) stage. Unknown
# future statuses fall through to "other" rather than vanishing.
_COLUMN_FOR_STATUS: dict[str, tuple[str, str]] = {
    "triage": ("backlog", "Backlog"),
    "todo": ("backlog", "Backlog"),
    "scheduled": ("backlog", "Backlog"),
    "ready": ("backlog", "Backlog"),
    "running": ("in_progress", "In Progress"),
    "review": ("testing", "Testing"),
    "done": ("done", "Done"),
    "blocked": ("blocked", "Blocked"),
}
_FALLBACK_COLUMN = ("other", "Other")
# Columns in the order the Boards screen should scroll them. Any column that
# gets cards but is not listed here is appended after.
_COLUMN_ORDER = ["backlog", "in_progress", "testing", "done", "blocked", "other"]


def _hermes_root() -> Path:
    override = (os.environ.get(_HERMES_ROOT_ENV) or "").strip()
    if override:
        return Path(override).expanduser()
    home = (os.environ.get("HERMES_HOME") or "").strip()
    if home:
        home_path = Path(home).expanduser()
        parts = home_path.parts
        if len(parts) >= 2 and parts[-2] == "profiles" and parts[-1]:
            return home_path.parent.parent
        return home_path
    return Path.home() / ".hermes"


def _boards_root() -> Path:
    return _hermes_root() / "kanban" / "boards"


def _normalize_slug(slug: str | None) -> str | None:
    """Lowercase + strip; None for empty or malformed (mirrors kanban_db).

    Returning None instead of raising keeps a hand-edited env var or
    ``kanban/current`` from taking the route down — the caller just falls
    through to the next resolution layer.
    """
    if slug is None:
        return None
    s = str(slug).strip().lower()
    if not s or not _BOARD_SLUG_RE.match(s):
        return None
    return s


def _board_exists(slug: str) -> bool:
    """Mirrors kanban_db.board_exists: default always exists (its DB is
    created on first connect); named boards need board.json or kanban.db."""
    if slug == _DEFAULT_BOARD:
        return True
    d = _boards_root() / slug
    return (d / "board.json").exists() or (d / "kanban.db").exists()


def _native_board_slug() -> str:
    """Active board slug, mirroring kanban_db.get_current_board():
    HERMES_KANBAN_BOARD env -> <root>/kanban/current -> "default"."""
    slug = _normalize_slug(os.environ.get(_BOARD_ENV))
    if slug and _board_exists(slug):
        return slug
    try:
        f = _hermes_root() / "kanban" / _CURRENT_BOARD_FILE
        if f.exists():
            slug = _normalize_slug(f.read_text(encoding="utf-8").strip())
            if slug and _board_exists(slug):
                return slug
    except OSError:
        pass
    return _DEFAULT_BOARD


def _native_db_path() -> Path:
    """Mirrors kanban_db.kanban_db_path(board=None -> active board)."""
    override = (os.environ.get(_DB_PATH_ENV) or "").strip()
    if override:
        return Path(override).expanduser()
    slug = _native_board_slug()
    if slug == _DEFAULT_BOARD:
        return _hermes_root() / "kanban.db"
    return _boards_root() / slug / "kanban.db"


def _board_display_name(slug: str) -> str:
    """Display name from board.json if present, else a presentable slug.
    Mirrors read_board_metadata: every board (including default) keeps
    metadata at <root>/kanban/boards/<slug>/board.json."""
    meta = _boards_root() / slug / "board.json"
    if meta.exists():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            name = str(data.get("name") or "").strip()
            if name:
                return name
        except (OSError, json.JSONDecodeError):
            pass
    return " ".join(p.capitalize() for p in slug.replace("_", "-").split("-") if p) or slug


def _card_description(body: str | None) -> str:
    """First real prose line of a task body — headings, lists and blanks
    are noise on a 2-line tile."""
    for line in (body or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("-"):
            continue
        return stripped
    return ""


def _read_native_board(db_path: Path, board_slug: str, display_name: str) -> dict[str, object]:
    import sqlite3  # stdlib; kept local so the module import stays light

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"could not open kanban board: {exc}") from exc

    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, title, body, status, branch_name, priority, created_at, "
            "COALESCE(completed_at, started_at, created_at) AS changed_at "
            "FROM tasks WHERE status != 'archived' ORDER BY created_at"
        ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"could not read kanban board: {exc}") from exc
    finally:
        conn.close()

    columns: dict[str, dict[str, object]] = {}
    updated_at = 0

    for row in rows:
        column_id, column_label = _COLUMN_FOR_STATUS.get(row["status"], _FALLBACK_COLUMN)
        column = columns.setdefault(column_id, {"id": column_id, "title": column_label, "cards": []})
        body = str(row["body"] or "")
        card: dict[str, object] = {
            "id": row["id"],
            "title": str(row["title"] or "").strip() or row["id"],
            "description": _card_description(body),
            "status": column_id,
            "statusLabel": column_label,
            "checked": row["status"] == "done",
            "branch": row["branch_name"] or None,
            # Higher is more urgent: `hermes kanban` orders by `priority DESC`.
            # Sent even when zero — absent and "no priority set" are different
            # answers, and the app draws them differently.
            "priority": int(row["priority"] or 0),
            "pr": None,
            "risk": None,
            "body": body[:4000],
            "updatedAt": int(row["changed_at"] or 0),
        }
        column["cards"].append(card)  # type: ignore[union-attr]
        updated_at = max(updated_at, int(row["changed_at"] or 0))

    ordered = [columns[cid] for cid in _COLUMN_ORDER if cid in columns]
    ordered += [columns[cid] for cid in columns if cid not in _COLUMN_ORDER]

    return {
        "title": display_name,
        "source": f"hermes kanban board: {board_slug}",
        "updatedAt": updated_at or int(db_path.stat().st_mtime * 1000),
        "columns": ordered,
    }


@router.get("/kanban")
async def kanban_board() -> Dict[str, Any]:
    """Read the native Hermes kanban board for the mobile Boards screen."""
    board_slug = _native_board_slug()
    db_path = _native_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"kanban board not found: {db_path}")
    return _read_native_board(db_path, board_slug, _board_display_name(board_slug))


# ---------------------------------------------------------------------------
# Kanban write routes (create / edit / move / archive) for the mobile Boards
# screen. These mutate the SAME native board the GET route above reads,
# through hermes_cli.kanban_db's own transition functions — never a raw
# `UPDATE tasks SET status` — so run closing, parent re-gating, audit
# events, and the dispatcher all see a consistent history.
#
# LOAD-ORDER PITFALL (this module is imported standalone, not as part of a
# package — see the module docstring): `hermes_cli` is NOT importable in the
# bare python that `scripts/plugin-api-check.py` loads this file with. So
# every `hermes_cli` reference lives INSIDE a function body, exactly like
# the `import sqlite3` inside `_read_native_board` above. `py_compile` will
# not catch a top-level import; only `npm run check:plugin` does.
# ---------------------------------------------------------------------------


def _kanban_write_conn():
    """Writable connection to the ACTIVE board's native DB, via kanban_db.

    Resolves the same slug the GET route shows the phone (HERMES_KANBAN_DB
    env / HERMES_KANBAN_BOARD env / <root>/kanban/current / default), so a
    write always lands on the board the user is looking at. `connect` brings
    WAL, schema auto-init, and the cross-process init lock with it — the
    same guarantees the first-party dashboard plugin's `_conn` relies on.
    """
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli

    return kanban_db.connect(board=_native_board_slug())


def _parents_not_done(conn, task_id: str) -> list:
    """Parent rows (id/title/status) that are not done, i.e. the reasons a
    move into the ready family is refused. Used to name the blockers in a
    409 so the phone can show an actionable message instead of a silent
    no-op (mirrors the first-party dashboard's _parents_blocking_ready)."""
    rows = conn.execute(
        "SELECT t.id, t.title, t.status FROM tasks t "
        "JOIN task_links l ON l.parent_id = t.id "
        "WHERE l.child_id = ? AND t.status != 'done'",
        (task_id,),
    ).fetchall()
    return [{"id": r["id"], "title": r["title"], "status": r["status"]} for r in rows]


def _set_status_direct(conn, task_id: str, new_status: str) -> bool:
    """Direct status write for moves with no structured verb (here: -> todo
    when the task is not in review). Copied from the first-party kanban
    dashboard plugin (plugins/kanban/dashboard/plugin_api.py): closes an
    active run with outcome='reclaimed' when leaving running, re-gates
    promotion to ready on parent completion, appends a `status` event row,
    invalidates descendants when re-opening a satisfied parent, recomputes
    the ready lane, and terminates the reclaimed worker post-commit.

    `kanban_db` is resolved by the caller, which is the only place in this
    module that imports it (see the load-order pitfall note above).
    """
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli
    import json as _json

    terminations = []
    effective_status = new_status
    with kanban_db.write_txn(conn):
        prev = conn.execute(
            "SELECT status, current_run_id, worker_pid, claim_lock "
            "FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if prev is None:
            return False

        # Promoting to 'ready' is refused while any parent is not done —
        # otherwise the dispatcher would spawn a child whose upstream work
        # is still in flight.
        if effective_status == "ready":
            parent_statuses = conn.execute(
                "SELECT t.status FROM tasks t "
                "JOIN task_links l ON l.parent_id = t.id "
                "WHERE l.child_id = ?",
                (task_id,),
            ).fetchall()
            if parent_statuses and not all(
                p["status"] in {"done", "archived"} for p in parent_statuses
            ):
                return False

        was_running = prev["status"] == "running"
        reopening_satisfied_parent = (
            prev["status"] in {"done", "archived"}
            and effective_status not in {"done", "archived"}
        )

        cur = conn.execute(
            "UPDATE tasks SET status = ?, "
            "  claim_lock = CASE WHEN ? = 'running' THEN claim_lock ELSE NULL END, "
            "  claim_expires = CASE WHEN ? = 'running' THEN claim_expires ELSE NULL END, "
            "  worker_pid = CASE WHEN ? = 'running' THEN worker_pid ELSE NULL END "
            "WHERE id = ?",
            (effective_status, effective_status, effective_status, effective_status, task_id),
        )
        if cur.rowcount != 1:
            return False
        run_id = None
        if was_running and effective_status != "running" and prev["current_run_id"]:
            run_id = kanban_db._end_run(
                conn, task_id,
                outcome="reclaimed", status="reclaimed",
                summary=f"status changed to {effective_status} (mobile-app/direct)",
            )
            terminations.append((prev["worker_pid"], prev["claim_lock"]))
        conn.execute(
            "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) "
            "VALUES (?, ?, 'status', ?, ?)",
            (
                task_id,
                run_id,
                _json.dumps({"status": effective_status, "requested_status": new_status}),
                int(time.time()),
            ),
        )
        if reopening_satisfied_parent:
            result = kanban_db.invalidate_descendants_for_parent_reopen(
                conn, task_id, author="mobile-app",
            )
            terminations.extend(result["terminations"])
    for pid, claim_lock in terminations:
        kanban_db._terminate_reclaimed_worker(pid, claim_lock)
    if effective_status in {"done", "ready", "review"}:
        kanban_db.recompute_ready(conn)
    return True


def _promote_to_ready(conn, task_id: str) -> tuple[bool, str]:
    """todo -> ready with the parent gate, naming any not-done parents."""
    ok = _set_status_direct(conn, task_id, "ready")
    if not ok:
        blockers = _parents_not_done(conn, task_id)
        if blockers:
            names = ", ".join(
                f"{p['title']!r} ({p['id']}, status={p['status']})" for p in blockers
            )
            return False, f"blocked by parent(s) not done — {names}"
        return False, "cannot move the card into the ready lane"
    return True, ""


def _apply_move(conn, slug: str, task_id: str, current_status: str, column: str) -> tuple[bool, str]:
    """Map an app column move to the native transition that performs it.

    Returns ``(ok, detail)``; when ``ok`` is False, ``detail`` is
    user-readable and is surfaced verbatim by the app. Mirrors the
    first-party dashboard PATCH handler's status dispatch, adapted to the
    app's five columns. The app's Backlog is the native ``ready`` lane:
    ``block_task``/``request_review``/``complete_task`` only accept
    ``running|ready`` (plus their own source states), so a native ``todo``
    card would be a dead end — every move therefore re-enters the card
    through ``ready``.
    """
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli

    if column == "in_progress":
        return False, "cannot move a card to In Progress from the phone — the host's dispatcher assigns workers to cards"

    if column == "backlog":
        if current_status == "ready":
            return True, ""
        # Leaving `review` goes through the reopen transition (stale-run
        # recovery + parent re-gate); everything else is a direct write
        # (run closing, parent gate, events, descendant invalidation).
        if current_status == "review":
            ok = kanban_db.reopen_review_task(conn, task_id)
        else:
            ok = _set_status_direct(conn, task_id, "ready")
        if not ok:
            blockers = _parents_not_done(conn, task_id)
            if blockers:
                names = ", ".join(
                    f"{p['title']!r} ({p['id']}, status={p['status']})" for p in blockers
                )
                return False, f"cannot move to Backlog: parent(s) not done — {names}"
            return False, f"cannot move to Backlog from current state ({current_status})"
        return True, ""

    if column == "testing":
        if current_status == "blocked":
            # Resume first (blocked -> its safe resumable phase); the review
            # transition itself only accepts running/ready.
            if not kanban_db.unblock_task(conn, task_id):
                return False, f"cannot unblock card in current state ({current_status})"
            row = conn.execute(
                "SELECT status FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            current_status = row["status"] if row else current_status
        if current_status == "todo":
            # Same re-entry-through-ready rule as every other column (see the
            # docstring): request_review only accepts running|ready, so a
            # native todo card must be promoted first, with the parent gate
            # naming any not-done parent.
            ok, detail = _promote_to_ready(conn, task_id)
            if not ok:
                return False, f"cannot move to Testing: {detail}"
            current_status = "ready"
        if current_status not in ("running", "ready"):
            return False, f"cannot move to Testing from current state ({current_status}) — move the card to Backlog first"
        # Explicit human "request review" — dashboard-style, so it never
        # trips unblock-loop detection.
        ok = kanban_db.request_review(conn, task_id, force=True)
        if not ok:
            blockers = _parents_not_done(conn, task_id)
            if blockers:
                names = ", ".join(
                    f"{p['title']!r} ({p['id']}, status={p['status']})" for p in blockers
                )
                return False, f"cannot move to Testing: parent(s) not done — {names}"
            return False, f"cannot move to Testing from current state ({current_status})"
        return True, ""

    if column == "done":
        if current_status == "done":
            return True, ""
        if current_status == "todo":
            ok, detail = _promote_to_ready(conn, task_id)
            if not ok:
                return False, f"cannot complete the card: {detail}"
        if not kanban_db.complete_task(conn, task_id):
            return False, f"cannot move to Done from current state ({current_status})"
        return True, ""

    if column == "blocked":
        if current_status == "blocked":
            return True, ""
        if current_status == "todo":
            ok, detail = _promote_to_ready(conn, task_id)
            if not ok:
                return False, f"cannot block the card: {detail}"
        elif current_status not in ("running", "ready"):
            return False, f"cannot move to Blocked from current state ({current_status}) — move the card to Backlog first"
        if not kanban_db.block_task(conn, task_id, reason="Blocked from the mobile app"):
            return False, f"cannot move to Blocked from current state ({current_status})"
        return True, ""

    return False, f"unknown column: {column}"


@router.post("/kanban/cards")
async def kanban_card_create(body: dict | None = None) -> Dict[str, Any]:
    """Create a card on the active native board (from the phone)."""
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli

    body = body or {}
    title = str(body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    body_text = body.get("body")
    body_text = str(body_text) if body_text is not None else None

    conn = _kanban_write_conn()
    try:
        task_id = kanban_db.create_task(
            conn,
            title=title,
            body=body_text,
            created_by="mobile-app",
        )
    finally:
        conn.close()
    return {"ok": True, "id": task_id}


@router.patch("/kanban/cards/{task_id}")
async def kanban_card_update(task_id: str, body: dict | None = None) -> Dict[str, Any]:
    """Edit a card's title/body and/or move it between columns.

    Payload: ``{"title"?: str, "body"?: str, "move"?: {"status": column_id}
    | {"kind": "archive"}}``. The move is applied first so field edits land
    on the task in its new state; the response carries the fresh row.
    """
    from hermes_cli import kanban_db  # lazy: standalone check has no hermes_cli

    body = body or {}
    if not body:
        raise HTTPException(status_code=400, detail="nothing to update")
    title = body.get("title")
    body_text = body.get("body")
    move = body.get("move")

    conn = _kanban_write_conn()
    try:
        task = kanban_db.get_task(conn, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} not found")
        if task.status == "archived":
            # The Boards screen never shows archived cards, so this is
            # defense in depth against a stale id; revival is a CLI act.
            raise HTTPException(status_code=409, detail="card is archived — restore it with the CLI to edit it again")

        slug = _native_board_slug()

        if move is not None:
            if not isinstance(move, dict):
                raise HTTPException(status_code=400, detail="move must be an object")
            if move.get("kind") == "archive":
                if not kanban_db.archive_task(conn, task_id):
                    raise HTTPException(
                        status_code=409,
                        detail=f"cannot archive from current state ({task.status})",
                    )
                return {"ok": True}
            column = str(move.get("status") or "")
            if column not in ("backlog", "in_progress", "testing", "done", "blocked"):
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown column: {column!r}",
                )
            ok, detail = _apply_move(conn, slug, task_id, task.status, column)
            if not ok:
                raise HTTPException(status_code=409, detail=detail)

        if title is not None or body_text is not None:
            with kanban_db.write_txn(conn):
                sets, vals = [], []
                if title is not None:
                    if not str(title).strip():
                        raise HTTPException(status_code=400, detail="title cannot be empty")
                    sets.append("title = ?")
                    vals.append(str(title).strip())
                if body_text is not None:
                    sets.append("body = ?")
                    vals.append(str(body_text))
                vals.append(task_id)
                conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", vals)
                conn.execute(
                    "INSERT INTO task_events (task_id, kind, payload, created_at) "
                    "VALUES (?, 'edited', NULL, ?)",
                    (task_id, int(time.time())),
                )
            # Mutation-boundary observer (RFC #58548), post-commit — this
            # direct-SQL write bypasses every kanban_db mutator.
            kanban_db.notify_task_updated(
                conn, task_id,
                [f for f in ("title", "body") if body.get(f) is not None],
                board=slug,
            )

        updated = kanban_db.get_task(conn, task_id)
        return {"ok": True, "id": task_id, "status": updated.status if updated else None}
    finally:
        conn.close()


@router.post("/test")
async def send_test(body: dict | None = None) -> Dict[str, Any]:
    """Push a test notification to every registered device.

    Worth a route of its own: the whole delivery path — registry, Expo, APNs or
    FCM, the phone's notification settings — is otherwise only exercised by an
    approval firing at an unpredictable moment, which is a miserable way to find
    out that step four of six is misconfigured.
    """
    targets = devices.load()

    if not targets:
        raise HTTPException(status_code=404, detail="no devices registered")

    label = str((body or {}).get("label") or "Polyflow Agents")

    # Deliberately `approvals`: it is the one kind that ignores per-device
    # preferences, so a test cannot be silently swallowed by a toggle and read
    # as a broken host.
    push.notify(
        kind="approvals",
        title=label,
        body="Test notification — push is working.",
        data={"test": True},
    )

    return {"ok": True, "devices": len(targets)}


# ---------------------------------------------------------------------------
# Artifacts — files a conversation produced, kept where the app can reach them.
#
# The store and the capture live in `artifacts.py`; these routes are the app's
# side of it (`docs/artifacts.md` §4). Behind the same auth as everything else
# here, which is also what stops `/share/{token}` from being a public link
# today — §5 of that document says why, and why this plugin does not route
# around the gate.
# ---------------------------------------------------------------------------

_ARTIFACT_KINDS = set(artifacts.KINDS)
# Longest a share link may be asked to live. A year is "until revoked" with a
# number on it; anything longer is a request to never expire, which is what
# omitting the field already means.
_MAX_SHARE_HOURS = 24 * 365


def _route_prefix(request: Request, tail: str) -> str:
    """This router's mount, from the request's own path rather than a guess.

    A share URL has to name the same prefix Hermes mounted the router under,
    and that is the plugin's *name* as the manifest declares it — the very
    contract the README warns can drift. Reading it off the path that reached
    this handler is the one way to be right about it.
    """
    path = request.url.path
    cut = path.find(tail)
    prefix = path[:cut] if cut >= 0 else path.rstrip("/")

    return f"{str(request.base_url).rstrip('/')}{prefix}"


def _artifact_or_404(artifact_id: str) -> Dict[str, Any]:
    row = artifacts.get(artifact_id)

    if row is None:
        raise HTTPException(status_code=404, detail="artifact not found")

    return row


def _serve(row: Dict[str, Any], *, download: bool) -> FileResponse:
    path = artifacts.file_path(row)

    if not path.is_file():
        # The row outlived its bytes — a hand-edited store, or a disk that
        # filled mid-copy. A 410 says "was here", which is more useful than a
        # 404 that reads as a bad id.
        raise HTTPException(status_code=410, detail="artifact bytes are missing")

    return FileResponse(
        path=str(path),
        media_type=str(row["mime_type"]),
        filename=str(row["name"]),
        content_disposition_type="attachment" if download else "inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            # The bytes for a given id and version never change, so a client
            # may keep them; a rewrite bumps the version and the URL with it.
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"{row["sha256"]}"',
        },
    )


@router.get("/artifacts")
async def list_artifacts(
    request: Request,
    session: str | None = None,
    kind: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """Newest first. `session` is the *stored* id the app opens a chat by."""
    if kind is not None and kind not in _ARTIFACT_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(_ARTIFACT_KINDS)}")

    rows, total = artifacts.list_rows(session_id=session or None, kind=kind, limit=limit, offset=offset)
    share_base = _route_prefix(request, "/artifacts")

    return {"artifacts": [artifacts.to_public(row, share_base) for row in rows], "total": total}


@router.get("/artifacts/{artifact_id}")
async def get_artifact(artifact_id: str, request: Request) -> Dict[str, Any]:
    return artifacts.to_public(_artifact_or_404(artifact_id), _route_prefix(request, "/artifacts"))


@router.get("/artifacts/{artifact_id}/content")
async def artifact_content(artifact_id: str, download: bool = False) -> FileResponse:
    """The bytes. Inline by default so an image renders; `?download=1` for a save-as."""
    return _serve(_artifact_or_404(artifact_id), download=download)


@router.post("/artifacts")
async def upload_artifact(body: dict, request: Request) -> Dict[str, Any]:
    """The app filing a picture it sent.

    A JSON data URL rather than multipart, for the same reason Hermes's own
    `/api/files/upload` takes one: nothing here may depend on `python-multipart`
    being installed in a venv this plugin does not own. The phone downscaled
    the image before sending it, so the base64 tax is paid on a few hundred KB.

    `name` is the filename the *host* stored the upload under — what a reloaded
    transcript refers to it by — so the app can match the two on the next open.
    """
    name = str(body.get("name") or "").strip()
    data_url = str(body.get("dataUrl") or "")

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not data_url.startswith("data:") or ";base64," not in data_url:
        raise HTTPException(status_code=400, detail="dataUrl must be a base64 data URL")

    header, _, payload = data_url.partition(",")
    declared = header[5:].split(";")[0] or None

    try:
        data = base64.b64decode(payload, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="dataUrl is not valid base64")

    origin = str(body.get("origin") or "upload")

    try:
        stored = artifacts.record(
            data=data,
            name=name,
            session_id=str(body.get("sessionId") or "") or None,
            origin=origin,
            tool=None,
            source_path=None,
            mime_type=str(body.get("mimeType") or "") or declared,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "artifact": artifacts.to_public(artifacts.get(stored["id"]), _route_prefix(request, "/artifacts"))}


@router.delete("/artifacts/{artifact_id}")
async def delete_artifact(artifact_id: str) -> Dict[str, Any]:
    if not artifacts.delete(artifact_id):
        raise HTTPException(status_code=404, detail="artifact not found")

    return {"ok": True}


@router.post("/artifacts/{artifact_id}/share")
async def share_artifact(artifact_id: str, request: Request, body: dict | None = None) -> Dict[str, Any]:
    """Mint a share token, or return the one that is live. `{expiresInHours?}`."""
    hours = (body or {}).get("expiresInHours")
    expires_in = None

    if hours is not None:
        try:
            hours = float(hours)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="expiresInHours must be a number")

        if hours <= 0 or hours > _MAX_SHARE_HOURS:
            raise HTTPException(status_code=400, detail=f"expiresInHours must be between 0 and {_MAX_SHARE_HOURS}")

        expires_in = int(hours * 3600)

    row = artifacts.share(artifact_id, expires_in_seconds=expires_in)

    if row is None:
        raise HTTPException(status_code=404, detail="artifact not found")

    public = artifacts.to_public(row, _route_prefix(request, "/artifacts"))

    return {"ok": True, "share": public["share"], "artifact": public}


@router.delete("/artifacts/{artifact_id}/share")
async def unshare_artifact(artifact_id: str) -> Dict[str, Any]:
    if not artifacts.unshare(artifact_id):
        raise HTTPException(status_code=404, detail="artifact not found")

    return {"ok": True}


@router.get("/share/{token}")
async def open_share(token: str, download: bool = False) -> FileResponse:
    """The bytes, by token alone.

    Unknown, revoked and expired all answer 404: a link that has stopped
    working should not say which of the three it is. Sits behind the host's
    auth gate like every other route here — see `docs/artifacts.md` §5 for
    exactly what that means for "anyone with the link".
    """
    row = artifacts.by_share_token(token)

    if row is None:
        raise HTTPException(status_code=404, detail="no such share")

    return _serve(row, download=download)
