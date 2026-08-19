"""The device registry, on disk.

On disk rather than in memory because the plugin's two faces load in two
different processes: the hooks run wherever the turn runs (``hermes serve`` for
this app), the platform adapter runs in the messaging gateway. A module global
would be two registries that never agree.

The file is small and written rarely — registration, unregistration, and pruning
a token Expo has told us is dead — so a whole-file atomic replace is cheaper to
reason about than partial updates, and a reader never sees a half-written file.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

STORE_DIRNAME = "handheld-push"
STORE_FILENAME = "devices.json"

# What the app may set per device. Kept here rather than in the app alone
# because a closed app cannot filter its own push: the host is the only place
# that can honour a preference once the process is gone.
DEFAULT_PREFS: Dict[str, bool] = {
    "approvals": True,
    "clarify": True,
    "turnComplete": True,
    "cronFailures": True,
    "artifacts": False,
}


def _hermes_home() -> Path:
    """The active profile's home, asked of Hermes rather than guessed."""
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def store_path() -> Path:
    return _hermes_home() / STORE_DIRNAME / STORE_FILENAME


def load() -> List[Dict[str, Any]]:
    """Every registered device. Never raises: no registry means no push, not a crash."""
    try:
        with store_path().open(encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return []
    except Exception:
        logger.warning("[handheld-push] device registry unreadable; treating as empty", exc_info=True)

        return []

    devices = data.get("devices") if isinstance(data, dict) else None

    return [d for d in devices or [] if isinstance(d, dict) and d.get("token")]


def _save(devices: List[Dict[str, Any]]) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    # Same directory, so the replace is atomic on the same filesystem.
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=".devices-", suffix=".tmp", delete=False
    )
    try:
        with handle:
            json.dump({"version": 1, "devices": devices}, handle, indent=2)
        os.replace(handle.name, path)
        os.chmod(path, 0o600)
    except Exception:
        Path(handle.name).unlink(missing_ok=True)
        raise


def register(token: str, *, platform: str = "", label: str = "", prefs: Dict[str, Any] | None = None) -> bool:
    """Add or refresh one device. Idempotent — Expo tokens rotate, so the app
    re-registers on every launch and must not accumulate duplicates."""
    token = (token or "").strip()

    if not token.startswith("ExponentPushToken[") and not token.startswith("ExpoPushToken["):
        logger.warning("[handheld-push] refusing a token that is not an Expo push token")

        return False

    devices = [d for d in load() if d.get("token") != token]
    merged = dict(DEFAULT_PREFS)

    for key, value in (prefs or {}).items():
        if key in DEFAULT_PREFS:
            merged[key] = bool(value)

    devices.append(
        {
            "token": token,
            "platform": platform or "",
            "label": label or "",
            "prefs": merged,
            "registeredAt": int(time.time()),
        }
    )
    _save(devices)
    logger.info("[handheld-push] registered device (%d total)", len(devices))

    return True


def unregister(token: str) -> bool:
    """Drop one device. Called by the app on sign-out and by the push client when
    Expo reports the token is dead."""
    devices = load()
    remaining = [d for d in devices if d.get("token") != token]

    if len(remaining) == len(devices):
        return False

    _save(remaining)
    logger.info("[handheld-push] unregistered device (%d left)", len(remaining))

    return True


def wants(device: Dict[str, Any], kind: str) -> bool:
    """Whether this device asked for this kind of notification.

    Approvals ignore the preference entirely: the agent is halted until someone
    answers, so silencing them turns a stopped agent into a mystery.
    """
    if kind == "approvals":
        return True

    prefs = device.get("prefs") or {}

    return bool(prefs.get(kind, DEFAULT_PREFS.get(kind, False)))
