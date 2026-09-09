"""Hermes plugin: push notifications for the Polyflow Agents app.

Three faces, loaded by up to three processes (see `docs/push-relay.md` §2, §3):

- **Hooks**, registered wherever a turn runs — for this app, `hermes serve`.
  They observe approvals, clarify questions, artifacts and finished turns and
  push them out.
- **A platform**, registered in the messaging gateway, so cron jobs can
  `deliver=polyflow_agents_push`.
- **Backend routes**, in `dashboard/plugin_api.py`, mounted by the web server
  under `/api/plugins/polyflow_agents_push/`. Registration arrives there.

Registration used to arrive through the *platform* face, as a control frame on
the webhook gateway's `deliver_only` path — the only inbound channel available
before a plugin could own an HTTP route. It can now, so that is gone and the
platform face is send-only, which is all it ever wanted to be.

Nothing here may raise into the agent. Every hook is wrapped, every failure is a
log line, and the push itself happens on a daemon thread — an approval waiting
on a plugin's HTTP call is an approval that has already failed.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional

from . import artifacts, devices, push

logger = logging.getLogger(__name__)

# The gateway platform's name. Kept identical to the plugin's on purpose: it is
# a third place the same thing gets named — after the pip distribution and the
# route prefix — and a platform called something else is a name nobody can
# derive from the other two. It is what cron config says (`deliver=...`) and
# what the home-channel env var is built from.
PLATFORM_NAME = "polyflow_agents_push"
PLATFORM_LABEL = "Polyflow Agents"

# Tools whose completion is worth interrupting someone for. "Artifact" is our
# word, not Hermes's — there is no artifact concept upstream, only tool output.
ARTIFACT_TOOLS = {"write_file", "image_gen", "video_gen", "generate_image", "generate_video"}

# Turns nobody asked the phone about. A delegated subagent's turn ends inside
# its parent's, which is the one worth announcing; a cron job's output has its
# own way here (`deliver=polyflow_agents_push`), and its session is not one the
# app can open. Everything else — the TUI, the desktop, the app itself — is a
# conversation someone started and may have walked away from.
SILENT_TURN_PLATFORMS = {"subagent", "cron"}

# How much of the reply fits in a banner. The app's local copy of this
# notification quotes the reply too; matching it means the two read alike.
PREVIEW_LIMIT = 140

# How long an end-of-turn push may hold its caller so the send survives a
# process that is about to exit. The CLI hard-exits via `os._exit`, which kills
# the sender thread mid-flight, so a turn that ends a `-z` one-shot or a cron
# worker pushes nothing at all without this. Generous against a measured 50-200ms
# round trip: it is a ceiling, paid only while the send is actually in flight,
# and only after the reply has already been delivered.
#
# Not applied to approvals or clarify questions. Those halt the agent and run in
# `hermes serve`, which lives for hours — the daemon thread is safe there, and
# blocking the path a person is waiting on would be the worse trade.
FLUSH_SECONDS = 5.0


# ── Hooks ────────────────────────────────────────────────────────────────────


# Approvals announced and not yet answered, so the "answered" push can name
# the same request the "asked" push did. Keyed by the session and the tool
# call, which both hooks carry; the request id itself only the first can see.
# Bounded because a `post` can go missing (a process exit mid-wait), and an
# entry that never clears must not be a leak.
_ANNOUNCED_LIMIT = 64
_announced_requests: Dict[str, str] = {}
_announced_lock = threading.Lock()


def _announced_key(kwargs: Dict[str, Any]) -> str:
    return "%s\x00%s\x00%s" % (
        kwargs.get("session_key") or "",
        kwargs.get("tool_call_id") or "",
        kwargs.get("command") or "",
    )


def _pending_request_id(session_key: str) -> str:
    """The id of the approval the gateway has just queued for this session.

    The hook carries no `request_id` on the gateway surface — only a plugin
    registered as an approval *transport* is handed one — but the app needs
    it: a push and the socket's `approval.request` are the same happening, and
    the app tells them apart by request id, so a push without one rang twice
    and could never be cleared by the answer.

    It can be read all the same. `_await_gateway_decision` appends the queue
    entry *before* it fires `pre_approval_request`, so at hook time the newest
    unresolved approval for the session is the one being announced. Read-only,
    through the same snapshot the gateway's own resume replay uses.
    """
    if not session_key:
        return ""

    try:
        from tools.approval import list_gateway_approvals

        pending = list_gateway_approvals(session_key)
    except Exception:
        logger.debug("[polyflow_agents_push] could not read the approval queue", exc_info=True)

        return ""

    if not pending:
        return ""

    return str(pending[-1].get("request_id") or "")


def _remember_announced(kwargs: Dict[str, Any], request_id: str) -> None:
    if not request_id:
        return

    with _announced_lock:
        if len(_announced_requests) >= _ANNOUNCED_LIMIT:
            oldest = next(iter(_announced_requests))
            _announced_requests.pop(oldest, None)

        _announced_requests[_announced_key(kwargs)] = request_id


def _forget_announced(kwargs: Dict[str, Any]) -> str:
    with _announced_lock:
        return _announced_requests.pop(_announced_key(kwargs), "")


def _on_approval_request(**kwargs: Any) -> None:
    """An approval is now blocking a turn.

    Fires for `surface` in cli / gateway / smart / transport:<name>. Smart-mode
    decisions are made by an auxiliary LLM with nobody being asked, so they are
    not something to wake a person for.
    """
    surface = str(kwargs.get("surface") or "")

    if surface == "smart":
        return

    command = str(kwargs.get("command") or "").strip()
    request_id = str(kwargs.get("request_id") or "") or _pending_request_id(str(kwargs.get("session_key") or ""))

    _remember_announced(kwargs, request_id)

    push.notify(
        kind="approvals",
        title="Approval needed",
        body=command[:140] or str(kwargs.get("description") or "A command needs your approval"),
        data={
            "requestId": request_id,
            "sessionId": kwargs.get("session_id") or "",
            "sessionKey": kwargs.get("session_key") or "",
        },
    )


def _on_approval_response(**kwargs: Any) -> None:
    """An approval was answered — possibly somewhere else.

    Sent data-only so the app can dismiss a banner it may still be showing. The
    phone cannot know an approval was resolved on the desktop any other way.
    """
    # By the time this fires the queue entry is gone, so the id comes from what
    # the request hook remembered. A smart-mode verdict never announced anything
    # and is skipped by the request hook; it finds nothing here and pushes an
    # id-less clear, which the app ignores.
    request_id = str(kwargs.get("request_id") or "") or _forget_announced(kwargs)

    push.notify(
        kind="approvals",
        title="",
        body="",
        data={
            "resolved": True,
            "requestId": request_id,
            "sessionId": kwargs.get("session_id") or "",
            "choice": kwargs.get("choice") or "",
        },
    )


def _on_pre_tool_call(**kwargs: Any) -> None:
    """The agent is about to ask a question.

    `clarify` is an ordinary registered tool, so this is the only signal it
    gives. There is no matching post-hook, which is why the app clears these on
    reconnect rather than waiting to be told.
    """
    if str(kwargs.get("tool_name") or "") != "clarify":
        return

    args = kwargs.get("args")

    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    question = ""

    if isinstance(args, dict):
        question = str(args.get("question") or args.get("prompt") or "")

    push.notify(
        kind="clarify",
        title="The agent has a question",
        body=question[:140] or "Waiting on your answer",
        data={"sessionId": kwargs.get("session_id") or ""},
    )


def _on_post_tool_call(**kwargs: Any) -> None:
    """Something was produced. See ARTIFACT_TOOLS for what counts.

    Two jobs, in order, on one daemon thread: copy what the tool made into the
    artifact store (`artifacts.py`), then push about it with the artifact's id
    so a tap opens the thing rather than the chat it came from. The copy comes
    first because the push is only worth sending once there is something to
    open — and neither may hold the tool loop, which is why the thread.
    """
    tool_name = str(kwargs.get("tool_name") or "")

    if tool_name not in ARTIFACT_TOOLS:
        return

    # A cancelled or failed call produced nothing. The hook says which when the
    # host is new enough to; an older host leaves it to the result's own
    # `error` field, which `capture_tool_result` reads.
    if str(kwargs.get("status") or "") in ("error", "cancelled"):
        return

    session_id = str(kwargs.get("session_id") or "")
    args = kwargs.get("args")
    result = kwargs.get("result")

    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    threading.Thread(
        target=_capture_then_notify,
        kwargs={"tool_name": tool_name, "args": args, "result": result, "session_id": session_id},
        name=f"polyflow-artifact-{tool_name}",
        daemon=True,
    ).start()


def _capture_then_notify(*, tool_name: str, args: Any, result: Any, session_id: str) -> None:
    stored: List[Dict[str, Any]] = artifacts.capture_tool_result(
        tool_name=tool_name, args=args, result=result, session_id=session_id
    )

    if stored:
        first = stored[0]
        body = first["name"] if len(stored) == 1 else f"{first['name']} and {len(stored) - 1} more"
        data: Dict[str, Any] = {
            "sessionId": session_id,
            "tool": tool_name,
            "artifactId": first["id"],
            "artifactCount": len(stored),
        }
    else:
        # Nothing landed in the store — the file was over the cap, or a
        # provider answered with something this plugin does not read. The tool
        # still finished, and that was what this notification always said.
        body = f"{tool_name} finished"
        data = {"sessionId": session_id, "tool": tool_name}

    push.notify(kind="artifacts", title="Artifact ready", body=body[:140], data=data)


def _on_post_llm_call(**kwargs: Any) -> None:
    """A turn finished.

    `post_llm_call` fires once per turn, after the tool loop, with the final
    reply — and only for a turn that completed rather than was interrupted.
    `session_id` is the stored id (`20260818_195944_3b37eb`), which is the one
    the app opens a chat by.

    This used to hang off `on_session_finalize`, which is not that at all: it
    is session *teardown* — the WS-orphan reap a few seconds after the app's
    socket drops, the idle reaper, LRU eviction on the session cap — and it
    never fires for a turn. Closing the app therefore pushed "Turn finished"
    for whichever idle sessions that socket had resumed (a chat mid-turn is
    skipped by the reaper, so it was reliably *not* the one you were in), and
    a turn that genuinely finished while the phone was away pushed nothing.
    """
    platform = str(kwargs.get("platform") or "")

    if platform in SILENT_TURN_PLATFORMS:
        # Debug, not info: subagent turns are frequent and this is the designed
        # outcome. It is logged at all because a turn vanishing here looks
        # identical to a turn that never fired the hook.
        logger.debug("[polyflow_agents_push] turn on %r is deliberately silent", platform)

        return

    push.notify(
        kind="turnComplete",
        title="Turn finished",
        body=_preview(str(kwargs.get("assistant_response") or "")) or "The agent finished what it was doing.",
        data={"sessionId": kwargs.get("session_id") or ""},
        # A turn ending is exactly when a short-lived process exits.
        flush=FLUSH_SECONDS,
    )


def _preview(text: str, limit: int = PREVIEW_LIMIT) -> str:
    """One line of a reply, fit for a banner: whitespace collapsed, cut at a word."""
    flat = " ".join(text.split())

    if len(flat) <= limit:
        return flat

    cut = flat[:limit]
    space = cut.rfind(" ")

    return (cut[:space] if space > limit * 0.6 else cut).rstrip() + "…"


# ── Platform face ────────────────────────────────────────────────────────────


def _build_adapter(config: Any) -> Any:
    """Imported lazily: the gateway's platform base is not importable in every
    process that loads this plugin, and the hooks must work in the ones where it
    is not."""
    from gateway.config import Platform
    from gateway.platforms.base import BasePlatformAdapter, SendResult

    class PolyflowAgentsPushAdapter(BasePlatformAdapter):
        """A send-only platform whose "chat" is a set of phones.

        Nothing arrives here. Registration moved to `dashboard/plugin_api.py`
        once a plugin could own an HTTP route, which left this face doing the
        one job it is suited to: handing cron output to the push client.
        """

        # Signatures below mirror `gateway/platforms/base.py` exactly. The
        # gateway calls `connect(is_reconnect=...)` and `send_typing(chat_id,
        # metadata)`; a shortened override raises TypeError at connect time and
        # the platform never comes up.
        def __init__(self, cfg: Any) -> None:
            super().__init__(cfg, Platform(PLATFORM_NAME))

        async def connect(self, *, is_reconnect: bool = False) -> bool:
            logger.info("[polyflow_agents_push] platform ready (%d device(s))", len(devices.load()))

            return True

        async def disconnect(self) -> None:
            return None

        async def send(
            self,
            chat_id: str,
            content: str,
            reply_to: Optional[str] = None,
            metadata: Optional[Dict[str, Any]] = None,
        ) -> Any:
            push.notify(
                kind="cronFailures" if _looks_like_failure(content) else "turnComplete",
                title="Hermes",
                body=content[:200],
                data={"chatId": chat_id or ""},
            )

            return SendResult(success=True)

        async def send_typing(self, chat_id: str, metadata: Any = None) -> None:
            # Nothing to show: a push is not a conversation you can see someone
            # typing into.
            return None

        async def send_image(self, chat_id: str, image_url: str, caption: str = "", **_: Any) -> Any:
            # A push carries no image. Say what happened rather than dropping it.
            push.notify(
                kind="artifacts",
                title="Image ready",
                body=caption[:140] or "The agent produced an image.",
                data={"chatId": chat_id or "", "imageUrl": image_url},
            )

            return SendResult(success=True)

        async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
            return {"name": PLATFORM_LABEL, "type": "dm", "chat_id": chat_id}

    return PolyflowAgentsPushAdapter(config)


def _looks_like_failure(text: str) -> bool:
    """Cron delivery does not say whether the job succeeded.

    The app's preference is failures-only, and the delivery target carries no
    status, so this is a heuristic on the rendered output. It is the weakest
    thing in this plugin and is documented as such in the README.
    """
    lowered = (text or "").lower()

    return any(marker in lowered for marker in ("error", "failed", "failure", "traceback", "exception"))


# ── Entry point ──────────────────────────────────────────────────────────────


def register(ctx: Any) -> None:
    """Called by Hermes's plugin manager in every process that discovers us.

    Both faces are registered unconditionally and each is allowed to fail: the
    platform registration needs gateway internals that `hermes serve` does not
    import, and the hooks are useless in a process that never runs a turn.
    Registering what works and logging what does not is what lets one directory
    serve both.
    """
    registered = []

    for hook_name, callback in (
        ("pre_approval_request", _safe(_on_approval_request)),
        ("post_approval_response", _safe(_on_approval_response)),
        ("pre_tool_call", _safe(_on_pre_tool_call)),
        ("post_tool_call", _safe(_on_post_tool_call)),
        ("post_llm_call", _safe(_on_post_llm_call)),
    ):
        try:
            ctx.register_hook(hook_name, callback)
            registered.append(hook_name)
        except Exception:
            logger.warning("[polyflow_agents_push] could not register hook %s", hook_name, exc_info=True)

    # One line, at startup, naming the process that will (or will not) push.
    # Hook registration used to be entirely silent on success, so "the plugin
    # is loaded" and "this process will fire hooks" were indistinguishable —
    # and the difference is the whole game: `hermes serve` runs the turns, and
    # if its hooks are not registered nothing is ever sent, with nothing said.
    logger.info(
        "[polyflow_agents_push] registered %d hook(s) in pid %d: %s",
        len(registered),
        os.getpid(),
        ", ".join(registered) or "none",
    )

    try:
        ctx.register_platform(
            name=PLATFORM_NAME,
            label=PLATFORM_LABEL,
            adapter_factory=_build_adapter,
            check_fn=lambda: True,
            emoji="📱",
            # Lets `deliver=polyflow_agents_push` cron jobs route here without patching
            # cron/scheduler.py's hardcoded target sets.
            cron_deliver_env_var="POLYFLOW_AGENTS_PUSH_HOME_CHANNEL",
            standalone_sender_fn=_standalone_send,
        )
    except ImportError:
        # Expected in a process that never imports the gateway — `hermes serve`
        # runs turns and fires hooks but has no platform registry.
        logger.debug("[polyflow_agents_push] no platform registry in this process")
    except Exception:
        # Not expected, and not something to shrug off: without the platform
        # face there is no cron delivery, so notifications would half-work with
        # nothing saying why. Registration is unaffected — that is the web
        # server's face, in a different process.
        logger.warning("[polyflow_agents_push] platform registration FAILED", exc_info=True)


async def _standalone_send(*_args: Any, **kwargs: Any) -> Dict[str, Any]:
    """Out-of-process cron delivery.

    Cron jobs can run in a process with no live adapter, where a `deliver=` job
    otherwise fails with `No live adapter for platform 'polyflow_agents_push'`.
    Push has no
    connection to hold, so serving these is just sending.
    """
    text = str(kwargs.get("text") or kwargs.get("message") or "")

    push.notify(
        kind="cronFailures" if _looks_like_failure(text) else "turnComplete",
        title="Hermes",
        body=text[:200],
        data={"source": "cron"},
        # The whole reason this function exists is delivery from a process with
        # no live adapter — which is usually one that is about to exit.
        flush=FLUSH_SECONDS,
    )

    return {"ok": True}


def _safe(callback: Any) -> Any:
    """Belt and braces.

    Hermes already isolates per-callback failures, but the approval path is
    safety-critical and this plugin is not: it should be impossible for anything
    here to reach code that decides whether a command runs.
    """

    def wrapped(**kwargs: Any) -> None:
        try:
            callback(**kwargs)
        except Exception:
            logger.warning("[polyflow_agents_push] hook raised; ignoring", exc_info=True)

    return wrapped
