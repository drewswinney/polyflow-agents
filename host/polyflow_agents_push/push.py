"""The Expo push client.

Stdlib only. The gateway has aiohttp, but the hooks run in ``hermes serve``'s
process and fire from synchronous agent code, so this stays dependency-free and
thread-based rather than assuming an event loop is available to borrow.

Two rules govern everything here:

1. **Never block the caller.** A hook that fires on the approval path is on the
   agent's critical path. `notify()` hands off to a daemon thread and returns.
2. **Never raise.** `tools/approval.py` is explicit that "approval flow is
   safety-critical, plugin observability is not". A push failure is a log line.

Rule 1 has one deliberate exception, and it exists because the daemon thread is
a lie in a process that is about to die. The Hermes CLI hard-exits through
``os._exit`` (`hermes_cli/main.py`), which skips interpreter finalization and
kills threads where they stand — so a ``-z`` one-shot, or a cron/kanban worker
that exits straight after its turn, would start the send and vanish mid-flight.
No error, no log: the POST simply never happens. `notify(flush=...)` therefore
lets a caller wait for the send, and the end-of-turn and cron paths use it.
Measured round trip to Expo is 50-200ms, so the wait is real but small, and the
reply is already on screen by the time it is paid.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request
from typing import Any, Dict, List

from . import devices

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
REQUEST_TIMEOUT_SECONDS = 10
# Expo's documented ceiling for one request.
MAX_MESSAGES_PER_REQUEST = 100


def notify(
    *,
    kind: str,
    title: str,
    body: str,
    data: Dict[str, Any] | None = None,
    flush: float = 0.0,
) -> None:
    """Queue a push to every device that asked for this kind.

    Returns immediately by default. Pass ``flush`` (seconds) to wait for the
    send from a caller that may be in a process about to exit — see the module
    docstring. The wait is a ceiling, not a cost: `join` returns the moment the
    send lands, which is normally well under a second.

    Never raises, and never waits on the approval path: an agent halted on a
    question must not also be waiting on a notification.
    """
    thread = threading.Thread(
        target=_send_now,
        kwargs={"kind": kind, "title": title, "body": body, "data": data or {}},
        name=f"polyflow-push-{kind}",
        daemon=True,
    )
    thread.start()

    if flush <= 0:
        return

    thread.join(flush)

    if thread.is_alive():
        # Said out loud because the alternative is the silence this whole
        # mechanism exists to remove: if the process is exiting, this push is
        # about to be killed, and nothing else would ever mention it.
        logger.warning(
            "[polyflow_agents_push] %s: send still running after %.1fs; "
            "it will be lost if this process is exiting",
            kind,
            flush,
        )


def _send_now(*, kind: str, title: str, body: str, data: Dict[str, Any]) -> None:
    try:
        registered = devices.load()
        targets = [d for d in registered if devices.wants(d, kind)]

        if not targets:
            # Logged, not shrugged off. This return is what a registry read from
            # the wrong Hermes home looks like from the outside — no push, no
            # error, nothing in the log — and it cost an evening to find once.
            # Naming the path it read makes the same fault self-evident next time.
            logger.info(
                "[polyflow_agents_push] %s: no target devices (%d registered) in %s",
                kind,
                len(registered),
                devices.store_path(),
            )

            return

        messages = [
            {
                "to": device["token"],
                "title": title,
                "body": body,
                # Per device, not per message: `agentId` is the receiving app's
                # own id for this agent, so two phones registered against
                # different agent records get different payloads.
                "data": {**data, "kind": kind, "agentId": device.get("agentId", "")},
                # Approvals are the only thing here that halts the agent, so
                # they are the only thing that may bypass a quiet phone.
                "priority": "high" if kind == "approvals" else "default",
                "channelId": "approvals" if kind == "approvals" else "default",
            }
            for device in targets
        ]

        for start in range(0, len(messages), MAX_MESSAGES_PER_REQUEST):
            _post(messages[start : start + MAX_MESSAGES_PER_REQUEST])

        # A success line, because silence used to be indistinguishable from
        # every way this can fail quietly.
        logger.info("[polyflow_agents_push] %s: sent to %d device(s)", kind, len(messages))
    except Exception:
        logger.warning("[polyflow_agents_push] notification failed", exc_info=True)


def _post(messages: List[Dict[str, Any]]) -> None:
    request = urllib.request.Request(
        EXPO_PUSH_URL,
        data=json.dumps(messages).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except urllib.error.URLError as exc:
        logger.warning("[polyflow_agents_push] Expo unreachable: %s", exc)

        return

    _prune_dead_tokens(messages, payload)


def _prune_dead_tokens(messages: List[Dict[str, Any]], payload: Any) -> None:
    """Drop tokens Expo says are gone.

    `DeviceNotRegistered` means the app was uninstalled or the token rotated.
    Keeping it means every future send carries a receipt that will never arrive,
    so the registry self-heals here rather than growing forever.
    """
    tickets = payload.get("data") if isinstance(payload, dict) else None

    if not isinstance(tickets, list):
        return

    for message, ticket in zip(messages, tickets):
        if not isinstance(ticket, dict) or ticket.get("status") != "error":
            continue

        details = ticket.get("details") or {}

        if details.get("error") == "DeviceNotRegistered":
            devices.unregister(message["to"])
        else:
            logger.warning("[polyflow_agents_push] Expo rejected a message: %s", ticket.get("message"))
