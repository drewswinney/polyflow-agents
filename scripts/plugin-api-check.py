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
4. **The artifact store round-trips.** Capture from a tool result, the upload
   route, the content and share routes, versioning on rewrite and delete — all
   against a real SQLite file under the temporary home (`docs/artifacts.md`).
5. **Thumbnails render with whatever this machine has**, and 404 cleanly with
   what it lacks — never a 500. Pillow, `pdftoppm` and a Chromium are each
   probed rather than assumed.

Run against a temporary HERMES_HOME so it never touches a real registry:

    python3 scripts/plugin-api-check.py
"""

from __future__ import annotations

import base64
import importlib.util
from contextvars import ContextVar
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLUGIN = REPO / "host" / "polyflow_agents_push"
TOKEN = "ExponentPushToken[abcdefghij1234567890]"
SESSION = "20260907_132822_3b37eb"
# One blank page. Enough for pdftoppm to rasterise, and hand-checkable.
MINIMAL_PDF = (
    b"%PDF-1.1\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 260]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n"
)
# A 1×1 PNG, the smallest thing that is unambiguously an image.
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


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

        check_profile_stamping(module, Path(tmp))

        check_artifacts(module, client, base, Path(tmp))

        check_standalone_send(Path(tmp))

    print(
        "Plugin API check passed: standalone import resolves, registration round-trips to disk, "
        "artifacts capture, serve, share and delete, and cron delivery honours the host contract."
    )

    return 0


def check_profile_stamping(module, home: Path) -> None:
    """Every push carries the *firing* profile, not just the registered `agentId`.

    The device registry is shared across every profile on a host, so a push's
    `agentId` (set at registration time) can name the wrong profile. The host
    must stamp the profile that is actually talking, so a tap re-scopes to the
    right agent. This drives `notify` against a stubbed Expo to prove the
    `profile` key lands on the wire, and checks the pure label derivation.

    Driven through `notify`, not `_send_now`, on purpose. The profile is a
    ContextVar in Hermes and the send happens on a thread that starts with an
    empty context, so a lookup on the sender thread reads `default` for every
    profile. Calling `_send_now` directly ran the lookup on the caller's
    thread and passed while the deployed plugin stamped every push wrong. The
    stub below is itself a ContextVar for the same reason: it answers `greg`
    only from the context the hook fires in, exactly as Hermes's does.
    """
    devices = module.devices
    push = module.push

    # --- The pure derivation, no Hermes needed ----------------------------
    root = home  # temporary HERMES_HOME set at the top of main()
    greg = root / "profiles" / "greg"
    greg.mkdir(parents=True, exist_ok=True)

    if devices.profile_label_for_home(greg) != "greg":
        fail(f"a home under profiles/greg should derive to 'greg', got {devices.profile_label_for_home(greg)!r}")
    if devices.profile_label_for_home(root) is not None:
        fail(f"the deployment root home should not name a profile, got {devices.profile_label_for_home(root)!r}")

    # --- The stamped payload ---------------------------------------------
    # A device registered against the *default* profile's agent id, while the
    # turn is actually firing under `greg`. The old bug: the payload carried
    # only agentId, so a tap opened greg's session against default's scope.
    captured: list = []

    def fake_post(messages):
        captured.extend(messages)

    # Stub the three things the send reaches outside: the registry read, the
    # Expo POST, and the profile lookup. `current_profile_name` reads
    # `hermes_constants`, which is not importable in this standalone check, so
    # it is replaced with a lookup that behaves the same way: context-local,
    # set on the thread the hook fires from, and `default` anywhere else.
    firing: ContextVar[str] = ContextVar("firing_profile", default="default")
    firing.set("greg")

    orig_post, orig_load, orig_profile = push._post, devices.load, devices.current_profile_name
    push._post = fake_post
    devices.load = lambda: [
        {
            "token": TOKEN,
            "agentId": "agent-default",  # stale: registered under default
            "platform": "ios",
            "label": "a phone",
            "prefs": dict(devices.DEFAULT_PREFS),
        }
    ]
    devices.current_profile_name = firing.get
    try:
        # `turnComplete` is a real, enabled-by-default kind — `wants()` will
        # accept the stub device, so the send proceeds to the (faked) Expo POST.
        # `flush` joins the sender thread, so the capture is complete on return.
        push.notify(kind="turnComplete", title="t", body="b", data={"sessionId": "s1"}, flush=5.0)
    finally:
        push._post, devices.load, devices.current_profile_name = orig_post, orig_load, orig_profile

    if len(captured) != 1:
        fail(f"expected exactly one pushed message, got {len(captured)}")

    data = captured[0].get("data", {})
    if data.get("profile") != "greg":
        fail(f"push must stamp the firing profile 'greg' (resolved on the caller's thread), got data={data!r}")
    if data.get("agentId") != "agent-default":
        fail(f"push must still echo the registered agentId, got data={data!r}")
    if data.get("sessionId") != "s1":
        fail(f"push must preserve caller data, got data={data!r}")


def check_artifacts(module, client, base: str, home: Path) -> None:
    """The artifact store, end to end, under the temporary home."""
    arts = module.artifacts

    if client.get(f"{base}/artifacts").json() != {"artifacts": [], "total": 0}:
        fail("a fresh store should list no artifacts")

    # --- Capture: what the hook does with a finished write_file ------------
    written = home / "report.md"
    written.write_text("# Findings\n\nnothing yet\n")
    result = json.dumps({"success": True, "resolved_path": str(written)})

    stored = arts.capture_tool_result(tool_name="write_file", args={"path": str(written)}, result=result, session_id=SESSION)

    if len(stored) != 1:
        fail(f"write_file should capture exactly one artifact, got {len(stored)}")

    first = stored[0]

    if first["kind"] != "document" or first["origin"] != "agent" or first["tool"] != "write_file":
        fail(f"write_file artifact misdescribed: {first}")
    if first["sessionId"] != SESSION or first["version"] != 1:
        fail(f"write_file artifact lost its session or version: {first}")
    if not arts.file_path(arts.get(first["id"])).is_file():
        fail("capture returned a row but copied no bytes")

    # A rewrite of the same path in the same session is the same artifact, one
    # version on — not a second row.
    written.write_text("# Findings\n\nthree things\n")
    again = arts.capture_tool_result(tool_name="write_file", args={"path": str(written)}, result=result, session_id=SESSION)

    if again[0]["id"] != first["id"] or again[0]["version"] != 2:
        fail(f"a rewrite should bump the version in place, got {again[0]}")
    if arts.file_path(arts.get(first["id"])).read_text() != written.read_text():
        fail("a rewrite did not replace the stored bytes")

    # A failed call produced nothing, whatever its arguments say.
    if arts.capture_tool_result(tool_name="write_file", args={"path": str(written)}, result=json.dumps({"error": "denied"}), session_id=SESSION):
        fail("a tool result carrying an error must not be captured")

    # A generated image, answered as a data URL — the shape a provider that
    # returns bytes inline uses.
    image = arts.capture_tool_result(
        tool_name="image_generate",
        args={"prompt": "a dot"},
        result=json.dumps({"success": True, "image": f"data:image/png;base64,{PNG_B64}"}),
        session_id=SESSION,
    )

    if len(image) != 1 or image[0]["kind"] != "image" or image[0]["mimeType"] != "image/png":
        fail(f"image_generate should capture one image, got {image}")

    # The stdlib calls `.ts` a video. It is not — and being code, it is not
    # an artifact either: a written source file is skipped, not stored.
    if arts.kind_for(arts.mime_for("index.ts"), "index.ts") != "code":
        fail(f"a .ts file should be code, got {arts.kind_for(arts.mime_for('index.ts'), 'index.ts')}")

    code = home / "index.ts"
    code.write_text("export const x = 1\n")

    if arts.capture_tool_result(tool_name="write_file", args={"path": str(code)}, result=json.dumps({"success": True}), session_id="other"):
        fail("a written source file must not become an artifact")
    if not arts.is_source_code("Dockerfile"):
        fail("code that goes by name rather than extension should still count as code")

    # A data file is kept: a CSV is as often the deliverable as the plumbing.
    table = home / "export.csv"
    table.write_text("a,b\n1,2\n")
    typed = arts.capture_tool_result(tool_name="write_file", args={"path": str(table)}, result=json.dumps({"success": True}), session_id="other")

    if len(typed) != 1 or typed[0]["kind"] != "data":
        fail(f"a .csv file should be captured as data, got {typed}")

    # Over the cap is refused, loudly enough to be a ValueError and not a row.
    try:
        arts.record(data=b"x" * (arts.MAX_BYTES + 1), name="huge.bin", session_id=None, origin="agent")
    except ValueError:
        pass
    else:
        fail("a file over MAX_BYTES should be refused")

    # --- Listing ----------------------------------------------------------
    listed = client.get(f"{base}/artifacts").json()

    if listed["total"] != 3 or [row["id"] for row in listed["artifacts"]][0] != typed[0]["id"]:
        fail(f"listing should show three artifacts newest first, got {listed}")
    if client.get(f"{base}/artifacts", params={"session": SESSION}).json()["total"] != 2:
        fail("session filter did not narrow the list")
    if client.get(f"{base}/artifacts", params={"kind": "image"}).json()["total"] != 1:
        fail("kind filter did not narrow the list")
    if client.get(f"{base}/artifacts", params={"kind": "sculpture"}).status_code != 400:
        fail("an unknown kind should be a 400")
    if client.get(f"{base}/artifacts/{first['id']}").json()["version"] != 2:
        fail("the single-row route disagrees with the list")
    if client.get(f"{base}/artifacts/nope").status_code != 404:
        fail("an unknown id should 404")

    # --- Content ----------------------------------------------------------
    content = client.get(f"{base}/artifacts/{first['id']}/content")

    if content.status_code != 200 or content.content != written.read_bytes():
        fail("content route did not serve the stored bytes")
    if not content.headers["content-type"].startswith("text/markdown"):
        fail(f"content route served the wrong type: {content.headers['content-type']}")
    if "inline" not in content.headers.get("content-disposition", ""):
        fail("content should be inline by default")
    if "attachment" not in client.get(f"{base}/artifacts/{first['id']}/content", params={"download": 1}).headers.get("content-disposition", ""):
        fail("?download=1 should serve an attachment")

    # --- Upload: the app filing a picture it sent ---------------------------
    uploaded = client.post(
        f"{base}/artifacts",
        json={"name": "upload_20260907_132822_1.png", "mimeType": "image/png", "sessionId": SESSION, "dataUrl": f"data:image/png;base64,{PNG_B64}"},
    )

    if uploaded.status_code != 200:
        fail(f"upload failed: {uploaded.status_code} {uploaded.text}")

    filed = uploaded.json()["artifact"]

    if filed["origin"] != "upload" or filed["kind"] != "image" or filed["sessionId"] != SESSION:
        fail(f"upload misdescribed: {filed}")
    if client.get(f"{base}/artifacts/{filed['id']}/content").content != base64.b64decode(PNG_B64):
        fail("uploaded bytes did not round-trip")
    if client.post(f"{base}/artifacts", json={"dataUrl": f"data:image/png;base64,{PNG_B64}"}).status_code != 400:
        fail("an upload without a name should be a 400")
    if client.post(f"{base}/artifacts", json={"name": "x.png", "dataUrl": "not a data url"}).status_code != 400:
        fail("an upload without a data URL should be a 400")

    # Filing the same picture twice — the app re-sends on a retry — is one row.
    client.post(
        f"{base}/artifacts",
        json={"name": "upload_20260907_132822_1.png", "mimeType": "image/png", "sessionId": SESSION, "dataUrl": f"data:image/png;base64,{PNG_B64}"},
    )

    if client.get(f"{base}/artifacts", params={"session": SESSION}).json()["total"] != 3:
        fail("re-uploading the same picture duplicated it")

    # --- Sharing ----------------------------------------------------------
    shared = client.post(f"{base}/artifacts/{first['id']}/share", json={})

    if shared.status_code != 200:
        fail(f"share failed: {shared.status_code} {shared.text}")

    share = shared.json()["share"]
    expected_prefix = f"http://testserver{base}/share/"

    if not share["url"].startswith(expected_prefix) or share["expiresAt"] is not None:
        fail(f"share URL is not under this router's mount: {share}")

    token = share["url"][len(expected_prefix):]
    opened = client.get(f"{base}/share/{token}")

    if opened.status_code != 200 or opened.content != written.read_bytes():
        fail("the share link did not serve the bytes")
    if client.post(f"{base}/artifacts/{first['id']}/share", json={}).json()["share"]["url"] != share["url"]:
        fail("sharing again rotated a link already handed out")
    if client.post(f"{base}/artifacts/{first['id']}/share", json={"expiresInHours": 0}).status_code != 400:
        fail("a zero expiry should be a 400")

    timed = client.post(f"{base}/artifacts/{first['id']}/share", json={"expiresInHours": 1}).json()["share"]

    if not timed["expiresAt"] or timed["expiresAt"] < int(time.time() * 1000) + 3_500_000:
        fail(f"an expiry did not land: {timed}")
    if client.get(f"{base}/artifacts/{first['id']}").json()["share"]["url"] != share["url"]:
        fail("the row does not carry its share")

    # Expired is indistinguishable from unknown.
    with sqlite3.connect(str(arts.db_path())) as conn:
        conn.execute("UPDATE artifacts SET share_expires_at = 1 WHERE id = ?", (first["id"],))

    if client.get(f"{base}/share/{token}").status_code != 404:
        fail("an expired share should 404")

    # And re-sharing an expired one mints a fresh token rather than reviving it.
    fresh = client.post(f"{base}/artifacts/{first['id']}/share", json={}).json()["share"]["url"]

    if fresh == share["url"]:
        fail("re-sharing after expiry should mint a new token")
    if client.request("DELETE", f"{base}/artifacts/{first['id']}/share").json() != {"ok": True}:
        fail("unshare did not report success")
    if client.get(f"{base}/share/{fresh[len(expected_prefix):]}").status_code != 404:
        fail("a revoked share should 404")
    if client.get(f"{base}/share/definitely-not-a-token").status_code != 404:
        fail("an unknown share should 404")

    # --- Thumbnails ---------------------------------------------------------
    # Each renderer is optional on purpose, so the assertion is conditional on
    # the tool being present here: with it, a PNG; without, a clean 404 that
    # the app falls back from. What must never happen is a 500 either way.
    thumbs = module.thumbnails

    def thumb(artifact_id):
        return client.get(f"{base}/artifacts/{artifact_id}/thumbnail")

    for label, artifact_id, expected in (
        ("image", image[0]["id"], thumbs.has_pillow()),
        ("markdown page", first["id"], thumbs.has_pillow()),
    ):
        response = thumb(artifact_id)

        if expected and (response.status_code != 200 or not response.content.startswith(b"\x89PNG")):
            fail(f"{label} thumbnail should be a PNG, got {response.status_code}")
        if not expected and response.status_code != 404:
            fail(f"{label} thumbnail without a renderer should 404, got {response.status_code}")

    # A second ask is served from the cache: the marker matches the sha.
    if thumbs.has_pillow():
        if not arts.thumbnail_marker_path(arts.get(first["id"])).read_text().strip() == arts.get(first["id"])["sha256"]:
            fail("a rendered thumbnail should be marked with the sha it came from")
        if thumb(first["id"]).status_code != 200:
            fail("a cached thumbnail should be served again")

    pdf = arts.record(data=MINIMAL_PDF, name="one-page.pdf", session_id=SESSION, origin="agent", tool="write_file")
    response = thumb(pdf["id"])

    if thumbs.has_pdftoppm():
        if response.status_code != 200 or not response.content.startswith(b"\x89PNG"):
            fail(f"PDF thumbnail should render through pdftoppm, got {response.status_code}")
    elif response.status_code != 404:
        fail(f"PDF thumbnail without pdftoppm should 404, got {response.status_code}")

    page = arts.record(data=b"<html><body><h1>Artifact check</h1><p>rendered by a browser</p></body></html>", name="page.html", session_id=SESSION, origin="agent", tool="write_file")
    response = thumb(page["id"])

    # A browser that is present may still refuse to screenshot headlessly —
    # Google Chrome on macOS hangs with another Chrome open — and that is a
    # timeout the plugin turns into a miss, not a failure. So: a PNG or a
    # clean 404, and a line saying which, never a 500.
    if response.status_code == 200:
        if not response.content.startswith(b"\x89PNG"):
            fail("HTML thumbnail answered 200 with something that is not a PNG")
    elif response.status_code == 404:
        print(f"note: no HTML thumbnail here (browser: {thumbs.chromium_binary() or 'none'}); the route 404s cleanly")
    else:
        fail(f"HTML thumbnail should be a PNG or a 404, got {response.status_code}")

    binary = arts.record(data=bytes(range(256)) * 4, name="blob.bin", session_id=SESSION, origin="agent", tool="write_file")

    if thumb(binary["id"]).status_code != 404:
        fail("a file nothing can render should 404, not 500")
    if thumb("nope").status_code != 404:
        fail("a thumbnail for an unknown id should 404")

    for extra in (pdf, page, binary):
        client.request("DELETE", f"{base}/artifacts/{extra['id']}")

    # --- Delete -----------------------------------------------------------
    bytes_path = arts.file_path(arts.get(first["id"]))
    thumb_path = arts.thumbnail_path(arts.get(first["id"]))

    if client.request("DELETE", f"{base}/artifacts/{first['id']}").json() != {"ok": True}:
        fail("delete did not report success")
    if bytes_path.exists():
        fail("delete left the bytes behind")
    if thumb_path.exists():
        fail("delete left the thumbnail behind")
    if client.get(f"{base}/artifacts/{first['id']}").status_code != 404:
        fail("a deleted artifact is still listed")
    if client.request("DELETE", f"{base}/artifacts/{first['id']}").status_code != 404:
        fail("deleting twice should 404")

    # --- The hook itself: capture on a thread, then the push -----------------
    # `_on_post_tool_call` hands the work to a daemon thread so the tool loop
    # is never held. Drive it the way Hermes does — keyword arguments only —
    # and wait for the row to appear. With no devices registered the push
    # returns early, which is the branch that must not raise here either.
    adapter = module._sibling("adapter")
    hooked = home / "notes.txt"
    hooked.write_text("from the hook\n")

    adapter._on_post_tool_call(
        tool_name="write_file",
        args={"path": str(hooked), "content": "from the hook\n"},
        result=json.dumps({"success": True, "resolved_path": str(hooked)}),
        session_id=SESSION,
        status="ok",
    )

    deadline = time.time() + 5

    while time.time() < deadline:
        names = [row["name"] for row in client.get(f"{base}/artifacts", params={"session": SESSION}).json()["artifacts"]]

        if "notes.txt" in names:
            break

        time.sleep(0.05)
    else:
        fail("the post_tool_call hook did not store the written file")

    # A tool the plugin does not treat as producing anything is left alone.
    adapter._on_post_tool_call(tool_name="terminal", args={"command": "ls"}, result="report.md", session_id=SESSION, status="ok")
    time.sleep(0.2)

    if client.get(f"{base}/artifacts").json()["total"] != 4:
        fail("a terminal call should not have been captured")



def check_standalone_send(home: Path) -> None:
    """Cron delivery through the platform face honours the host's contract.

    `tools/send_message_tool.py` calls a plugin's `standalone_sender_fn`
    positionally — `(platform_config, chat_id, chunk, thread_id=…,
    media_files=…, force_document=…)` — and treats any result without a
    `success` or `error` key as a failed delivery. The deployed plugin got both
    wrong for a week: it read the text off keyword arguments (so every push had
    an empty body) and answered `{"ok": True}` (so the scheduler logged a
    delivery error for a push that had gone out). The gateway log for the
    `mealplan-saturday-prompt` job is what surfaced it; this pins the contract
    so it cannot drift back.

    Imported as a package here, unlike `plugin_api.py` above, because
    `adapter.py`'s relative imports are exactly what the gateway's own loader
    provides for it.
    """
    import asyncio

    sys.path.insert(0, str(PLUGIN.parent))
    try:
        adapter = importlib.import_module("polyflow_agents_push.adapter")
    finally:
        sys.path.pop(0)

    sent: list[dict] = []
    adapter.push.notify = lambda **kwargs: sent.append(kwargs)  # type: ignore[assignment]

    wrapped = (
        "Cronjob Response: mealplan-saturday-prompt\n"
        "(job_id: a4bc5d151ad1)\n"
        "-------------\n\n"
        "Next week's plan for 2. Tell me: theme, dishes, anything to avoid.\n\n"
        "To stop or manage this job, send me a new message (e.g. \"stop reminder mealplan-saturday-prompt\")."
    )

    result = asyncio.run(
        adapter._standalone_send(None, "greg", wrapped, thread_id=None, media_files=[], force_document=False)
    )

    if result != {"success": True}:
        fail(f"standalone send must answer {{'success': True}} for the scheduler; got {result!r}")
    if len(sent) != 1:
        fail(f"one delivery should be one push, got {len(sent)}")

    push_kwargs = sent[0]

    if push_kwargs["title"] != "mealplan-saturday-prompt":
        fail(f"the job's name is the notification title, got {push_kwargs['title']!r}")
    if not push_kwargs["body"].startswith("Next week's plan for 2."):
        fail(f"the job's own output is the body, got {push_kwargs['body']!r}")
    if "To stop or manage" in push_kwargs["body"] or "job_id" in push_kwargs["body"]:
        fail("the scheduler's wrapper leaked into the push body")
    if push_kwargs["data"].get("jobId") != "a4bc5d151ad1" or push_kwargs["data"].get("source") != "cron":
        fail(f"the push must carry the job id for routing, got {push_kwargs['data']!r}")
    if push_kwargs["kind"] != "turnComplete":
        fail(f"an ordinary output is not a failure, got kind={push_kwargs['kind']!r}")

    # Unwrapped output (`cron.wrap_response: false`) passes through whole, and
    # the failure heuristic still reads it.
    sent.clear()
    asyncio.run(adapter._standalone_send(None, "greg", "Traceback (most recent call last): boom"))

    if sent[0]["kind"] != "cronFailures" or sent[0]["title"] != "Scheduled job":
        fail(f"unwrapped failure output should push as a failure with the generic title, got {sent[0]!r}")
    if sent[0]["body"] != "Traceback (most recent call last): boom":
        fail(f"unwrapped output must pass through untouched, got {sent[0]['body']!r}")


if __name__ == "__main__":
    raise SystemExit(main())
