"""Device registration and the kanban board, on the port the app already talks to.

This is the third face of the plugin, and the one that removed the worst part of
the design. `hermes_cli/web_server.py` discovers `dashboard/manifest.json`,
imports the file named by its `api` field, and mounts the `router` below under
`/api/plugins/polyflow_agents_push/` — in the *same* process and on the *same*
port
that serves `/api/ws`. So the app registers over the connection it already has,
with the credential it already has.

The `/kanban` route reads the native Hermes kanban SQLite (read-only) and
shapes it for the mobile Boards screen; `?source=obsidian` still serves the
legacy markdown board for hosts that have not migrated.

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
import sqlite3
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


_KANBAN_COLUMNS: list[tuple[str, str, list[str]]] = [
    ("backlog", "Backlog", ["triage", "todo", "scheduled"]),
    ("in_progress", "In Progress", ["ready", "running"]),
    ("review", "Review", ["review"]),
    ("blocked", "Blocked", ["blocked"]),
    ("done", "Done", ["done"]),
]

_NATIVE_PR_RE = re.compile(r"(?:#(\d+)|pull/(\d+))")
_NATIVE_RISK_RE = re.compile(r"risk(?:\s+level)?[:\s]+(low|medium|high)\b", re.I)


def _kanban_db_path() -> Path:
    """The native kanban board backing the mobile Boards screen.

    Delegates to Hermes's own resolver (`hermes_cli.kanban_db`) when
    importable, so the phone shows the *active* board — the same file the
    CLI, the dispatcher and the dashboard all read: `HERMES_KANBAN_DB`
    override → `HERMES_KANBAN_BOARD` → `kanban/current` → the legacy
    default board at `<root>/kanban.db`. A hand-rolled fallback below
    covers hosts where `hermes_cli` is not importable (bare Python with no
    Hermes install), reproducing the same chain against the resolved root.
    `POLYFLOW_KANBAN_DB` is the plugin-level override (offline dev,
    alternate installs) and always wins.
    """
    configured = os.environ.get("POLYFLOW_KANBAN_DB")
    if configured:
        return Path(configured).expanduser()
    try:
        from hermes_cli import kanban_db  # the host IS a hermes process

        return Path(kanban_db.kanban_db_path())
    except Exception:
        pass

    root = Path(os.environ.get("HERMES_KANBAN_HOME") or os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()
    # Boards are shared at the Hermes root, so a profile home
    # (`<root>/profiles/<name>`) resolves up to `<root>` first.
    parts = root.parts
    if "profiles" in parts:
        i = parts.index("profiles")
        if i >= 2:
            root = Path(*parts[:i])
    slug = os.environ.get("HERMES_KANBAN_BOARD", "").strip()
    if not slug:
        try:
            slug = (root / "kanban" / "current").read_text(encoding="utf-8").strip()
        except OSError:
            slug = ""
    if not slug or slug == "default":
        return root / "kanban.db"
    return root / "kanban" / "boards" / slug / "kanban.db"


def _kanban_board_title(db_path: Path) -> str:
    """Display name from the board's `board.json`, when one is on disk.

    Named boards keep `board.json` next to their DB; the legacy default
    board's metadata lives in `kanban/boards/default/` even though its DB
    file does not — so look in both places.
    """
    candidates = [db_path.parent / "board.json", db_path.parent / "boards" / "default" / "board.json"]
    for metadata in candidates:
        try:
            name = str(json.loads(metadata.read_text(encoding="utf-8")).get("name") or "").strip()
        except (OSError, ValueError):
            continue
        if name:
            return name
    return ""


def _first_prose_line(body: str, limit: int = 200) -> str:
    """The first line of a task body worth showing on a dense card.

    Frontmatter and headings are structure, not description; a task whose body
    is only checkboxes should render with an empty description, not a checkbox.
    """
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("---"):
            continue
        if re.match(r"^(?:[-*]\s+)?\[[ xX]\]\s", stripped):
            continue
        return _strip_markdown(stripped)[:limit]
    return ""


def _native_card(row: dict[str, Any]) -> Dict[str, Any]:
    body = str(row["body"] or "")
    pr_match = _NATIVE_PR_RE.search(f"{body} {row['result']}")
    pr = f"#{pr_match.group(1) or pr_match.group(2)}" if pr_match else None
    risk_match = _NATIVE_RISK_RE.search(body)

    return {
        "id": row["id"],
        "title": row["title"],
        "description": _first_prose_line(body),
        "status": row["status"],
        "statusLabel": row["status"].replace("_", " ").title(),
        "checked": row["status"] == "done",
        "assignee": row["assignee"] or None,
        "branch": row["branch"] or None,
        "pr": pr,
        "risk": risk_match.group(1).lower() if risk_match else None,
        "body": body.strip()[:4000] or None,
    }


def _read_native_kanban() -> Dict[str, Any]:
    """Read the native kanban SQLite board for the mobile Boards screen.

    Read-only URI connection: the dispatcher and workers write this DB from
    other processes, and a WAL read here must never take a write lock or
    disturb a claim. The same failure semantics as the old Obsidian reader —
    missing board is a 404, an unreadable one a 500 — so the app's existing
    error card covers both without new UI.
    """
    db_path = _kanban_db_path()

    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"kanban board not found: {db_path}")

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, check_same_thread=False)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"could not read kanban board: {exc}") from exc

    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, title, body, assignee, status, branch_name AS branch, result, created_at
            FROM tasks
            WHERE status != 'archived'
            ORDER BY priority DESC, created_at DESC
            """
        ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"could not read kanban board: {exc}") from exc
    finally:
        conn.close()

    by_status = {row["status"]: [] for row in rows}
    for row in rows:
        by_status.setdefault(str(row["status"]), []).append(row)

    columns: list[Dict[str, Any]] = []
    for column_id, title, statuses in _KANBAN_COLUMNS:
        cards = [_native_card(dict(r)) for status in statuses for r in by_status.get(status, [])]
        columns.append({"id": column_id, "title": title, "cards": cards})

    return {
        "title": _kanban_board_title(db_path) or "Kanban Board",
        "source": str(db_path),
        "updatedAt": int(db_path.stat().st_mtime * 1000),
        "columns": columns,
    }


@router.get("/kanban")
async def kanban_board(source: str = "native") -> Dict[str, Any]:
    """Kanban board for the mobile Boards screen.

    `native` (default) reads the Hermes kanban SQLite — the board the
    dispatcher actually runs, so what the phone shows is what is happening.
    `obsidian` keeps the legacy markdown-board reader for hosts that have not
    migrated yet (and for the offline dev workflow that fakes a host).
    """
    if source == "obsidian":
        return _parse_kanban(_default_kanban_path())
    if source != "native":
        raise HTTPException(status_code=400, detail=f"unknown kanban source: {source}")
    return _read_native_kanban()


def _default_kanban_path() -> Path:
    configured = os.environ.get("POLYFLOW_KANBAN_PATH") or os.environ.get("DEV_KANBAN_PATH")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Documents" / "Obsidian Vault" / "DEV Kanban Board.md"


def _backlog_dir(board_path: Path) -> Path:
    configured = os.environ.get("POLYFLOW_BACKLOG_DIR") or os.environ.get("DEV_BACKLOG_DIR")
    if configured:
        return Path(configured).expanduser()
    return board_path.parent / "Backlog"


# Legacy markdown-board reader (kept for `?source=obsidian`).
_STATUS_MAP = [
    ("backlog", re.compile(r"backlog", re.I)),
    ("in_progress", re.compile(r"in\s+progress|active", re.I)),
    ("testing", re.compile(r"testing|qa", re.I)),
    ("done", re.compile(r"done|complete", re.I)),
]


def _status_for_heading(heading: str) -> str:
    for status, pattern in _STATUS_MAP:
        if pattern.search(heading):
            return status
    return "other"


def _clean_heading(value: str) -> str:
    value = re.sub(r"^[#\s]+", "", value).strip()
    value = re.sub(r"^[^\w\[]+", "", value).strip()
    return value or "Other"


def _strip_markdown(value: str) -> str:
    value = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), value)
    value = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", value)
    value = re.sub(r"[*_`]+", "", value)
    return value.strip()


def _frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    marker = text.find("\n---", 4)
    if marker == -1:
        return {}, text
    raw = text[4:marker].splitlines()
    data: dict[str, str] = {}
    for line in raw:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"\'')
    return data, text[marker + 4 :].lstrip()


def _ticket_details(backlog: Path, slug: str) -> dict[str, object]:
    path = backlog / f"{slug}.md"
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("[polyflow_agents_push] could not read ticket %s", path, exc_info=True)
        return {}

    data, body = _frontmatter(text)
    title_match = re.search(r"^#\s+(.+)$", body, re.M)
    description = ""
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("-") or stripped[0:1].isdigit():
            continue
        description = _strip_markdown(stripped)
        break

    return {
        "title": _strip_markdown(title_match.group(1)) if title_match else None,
        "description": description,
        "branch": data.get("branch") or None,
        "pr": data.get("related_pr") or None,
        "risk": data.get("risk") or None,
        "body": body.strip()[:4000],
    }


def _parse_card(line: str, status: str, status_label: str, backlog: Path) -> dict[str, object] | None:
    match = re.match(r"^\s*(?:[-*]\s+)?(?:\[(?P<checked>[ xX])\]\s+)?(?P<body>.+?)\s*$", line)
    if not match:
        return None
    raw = match.group("body").strip()
    if not raw or raw.startswith("|") or raw.startswith("---") or raw.startswith("**") or raw.startswith(">"):
        return None

    wiki = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", raw)
    slug = wiki.group(1).strip() if wiki else re.sub(r"[^a-z0-9]+", "-", _strip_markdown(raw).lower()).strip("-")[:48]
    display = (wiki.group(2) or wiki.group(1)).strip() if wiki else _strip_markdown(raw)
    trailing = raw[wiki.end():].strip(" -–—") if wiki else ""
    details = _ticket_details(backlog, slug) if wiki else {}

    title = str(details.get("title") or _strip_markdown(display)).strip()
    description = str(details.get("description") or _strip_markdown(trailing)).strip()

    return {
        "id": slug,
        "title": title or "DEV Kanban Board",
        "description": description,
        "status": status,
        "statusLabel": status_label,
        "checked": (match.group("checked") or "").lower() == "x",
        "branch": details.get("branch"),
        "pr": details.get("pr"),
        "risk": details.get("risk"),
        "body": details.get("body"),
    }


def _parse_table_card(line: str, status: str, status_label: str, backlog: Path) -> dict[str, object] | None:
    if "[[" not in line or re.match(r"^\s*\|\s*-", line):
        return None
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if not cells:
        return None
    card = _parse_card(f"- {cells[0]}", status, status_label, backlog)
    if not card:
        return None
    if len(cells) > 1 and cells[1] and not card.get("branch"):
        card["branch"] = _strip_markdown(cells[1])
    if len(cells) > 2 and cells[2] and not card.get("pr"):
        card["pr"] = _strip_markdown(cells[2])
    if len(cells) > 3 and cells[3] and not card.get("description"):
        card["description"] = _strip_markdown(cells[3])
    return card


def _parse_kanban(board_path: Path) -> dict[str, object]:
    if not board_path.exists():
        raise HTTPException(status_code=404, detail=f"kanban board not found: {board_path}")
    try:
        text = board_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"could not read kanban board: {exc}") from exc

    backlog = _backlog_dir(board_path)
    title = ""
    columns: list[dict[str, object]] = []
    current: dict[str, object] | None = None

    for line in text.splitlines():
        h1 = re.match(r"^#\s+(.+)$", line)
        if h1 and not title:
            title = _clean_heading(h1.group(1))
        h2 = re.match(r"^##\s+(.+)$", line)
        if h2:
            label = _clean_heading(h2.group(1))
            status = _status_for_heading(label)
            if status == "other":
                current = None
            else:
                current = {"id": status, "title": label, "cards": []}
                columns.append(current)
            continue

        if current is None:
            continue
        if line.lstrip().startswith("|"):
            card = _parse_table_card(line, str(current["id"]), str(current["title"]), backlog)
        elif re.match(r"^\s*[-*]\s+(?:\[[ xX]\]\s+)?", line):
            card = _parse_card(line, str(current["id"]), str(current["title"]), backlog)
        else:
            card = None
        if card:
            current["cards"].append(card)

    # Merge duplicate status sections while preserving display order.
    merged: list[dict[str, object]] = []
    by_id: dict[str, dict[str, object]] = {}
    for column in columns:
        cid = str(column["id"])
        if cid in by_id:
            by_id[cid]["cards"].extend(column["cards"])  # type: ignore[index, union-attr]
        else:
            by_id[cid] = column
            merged.append(column)

    return {
        "title": title or "DEV Kanban Board",
        "source": str(board_path),
        "updatedAt": int(board_path.stat().st_mtime * 1000),
        "columns": merged,
    }


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
