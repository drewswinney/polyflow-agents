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
import re
import threading
import time
from collections import deque
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

    push.notify(
        kind="approvals",
        title="Approval needed",
        body=command[:140] or str(kwargs.get("description") or "A command needs your approval"),
        data={
            "requestId": kwargs.get("request_id") or "",
            "sessionId": kwargs.get("session_id") or "",
            "sessionKey": kwargs.get("session_key") or "",
        },
    )


def _on_approval_response(**kwargs: Any) -> None:
    """An approval was answered — possibly somewhere else.

    Sent data-only so the app can dismiss a banner it may still be showing. The
    phone cannot know an approval was resolved on the desktop any other way.
    """
    push.notify(
        kind="approvals",
        title="",
        body="",
        data={
            "resolved": True,
            "requestId": kwargs.get("request_id") or "",
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
        # The title, not the filename: "Q3 report" reads on a lock screen the
        # way `q3-report-final-v2.md` does not.
        body = first["title"] if len(stored) == 1 else f"{first['title']} and {len(stored) - 1} more"
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

    # A cron run is silent here but not forgotten: its delivery goes out a
    # moment later through the standalone sender, which knows the text and
    # nothing else. This is where the session id is, so this is where it is
    # kept for the push to carry.
    if platform == "cron":
        _remember_cron_turn(str(kwargs.get("session_id") or ""), str(kwargs.get("assistant_response") or ""))

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


# ── Cron runs, remembered for their delivery ─────────────────────────────────
#
# The scheduler runs a job's turn and then hands its text to the platform for
# delivery, in that order and in the same process. `post_llm_call` fires in
# between with the session id; the standalone sender gets only the text. A few
# recent turns are kept here so the sender can find the session its text came
# from, and the push can open it. Small and short-lived on purpose: a delivery
# follows its turn within seconds, and a job that runs for a day is still one
# entry.

_RECENT_CRON_TURNS: "deque[Dict[str, Any]]" = deque(maxlen=8)
_RECENT_CRON_TURNS_LOCK = threading.Lock()
# How long a turn stays claimable. Delivery is normally immediate; the margin
# covers a slow send path, not a later run.
_CRON_TURN_TTL_SECONDS = 15 * 60
# When the text does not match any remembered turn, the newest one this recent
# is still taken to be it — the scheduler may have reshaped the text (media
# tags, chunking) between the turn and the send.
_CRON_TURN_FRESH_SECONDS = 60

_CRON_SESSION_ID = re.compile(r"^cron_(?P<job>[0-9a-f]+)_")


def _remember_cron_turn(session_id: str, response: str) -> None:
    if not session_id:
        return

    with _RECENT_CRON_TURNS_LOCK:
        _RECENT_CRON_TURNS.append({"session_id": session_id, "response": " ".join(response.split()), "at": time.time()})


def _recall_cron_turn(body: str) -> Optional[Dict[str, Any]]:
    """The remembered turn whose reply this delivery text is, or None.

    Matched on the text first — exact, then either being a prefix of the other,
    since the scheduler may have chunked a long reply or cut media tags out of
    it. Failing that, the newest turn from the last minute: two jobs finishing
    in the same minute is rare, and a wrong session beats no session by less
    than it costs, so the window is short.
    """
    flat = " ".join(body.split())
    now = time.time()

    with _RECENT_CRON_TURNS_LOCK:
        recent = [turn for turn in _RECENT_CRON_TURNS if now - turn["at"] < _CRON_TURN_TTL_SECONDS]

    if not recent or not flat:
        return None

    for turn in reversed(recent):
        response = turn["response"]

        if response == flat or (len(flat) >= 40 and (response.startswith(flat) or flat.startswith(response))):
            return turn

    newest = recent[-1]

    return newest if now - newest["at"] < _CRON_TURN_FRESH_SECONDS else None


def _cron_job_id_of(session_id: str) -> str:
    """The job a cron run session belongs to: run sessions are named `cron_<job>_<stamp>`."""
    match = _CRON_SESSION_ID.match(session_id or "")

    return match.group("job") if match else ""


def _cron_job_name(job_id: str) -> str:
    """The job's name off the profile's store, or empty. Only importable where cron is."""
    if not job_id:
        return ""

    try:
        from cron.jobs import get_job

        job = get_job(job_id) or {}

        return str(job.get("name") or "")
    except Exception:
        return ""


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
            # The gateway's own delivery path: when it is running, the scheduler
            # sends through this before it would ever try the standalone
            # sender. Same push either way — the gateway outlives the send, so
            # no flush is needed here.
            _push_cron_delivery(chat_id, content, flush=0.0)

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


async def _standalone_send(
    _config: Any,
    chat_id: str,
    text: str,
    *,
    thread_id: Any = None,
    media_files: Any = None,
    force_document: bool = False,
    **_ignored: Any,
) -> Dict[str, Any]:
    """Out-of-process cron delivery.

    Cron jobs can run in a process with no live adapter — `hermes cron run`,
    the dashboard's trigger route — where a `deliver=` job otherwise fails with
    `No live adapter for platform 'polyflow_agents_push'`. Push has no
    connection to hold, so serving these is just sending.

    Hermes calls this positionally — `(platform_config, chat_id, chunk, ...)`,
    see `tools/send_message_tool.py` — and reads the result for a `success` or
    `error` key. The first version read the text off keyword arguments and
    answered `{"ok": True}`, so every delivery pushed an empty body and was then
    logged by the scheduler as a delivery error. Both are contract, not style.
    """
    del thread_id, media_files, force_document

    # The whole reason this function exists is delivery from a process with no
    # live adapter — which is usually one that is about to exit.
    _push_cron_delivery(chat_id, str(text or ""), flush=FLUSH_SECONDS)

    return {"success": True}


def _push_cron_delivery(chat_id: str, text: str, *, flush: float) -> None:
    """One cron delivery, as a push — from the live adapter or the standalone sender.

    The run this text came from, when the turn-finished hook saw it, names its
    session: an agent job's push then opens the conversation that asked the
    question, and a reply lands where it can be acted on. A script job has no
    turn and no session; its push opens nothing.
    """
    job, body = _split_cron_wrapper(text)
    turn = _recall_cron_turn(body)
    session_id = str(turn["session_id"]) if turn else ""
    job_id = job["id"] or _cron_job_id_of(session_id)

    push.notify(
        kind="cronFailures" if _looks_like_failure(body) else "turnComplete",
        title=job["name"] or _cron_job_name(job_id) or "Scheduled job",
        body=body[:200],
        data={
            "source": "cron",
            "jobId": job_id,
            "chatId": str(chat_id or ""),
            **({"sessionId": session_id} if session_id else {}),
        },
        flush=flush,
    )


_CRON_HEADER = re.compile(
    r"\A\s*Cronjob Response:[ \t]*(?P<name>[^\n]*)\n"
    r"(?:\(job_id:[ \t]*(?P<id>[^)\n]*)\)\n)?"
    r"-{3,}\n+",
)
_CRON_FOOTER = re.compile(r"\n+To stop or manage this job, send me a new message[^\n]*\s*\Z")


def _split_cron_wrapper(text: str) -> tuple[Dict[str, str], str]:
    """The job named by the scheduler's delivery wrapper, and the output under it.

    `cron.scheduler._deliver_result` wraps every delivery in a header naming
    the job and a footer saying how to stop it (unless `cron.wrap_response` is
    off). On a phone the header is the notification's title and the footer is
    noise, so the wrapper is read off and the job's own output is what shows.
    Unwrapped text passes through with no name and no id.
    """
    head = _CRON_HEADER.match(text)
    body = text[head.end():] if head else text
    body = _CRON_FOOTER.sub("", body).strip()

    return (
        {
            "name": (head.group("name") or "").strip() if head else "",
            "id": (head.group("id") or "").strip() if head else "",
        },
        body,
    )


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
