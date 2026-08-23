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
import logging
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
