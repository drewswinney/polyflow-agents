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
4. **The kanban reader maps the native board to the app's columns.**
   A schema or mapping slip (a column renamed in Hermes, a status that no
   longer maps to a lane) shows up as a silently empty board on the phone,
   not an error — so the route is exercised against a seeded temp board, and
   both the `native` and the legacy `obsidian` source are checked, including
   the "no board at all" 404 rather than a 500.

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

        # --- kanban: the native board reader, against a seeded temp DB ------
        # The columns the phone draws. A mapping slip here (Hermes renames a
        # column, a status with no lane) is a *silently empty board*, so the
        # check asserts exact placement, not just a 200.
        import sqlite3

        kanban_db = Path(tmp) / "boards" / "test" / "kanban.db"
        kanban_db.parent.mkdir(parents=True)
        (kanban_db.parent / "board.json").write_text(
            json.dumps({"slug": "test", "name": "Check Board"}), encoding="utf-8"
        )
        conn = sqlite3.connect(kanban_db)
        conn.executescript(
            """
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT,
              branch_name TEXT, result TEXT, created_at INTEGER, priority INTEGER DEFAULT 0
            );
            """
        )
        conn.executemany(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)",
            [
                ("t1", "Low priority todo", "Backlog body", None, "todo", "", "", 1, 1),
                ("t2", "High priority todo", "Backlog body high", None, "todo", "", "", 2, 9),
                ("t3", "Running task", "Running body", "devplanner", "running", "feat/x", "PR #7", 3, 1),
                ("t4", "Blocked task", "Blocked body", "devqa", "blocked", "", None, 4, 1),
                ("t5", "In review", "Review body", "devreviewer", "review", "", None, 5, 1),
                ("t6", "Shipped", "Done body", "greg", "done", "", "merged #5", 6, 1),
                ("t7", "Archived", "Hidden body", None, "archived", "", "", 7, 1),
            ],
        )
        conn.commit()
        conn.close()

        os.environ["POLYFLOW_KANBAN_DB"] = str(kanban_db)
        board = client.get(f"{base}/kanban").json()

        if board["title"] != "Check Board":
            fail(f"native board title wrong: {board['title']!r}")

        by_id = {c["id"]: {card["id"]: card for card in c["cards"]} for c in board["columns"]}

        expected_ids = ["backlog", "in_progress", "review", "blocked", "done"]
        if [c["id"] for c in board["columns"]] != expected_ids:
            fail(f"column order wrong: {[c['id'] for c in board['columns']]}")

        # Priority ordering within a column: high first.
        if [card["id"] for card in board["columns"][0]["cards"]] != ["t2", "t1"]:
            fail(f"backlog not priority-ordered: {[card['id'] for card in board['columns'][0]['cards']]}")

        if "t3" not in by_id["in_progress"]:
            fail("running task missing from In Progress")

        card3 = by_id["in_progress"]["t3"]
        if card3["assignee"] != "devplanner" or card3["branch"] != "feat/x" or card3["pr"] != "#7":
            fail(f"native card fields wrong: {card3}")

        if "t6" not in by_id["done"] or "t5" not in by_id["review"] or "t4" not in by_id["blocked"]:
            fail(f"review/blocked/done placement wrong: {[(c['id'], list(c.keys())[:6]) for c in board['columns']]}")

        if any("t7" in cards for cards in by_id.values()):
            fail("archived task leaked onto the board")

        # No board anywhere → a 404 the app's error card already handles,
        # not a 500.
        del os.environ["POLYFLOW_KANBAN_DB"]
        if client.get(f"{base}/kanban").status_code != 404:
            fail("missing kanban board should 404, not 500")

        # The legacy markdown source still works for hosts that have not
        # migrated — same route, explicit opt-in.
        legacy_board = Path(tmp) / "legacy.md"
        legacy_board.write_text(
            "# Legacy Board\n\n## Backlog\n- [[some-ticket|Some ticket]]\n\n## In Progress\n- Work in flight\n",
            encoding="utf-8",
        )
        os.environ["POLYFLOW_KANBAN_PATH"] = str(legacy_board)
        legacy = client.get(f"{base}/kanban?source=obsidian").json()
        if legacy["title"] != "Legacy Board":
            fail(f"legacy board title wrong: {legacy['title']!r}")
        legacy_columns = {c["id"]: [card["title"] for card in c["cards"]] for c in legacy["columns"]}
        if "Some ticket" not in legacy_columns.get("backlog", []):
            fail(f"legacy backlog card missing: {legacy_columns}")
        del os.environ["POLYFLOW_KANBAN_PATH"]

    print("Plugin API check passed: standalone import resolves, and registration round-trips to disk.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
