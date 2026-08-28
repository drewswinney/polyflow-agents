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

import importlib
import importlib.util
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

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
            "SELECT id, title, body, status, branch_name, created_at, "
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
