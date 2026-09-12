"""The artifact store: files a conversation produced, kept where the app can reach them.

"Artifact" is this plugin's word — Hermes has tool output and an `images/`
directory of uploads, and no noun that covers both (`docs/artifacts.md`). What
this module keeps is a *copy* of each such file plus one row describing it:

    ~/.hermes/polyflow_agents_push/artifacts/
      artifacts.db          the index (SQLite, WAL)
      files/<id>.<ext>      the bytes

Two rules, both inherited from `devices.py` and both load-bearing:

**One host, one store.** Resolved against the *process* Hermes home, never the
context-local override. A hook fires under a per-task profile override and the
route runs with none; a store that followed the override would be written by
the hook into one directory and read by the app from another, and nothing would
say so. That exact fault cost the device registry an evening.

**Copied, not linked.** The agent may overwrite or delete the file it wrote a
minute later. The artifact is the snapshot the conversation produced, so the
bytes are read once and written here. A rewrite of the same path in the same
session updates the row in place and bumps `version`, so a file the agent
iterates on is one artifact with a history, not twelve rows.

**Superseded bytes are kept.** Before a rewrite replaces the file, the bytes
it replaces are copied to `files/<id>.v<n>.<ext>` and described by a row in
`artifact_versions`, so a report the agent redrafted three times can still be
read as it was after the first draft. Bounded per artifact
(`MAX_ARCHIVED_VERSIONS`): the oldest goes when the bound is passed, since a
store that kept every draft of a file an agent rewrites in a loop would grow
without anyone asking it to.

SQLite rather than the registry's JSON-with-atomic-replace because the writers
are many and in different processes: `hermes serve`'s worker threads, cron and
kanban workers, and the app through the route. Stdlib, so the plugin stays
dependency-free — the hooks run inside Hermes's own process.

Nothing here may raise into the agent. `capture_tool_result` is called from a
hook on a daemon thread and every failure is a log line.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import devices

logger = logging.getLogger(__name__)

STORE_DIRNAME = "artifacts"
DB_FILENAME = "artifacts.db"
FILES_DIRNAME = "files"

# The gateway's own ceiling on `image.attach_bytes`. Over this, a log line and
# no artifact: a store that quietly grows by gigabytes because an agent wrote a
# database dump is worse than a missing row.
MAX_BYTES = 25 * 1024 * 1024

# How long a generated image's remote URL gets. Short on purpose: this runs on
# the same daemon thread as the push, after the tool has already returned, and a
# provider that takes longer than this to serve a file it just made is not one
# worth holding a thread for.
FETCH_TIMEOUT_SECONDS = 10

# How many superseded versions of one artifact are kept. Ten drafts back is
# further than anyone asks to look; past that the oldest is dropped with its
# bytes, so an artifact rewritten in a loop costs at most eleven files.
MAX_ARCHIVED_VERSIONS = 10

# What `origin` may be. `agent` produced it; `upload` the phone sent it.
ORIGINS = ("agent", "upload")

KINDS = ("image", "video", "audio", "document", "code", "data", "other")

# `mimetypes` is wrong or silent for the extensions an agent writes most. `.ts`
# is the one that bites — the stdlib says `video/mp2t`, and a TypeScript file
# drawn as a video tile is a bug you notice.
_MIME_OVERRIDES: Dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".svg": "image/svg+xml",
    ".jsonl": "application/jsonl",
    ".sqlite": "application/vnd.sqlite3",
    ".db": "application/vnd.sqlite3",
}

_CODE_EXTENSIONS = frozenset(
    {
        ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".bash", ".zsh", ".go", ".rs",
        ".c", ".h", ".cpp", ".hpp", ".cc", ".java", ".kt", ".swift", ".rb", ".php", ".cs", ".scala",
        ".lua", ".pl", ".r", ".sql", ".css", ".scss", ".less", ".vue", ".svelte", ".dart", ".ex",
        ".exs", ".erl", ".hs", ".ml", ".clj", ".nix", ".dockerfile", ".makefile", ".cmake", ".gradle",
    }
)

_DATA_EXTENSIONS = frozenset({".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".toml", ".xml", ".sqlite", ".db", ".parquet", ".ndjson"})

_DOCUMENT_MIMES = frozenset(
    {
        "text/plain", "text/markdown", "text/html", "application/pdf", "application/rtf",
        "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/epub+zip",
    }
)

# Result keys that name a produced file, in the shapes the generation tools use.
# `image_generate` answers `{"image": <url or path>, "images": [{"url": ...}]}`;
# the video tools follow it. Read leniently — a provider plugin may spell it
# differently and a miss is an artifact nobody sees, not an error.
_FILE_KEYS = ("image", "video", "audio", "url", "path", "local_path", "file_path", "output_path", "saved_to")
_LIST_KEYS = ("images", "videos", "files", "outputs")

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


# ── Paths ────────────────────────────────────────────────────────────────────


def store_dir() -> Path:
    return devices._hermes_home() / devices.STORE_DIRNAME / STORE_DIRNAME


def db_path() -> Path:
    return store_dir() / DB_FILENAME


def files_dir() -> Path:
    return store_dir() / FILES_DIRNAME


def file_path(row: Dict[str, Any]) -> Path:
    return files_dir() / str(row["file"])


def thumbnail_path(row: Dict[str, Any]) -> Path:
    """Where `thumbnails.py` keeps the rendered first page. Beside the bytes, so delete finds both."""
    return files_dir() / f"{row['id']}.thumb.png"


def thumbnail_marker_path(row: Dict[str, Any]) -> Path:
    return files_dir() / f"{row['id']}.thumb.sha"


def _version_id(artifact_id: str, version: int) -> str:
    """The key an archived version is filed under: `<id>.v<n>`.

    Distinct from the artifact's own id, so the bytes, thumbnail and marker of
    a kept version sit beside the live ones under `files/` without colliding,
    and so `thumbnails.ensure` — which keys its cache and its lock on `id` —
    treats a version as the separate file it is.
    """
    return f"{artifact_id}.v{int(version)}"


# ── Schema ───────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS artifacts (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL,
    mime_type        TEXT NOT NULL,
    size             INTEGER NOT NULL,
    sha256           TEXT NOT NULL,
    session_id       TEXT,
    origin           TEXT NOT NULL,
    tool             TEXT,
    source_path      TEXT,
    file             TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    version          INTEGER NOT NULL DEFAULT 1,
    share_token      TEXT UNIQUE,
    share_created_at INTEGER,
    share_expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS artifacts_by_session ON artifacts (session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_by_time ON artifacts (updated_at DESC);
CREATE TABLE IF NOT EXISTS artifact_versions (
    artifact_id      TEXT NOT NULL,
    version          INTEGER NOT NULL,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL,
    mime_type        TEXT NOT NULL,
    size             INTEGER NOT NULL,
    sha256           TEXT NOT NULL,
    tool             TEXT,
    file             TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    archived_at      INTEGER NOT NULL,
    PRIMARY KEY (artifact_id, version)
);
"""


def _connect() -> sqlite3.Connection:
    """A short-lived connection with the schema in place.

    Per call rather than cached: the hooks fire on threads Hermes owns, and a
    connection shared across them is exactly what `sqlite3` refuses by default.
    Opening one is microseconds against the file copy that follows.
    """
    store_dir().mkdir(parents=True, exist_ok=True)
    files_dir().mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path()), timeout=5.0)
    conn.row_factory = sqlite3.Row

    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.Error:
        # A filesystem that cannot do WAL still does rollback journals.
        pass

    conn.executescript(_SCHEMA)

    return conn


# ── Classification ───────────────────────────────────────────────────────────


def mime_for(name: str, fallback: Optional[str] = None) -> str:
    """The MIME type a filename implies, with the stdlib's mistakes corrected."""
    suffix = Path(name).suffix.lower()

    if suffix in _MIME_OVERRIDES:
        return _MIME_OVERRIDES[suffix]

    if fallback and fallback != "application/octet-stream":
        return fallback

    guessed = mimetypes.guess_type(name)[0]

    return guessed or fallback or "application/octet-stream"


def kind_for(mime_type: str, name: str = "") -> str:
    """One word for how the app should draw it. Decided here, once, so every client agrees."""
    mime = (mime_type or "").lower()
    suffix = Path(name).suffix.lower()

    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    if suffix in _CODE_EXTENSIONS or mime in ("text/typescript", "text/javascript", "text/x-python", "application/x-sh"):
        return "code"
    if suffix in _DATA_EXTENSIONS or mime in ("application/json", "text/csv", "application/yaml", "application/toml", "application/xml", "text/xml"):
        return "data"
    if mime in _DOCUMENT_MIMES or mime.startswith("text/"):
        return "document"

    return "other"


def is_source_code(name: str, mime_type: Optional[str] = None) -> bool:
    """Whether a file the agent wrote is code — made for a toolchain, not a person.

    An artifact is something produced for someone to look at: a report, a
    page, a picture, a spreadsheet. The `.py` the agent edited on the way is
    not that, and a store that fills with every source file a coding session
    touches buries the things a person opened the screen for. Judged the same
    way `record` judges kind, so what would have been filed as `code` is what
    is refused.
    """
    display = safe_name(name)

    if display.lower() in _CODE_FILENAMES:
        return True

    return kind_for(mime_for(display, mime_type), display) == "code"


# Code that goes by a name rather than an extension, so `kind_for` cannot see it.
_CODE_FILENAMES = frozenset(
    {"dockerfile", "makefile", "cmakelists.txt", "gemfile", "rakefile", "procfile", "justfile", "vagrantfile", "brewfile"}
)


def safe_name(name: str) -> str:
    """One path segment, printable, bounded. The name is shown; the id is the key."""
    base = str(name or "").replace("\\", "/").rsplit("/", 1)[-1].strip().lstrip(".")
    cleaned = _SAFE_NAME.sub("_", base)[:160]

    return cleaned or "artifact"


# ── Rows ─────────────────────────────────────────────────────────────────────


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def to_public(row: Dict[str, Any], share_base: Optional[str] = None) -> Dict[str, Any]:
    """The row as the app sees it (`docs/artifacts.md` §4). No paths under `files/`."""
    share = None

    if row.get("share_token"):
        token = str(row["share_token"])
        share = {
            "url": f"{share_base.rstrip('/')}/share/{token}" if share_base else token,
            "expiresAt": row.get("share_expires_at"),
            "createdAt": row.get("share_created_at"),
        }

    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "mimeType": row["mime_type"],
        "size": int(row["size"] or 0),
        "sessionId": row.get("session_id") or None,
        "origin": row["origin"],
        "tool": row.get("tool") or None,
        "sourcePath": row.get("source_path") or None,
        "createdAt": int(row["created_at"]),
        "updatedAt": int(row["updated_at"]),
        "version": int(row.get("version") or 1),
        "share": share,
    }


def version_to_public(row: Dict[str, Any], artifact: Dict[str, Any]) -> Dict[str, Any]:
    """A kept version, described the way the artifact itself is (`docs/artifacts.md` §4.2).

    The same shape as the live row — the app already knows how to draw, cache
    and open one of those by `(id, version)` — with the version's own name,
    size and type, the artifact's id rather than the file key, no share (the
    link is the artifact's, and opens its current bytes), and `archivedAt`
    for when these bytes stopped being the current ones.
    """
    public = to_public(
        {
            **artifact,
            "name": row["name"],
            "kind": row["kind"],
            "mime_type": row["mime_type"],
            "size": row["size"],
            "tool": row.get("tool") or artifact.get("tool"),
            "created_at": row["created_at"],
            "updated_at": row["created_at"],
            "version": row["version"],
            "share_token": None,
        }
    )
    public["archivedAt"] = int(row["archived_at"])

    return public


def _version_as_row(row: Dict[str, Any], artifact: Dict[str, Any]) -> Dict[str, Any]:
    """A kept version as a row the bytes and thumbnail paths (and `thumbnails.ensure`) can take."""
    return {
        **artifact,
        "id": _version_id(str(artifact["id"]), int(row["version"])),
        "artifact_id": artifact["id"],
        "name": row["name"],
        "kind": row["kind"],
        "mime_type": row["mime_type"],
        "size": row["size"],
        "sha256": row["sha256"],
        "tool": row.get("tool"),
        "file": row["file"],
        "created_at": row["created_at"],
        "updated_at": row["created_at"],
        "version": row["version"],
        "archived_at": row["archived_at"],
    }


def _now_ms() -> int:
    return int(time.time() * 1000)


def _write_bytes(target: Path, data: bytes) -> None:
    """Atomic: a reader that races the copy sees the old file or the new one, never half."""
    handle = tempfile.NamedTemporaryFile(dir=str(target.parent), prefix=".tmp-", delete=False)

    try:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        os.replace(handle.name, target)
    except Exception:
        handle.close()

        try:
            os.unlink(handle.name)
        except OSError:
            pass

        raise


def record(
    *,
    data: bytes,
    name: str,
    session_id: Optional[str],
    origin: str,
    tool: Optional[str] = None,
    source_path: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Store one file. Returns the public row.

    Upserts on `(session_id, origin, source_path or name)`: the same file
    written again in the same session is the same artifact, one version on.
    Raises `ValueError` for input the caller should have refused (empty, too
    large, unknown origin) — the route turns that into a 400, the hook into a
    log line.
    """
    if origin not in ORIGINS:
        raise ValueError(f"origin must be one of {ORIGINS}")
    if not data:
        raise ValueError("no bytes")
    if len(data) > MAX_BYTES:
        raise ValueError(f"{len(data)} bytes is over the {MAX_BYTES} byte cap")

    display = safe_name(name)
    mime = mime_for(display, mime_type)
    kind = kind_for(mime, display)
    digest = hashlib.sha256(data).hexdigest()
    key_path = source_path or display
    now = _now_ms()
    # Files a pruned version leaves behind, unlinked once the transaction that
    # forgot them has committed — the same order `delete` keeps.
    pruned: List[Path] = []

    conn = _connect()

    try:
        with conn:
            existing = conn.execute(
                "SELECT * FROM artifacts WHERE origin = ? AND COALESCE(session_id, '') = ? AND COALESCE(source_path, name) = ?",
                (origin, session_id or "", key_path),
            ).fetchone()

            if existing is not None:
                row = _row_to_dict(existing)

                if row["sha256"] != digest:
                    _archive_current(conn, row, now)
                    _write_bytes(file_path(row), data)
                    conn.execute(
                        "UPDATE artifacts SET size = ?, sha256 = ?, mime_type = ?, kind = ?, name = ?, "
                        "updated_at = ?, version = version + 1, tool = COALESCE(?, tool) WHERE id = ?",
                        (len(data), digest, mime, kind, display, now, tool, row["id"]),
                    )
                    pruned.extend(_prune_versions(conn, row["id"]))
                else:
                    # Same bytes again: worth a fresh timestamp so the list
                    # surfaces it, not a version — nothing changed.
                    conn.execute("UPDATE artifacts SET updated_at = ? WHERE id = ?", (now, row["id"]))

                fresh = conn.execute("SELECT * FROM artifacts WHERE id = ?", (row["id"],)).fetchone()

                return to_public(_row_to_dict(fresh))

            artifact_id = secrets.token_hex(12)
            suffix = Path(display).suffix.lower()[:16]
            stored = f"{artifact_id}{suffix}"

            _write_bytes(files_dir() / stored, data)
            conn.execute(
                "INSERT INTO artifacts (id, name, kind, mime_type, size, sha256, session_id, origin, tool, "
                "source_path, file, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                (artifact_id, display, kind, mime, len(data), digest, session_id or None, origin, tool, source_path, stored, now, now),
            )

            fresh = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

            return to_public(_row_to_dict(fresh))
    finally:
        conn.close()
        _unlink_all(pruned)


def _archive_current(conn: sqlite3.Connection, row: Dict[str, Any], now: int) -> None:
    """Keep the bytes a rewrite is about to replace, as version `row['version']`.

    A *copy* of the live file, not a rename: the live path stays valid whatever
    happens between here and the new bytes landing, and a crash in that window
    costs one duplicate rather than a row whose file is gone. The thumbnail
    and its marker are moved, since they describe these bytes and the live
    artifact needs a fresh one anyway.
    """
    source = file_path(row)

    if not source.is_file():
        # The row outlived its bytes already; there is nothing to keep.
        return

    version = int(row.get("version") or 1)
    key = _version_id(str(row["id"]), version)
    stored = f"{key}{Path(str(row['file'])).suffix}"

    shutil.copy2(source, files_dir() / stored)

    kept = {"id": key}

    for current, archived in ((thumbnail_path(row), thumbnail_path(kept)), (thumbnail_marker_path(row), thumbnail_marker_path(kept))):
        try:
            os.replace(current, archived)
        except OSError:
            pass

    conn.execute(
        "INSERT OR REPLACE INTO artifact_versions (artifact_id, version, name, kind, mime_type, size, sha256, tool, file, "
        "created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (row["id"], version, row["name"], row["kind"], row["mime_type"], int(row["size"] or 0), row["sha256"], row.get("tool"), stored, int(row["updated_at"]), now),
    )


def _prune_versions(conn: sqlite3.Connection, artifact_id: str) -> List[Path]:
    """Forget the oldest kept versions past `MAX_ARCHIVED_VERSIONS`. Returns the files to unlink after commit."""
    stale = conn.execute(
        "SELECT version, file FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT -1 OFFSET ?",
        (artifact_id, MAX_ARCHIVED_VERSIONS),
    ).fetchall()

    paths: List[Path] = []

    for old in stale:
        conn.execute("DELETE FROM artifact_versions WHERE artifact_id = ? AND version = ?", (artifact_id, old["version"]))
        paths.extend(_version_files(artifact_id, int(old["version"]), str(old["file"])))

    return paths


def _version_files(artifact_id: str, version: int, stored: str) -> List[Path]:
    kept = {"id": _version_id(artifact_id, version)}

    return [files_dir() / stored, thumbnail_path(kept), thumbnail_marker_path(kept)]


def _unlink_all(paths: Iterable[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning("[polyflow_agents_push] %s remains after its row was forgotten", path.name, exc_info=True)


def list_versions(artifact_id: str) -> Optional[List[Dict[str, Any]]]:
    """The kept versions of one artifact, newest first, as public rows. None when the artifact is unknown.

    Only what was archived: an artifact at version 4 lists versions 3, 2 and
    1 if every rewrite was kept, fewer if some predate the archive or fell
    past the bound. The live version is the artifact itself.
    """
    conn = _connect()

    try:
        artifact = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

        if artifact is None:
            return None

        rows = conn.execute("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC", (artifact_id,)).fetchall()

        return [version_to_public(_row_to_dict(row), _row_to_dict(artifact)) for row in rows]
    finally:
        conn.close()


def get_version(artifact_id: str, version: int) -> Optional[Dict[str, Any]]:
    """One kept version as a row the bytes routes can serve — or None: unknown artifact, or a version not kept.

    The live version is not answered here; a caller holding the artifact's
    row already has it, and this is the fallback for a `?v=` that names an
    earlier one.
    """
    conn = _connect()

    try:
        artifact = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

        if artifact is None:
            return None

        row = conn.execute(
            "SELECT * FROM artifact_versions WHERE artifact_id = ? AND version = ?", (artifact_id, int(version))
        ).fetchone()

        return _version_as_row(_row_to_dict(row), _row_to_dict(artifact)) if row is not None else None
    finally:
        conn.close()


def list_rows(
    *,
    session_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    """Newest first, by last change. Returns `(rows, total)` so a page knows what it is a page of."""
    clauses: List[str] = []
    params: List[Any] = []

    if session_id:
        clauses.append("session_id = ?")
        params.append(session_id)
    if kind:
        clauses.append("kind = ?")
        params.append(kind)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    capped = max(1, min(int(limit), 200))

    conn = _connect()

    try:
        total = conn.execute(f"SELECT COUNT(*) FROM artifacts {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM artifacts {where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?",
            [*params, capped, max(0, int(offset))],
        ).fetchall()

        return [_row_to_dict(row) for row in rows], int(total)
    finally:
        conn.close()


def get(artifact_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()

    try:
        row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

        return _row_to_dict(row) if row is not None else None
    finally:
        conn.close()


def delete(artifact_id: str) -> bool:
    """Row and bytes, and every kept version's. The bytes go last, so a failed unlink leaves no row pointing at nothing."""
    conn = _connect()

    try:
        with conn:
            row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

            if row is None:
                return False

            kept = conn.execute("SELECT version, file FROM artifact_versions WHERE artifact_id = ?", (artifact_id,)).fetchall()

            conn.execute("DELETE FROM artifact_versions WHERE artifact_id = ?", (artifact_id,))
            conn.execute("DELETE FROM artifacts WHERE id = ?", (artifact_id,))
    finally:
        conn.close()

    gone = _row_to_dict(row)
    paths = [file_path(gone), thumbnail_path(gone), thumbnail_marker_path(gone)]

    for old in kept:
        paths.extend(_version_files(artifact_id, int(old["version"]), str(old["file"])))

    _unlink_all(paths)

    return True


# ── Sharing ──────────────────────────────────────────────────────────────────


def share(artifact_id: str, *, expires_in_seconds: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Mint a share token, or return the live one. None when the artifact is unknown.

    A second call does not rotate the token: a link already handed to someone
    should keep working until it is explicitly revoked. An expiry passed on a
    later call replaces the old one — extending or shortening is a decision,
    rotating is not.
    """
    now = _now_ms()
    expires_at = now + int(expires_in_seconds) * 1000 if expires_in_seconds else None

    conn = _connect()

    try:
        with conn:
            row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

            if row is None:
                return None

            current = row["share_token"]
            live = current and (row["share_expires_at"] is None or int(row["share_expires_at"]) > now)

            if live:
                conn.execute("UPDATE artifacts SET share_expires_at = ? WHERE id = ?", (expires_at, artifact_id))
            else:
                conn.execute(
                    "UPDATE artifacts SET share_token = ?, share_created_at = ?, share_expires_at = ? WHERE id = ?",
                    (secrets.token_urlsafe(16), now, expires_at, artifact_id),
                )

            fresh = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()

            return _row_to_dict(fresh)
    finally:
        conn.close()


def unshare(artifact_id: str) -> bool:
    conn = _connect()

    try:
        with conn:
            cursor = conn.execute(
                "UPDATE artifacts SET share_token = NULL, share_created_at = NULL, share_expires_at = NULL WHERE id = ?",
                (artifact_id,),
            )

            return cursor.rowcount == 1
    finally:
        conn.close()


def by_share_token(token: str) -> Optional[Dict[str, Any]]:
    """The artifact a token opens, or None: unknown, revoked or expired all look alike to the caller."""
    if not token or len(token) > 64:
        return None

    conn = _connect()

    try:
        row = conn.execute("SELECT * FROM artifacts WHERE share_token = ?", (token,)).fetchone()
    finally:
        conn.close()

    if row is None:
        return None

    expires_at = row["share_expires_at"]

    if expires_at is not None and int(expires_at) <= _now_ms():
        return None

    return _row_to_dict(row)


# ── Capture from tool results ────────────────────────────────────────────────


def _parse_result(result: Any) -> Any:
    if isinstance(result, (dict, list)):
        return result
    if isinstance(result, str):
        text = result.strip()

        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except ValueError:
                return None

    return None


def _candidate_refs(value: Any) -> Iterable[str]:
    """Every string in a tool result that could name a produced file."""
    if isinstance(value, dict):
        for key in _FILE_KEYS:
            candidate = value.get(key)

            if isinstance(candidate, str) and candidate.strip():
                yield candidate.strip()

        for key in _LIST_KEYS:
            items = value.get(key)

            if isinstance(items, list):
                for item in items:
                    if isinstance(item, str) and item.strip():
                        yield item.strip()
                    elif isinstance(item, dict):
                        yield from _candidate_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from _candidate_refs(item)


def _read_local(ref: str) -> Optional[Tuple[bytes, str, Optional[str]]]:
    path = Path(ref).expanduser()

    if not path.is_absolute() or not path.is_file():
        return None

    size = path.stat().st_size

    if size == 0 or size > MAX_BYTES:
        logger.info("[polyflow_agents_push] skipping %s: %d bytes", path, size)

        return None

    return path.read_bytes(), path.name, None


def _fetch_remote(ref: str) -> Optional[Tuple[bytes, str, Optional[str]]]:
    parsed = urllib.parse.urlparse(ref)

    if parsed.scheme not in ("http", "https"):
        return None

    request = urllib.request.Request(ref, headers={"User-Agent": "polyflow-agents-push/artifacts"})

    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        data = response.read(MAX_BYTES + 1)
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip() or None

    if not data or len(data) > MAX_BYTES:
        logger.info("[polyflow_agents_push] skipping %s: empty or over the cap", ref)

        return None

    name = Path(parsed.path).name or "download"

    if "." not in name and content_type:
        extension = mimetypes.guess_extension(content_type) or ""
        name = f"{name}{extension}"

    return data, name, content_type


def _read_data_url(ref: str) -> Optional[Tuple[bytes, str, Optional[str]]]:
    if not ref.startswith("data:"):
        return None

    header, _, payload = ref.partition(",")

    if ";base64" not in header:
        return None

    mime = header[5:].split(";")[0] or None
    data = base64.b64decode(payload, validate=False)

    if not data or len(data) > MAX_BYTES:
        return None

    extension = mimetypes.guess_extension(mime or "") or ""
    # Named by content, because a data URL carries no name and the upsert key
    # is the name: two generations in one session called `generated.png` would
    # otherwise be one artifact, the second overwriting the first.
    stamp = hashlib.sha256(data).hexdigest()[:10]

    return data, f"generated-{stamp}{extension}", mime


def capture_tool_result(
    *,
    tool_name: str,
    args: Any,
    result: Any,
    session_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Store whatever a finished tool call produced. Never raises.

    `write_file` is a fact: the path is in its arguments and the absolute one
    the tool actually wrote is in its result. Source code it wrote is left
    alone, though (`is_source_code`): the store is for what the agent made
    for a person, not for the files a coding task passes through. Everything
    else — the image and video generators — is read leniently off the result,
    since each provider plugin spells its answer a little differently and a
    miss should cost one artifact rather than the hook.
    """
    stored: List[Dict[str, Any]] = []

    try:
        parsed = _parse_result(result)

        if isinstance(parsed, dict) and parsed.get("error"):
            return stored

        refs: List[str] = []

        if tool_name == "write_file":
            resolved = parsed.get("resolved_path") if isinstance(parsed, dict) else None
            path = resolved or (args.get("path") if isinstance(args, dict) else None)

            if isinstance(path, str) and path.strip():
                refs.append(str(Path(path.strip()).expanduser().resolve()))
        else:
            refs.extend(_candidate_refs(parsed))

        seen = set()

        for ref in refs:
            if ref in seen:
                continue

            seen.add(ref)

            try:
                loaded = _read_data_url(ref) or _read_local(ref) or _fetch_remote(ref)
            except Exception:
                logger.info("[polyflow_agents_push] could not read %s", ref[:200], exc_info=True)

                continue

            if loaded is None:
                continue

            data, name, mime = loaded

            if tool_name == "write_file" and is_source_code(name, mime):
                logger.info("[polyflow_agents_push] not storing %s: source code is not an artifact", name)

                continue

            source = None if ref.startswith("data:") else ref

            try:
                stored.append(
                    record(
                        data=data,
                        name=name,
                        session_id=session_id or None,
                        origin="agent",
                        tool=tool_name,
                        source_path=source,
                        mime_type=mime,
                    )
                )
            except ValueError as exc:
                logger.info("[polyflow_agents_push] not storing %s: %s", name, exc)
    except Exception:
        logger.warning("[polyflow_agents_push] artifact capture failed for %s", tool_name, exc_info=True)

    return stored
