#!/usr/bin/env python3
"""The registration route, without a Hermes.

Covers the three things about `dashboard/plugin_api.py` that types and a syntax
check cannot, each of which was a real failure mode rather than a hypothetical:

1. **The module is imported standalone.** `_mount_plugin_api_routes()` loads it
   with `spec_from_file_location` under a flat name, so it has no package and
   `from . import devices` — what `adapter.py` does — raises. This drives the
   same import path the web server uses, so the `_sibling()` workaround is
   exercised rather than assumed.
2. **`push.py` has relative imports of its own.** Loading the siblings flat
   would import `devices` twice under two names and leave `push` broken. The
   check asserts both modules resolve to the *same* `devices`.
3. **The registry is on disk, and the route is the only writer the app has.**
   A register that returns 200 without landing in `devices.json` is a device
   that will never be pushed to and nothing that says so.

Run against a temporary HERMES_HOME so it never touches a real registry:

    python3 scripts/plugin-api-check.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLUGIN = REPO / "host" / "polyflow_agents_push"
TOKEN = "ExponentPushToken[abcdefghij1234567890]"


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    try:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
    except ImportError:
        print("skipped: needs `pip install fastapi httpx` (Hermes ships both)")

        return 0

    with tempfile.TemporaryDirectory() as tmp:
        os.environ["HERMES_HOME"] = tmp

        # Exactly what web_server.py does, including the flat module name.
        spec = importlib.util.spec_from_file_location(
            "hermes_dashboard_plugin_polyflow_agents_push", PLUGIN / "dashboard" / "plugin_api.py"
        )

        if spec is None or spec.loader is None:
            fail("could not build a spec for plugin_api.py")

        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)

        if module.push.devices is not module.devices:
            fail("push.py and plugin_api.py hold different `devices` modules; the registry would split")

        app = FastAPI()
        app.include_router(module.router, prefix="/api/plugins/polyflow_agents_push")
        client = TestClient(app)
        base = "/api/plugins/polyflow_agents_push"

        if client.get(f"{base}/devices").json() != {"devices": []}:
            fail("a fresh registry should list no devices")

        # A token that is not an Expo token is a bad request, not a 500 and not
        # a silent success — the registry would otherwise fill with unusable
        # rows that look registered.
        if client.post(f"{base}/devices", json={"token": "not-a-token"}).status_code != 400:
            fail("a non-Expo token should be rejected with 400")

        if client.post(f"{base}/devices", json={}).status_code != 400:
            fail("a missing token should be rejected with 400")

        registered = client.post(
            f"{base}/devices",
            json={
                "token": TOKEN,
                "agentId": "agent-7",
                "platform": "ios",
                "label": "a phone",
                "prefs": {"approvals": True, "artifacts": False},
            },
        )

        if registered.status_code != 200 or registered.json().get("devices") != 1:
            fail(f"registration did not land: {registered.status_code} {registered.text}")

        store = Path(tmp) / "polyflow_agents_push" / "devices.json"

        if not store.exists():
            fail("registration returned 200 but wrote no registry file")

        rows = json.loads(store.read_text())["devices"]

        if rows[0]["agentId"] != "agent-7":
            fail("agentId did not survive the round trip; a push could not route to an agent")

        # Expo rotates tokens and the app re-registers on every launch, so this
        # running twice must not mean two rows for one phone.
        client.post(f"{base}/devices", json={"token": TOKEN, "agentId": "agent-7"})

        if client.get(f"{base}/devices").json()["devices"].__len__() != 1:
            fail("re-registering the same token duplicated the device")

        listed = client.get(f"{base}/devices").json()["devices"][0]

        if TOKEN in json.dumps(listed):
            fail("the device list leaked a full push token")

        if client.request("DELETE", f"{base}/devices", json={"token": TOKEN}).json() != {"ok": True}:
            fail("unregister did not report success")

        if client.get(f"{base}/devices").json() != {"devices": []}:
            fail("unregister left the device behind")

        # No devices means nothing to test-push to, and saying so beats a 200
        # that looks like it worked.
        if client.post(f"{base}/test").status_code != 404:
            fail("a test push with no devices should 404")

    print("Plugin API check passed: standalone import resolves, and registration round-trips to disk.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
