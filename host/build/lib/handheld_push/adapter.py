"""Hermes plugin: push notifications for the handheld app.

Three faces, loaded by up to three processes (see `docs/push-relay.md` §2, §3):

- **Hooks**, registered wherever a turn runs — for this app, `hermes serve`.
  They observe approvals, clarify questions and artifacts and push them out.
- **A platform**, registered in the messaging gateway, so cron jobs can
  `deliver=handheld`.
- **Backend routes**, in `dashboard/plugin_api.py`, mounted by the web server
  under `/api/plugins/handheld-push/`. Device registration arrives there.

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
from typing import Any, Dict, Optional

from . import devices, push

logger = logging.getLogger(__name__)

PLATFORM_NAME = "handheld"
PLATFORM_LABEL = "Handheld"

# Tools whose completion is worth interrupting someone for. "Artifact" is our
# word, not Hermes's — there is no artifact concept upstream, only tool output.
ARTIFACT_TOOLS = {"write_file", "image_gen", "video_gen", "generate_image", "generate_video"}


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
    """Something was produced. See ARTIFACT_TOOLS for what counts."""
    tool_name = str(kwargs.get("tool_name") or "")

    if tool_name not in ARTIFACT_TOOLS:
        return

    push.notify(
        kind="artifacts",
        title="Artifact ready",
        body=f"{tool_name} finished",
        data={"sessionId": kwargs.get("session_id") or "", "tool": tool_name},
    )


def _on_session_finalize(**kwargs: Any) -> None:
    """A turn finished while you were away."""
    push.notify(
        kind="turnComplete",
        title="Turn finished",
        body="The agent finished what it was doing.",
        data={"sessionId": kwargs.get("session_id") or ""},
    )


# ── Platform face ────────────────────────────────────────────────────────────


def _build_adapter(config: Any) -> Any:
    """Imported lazily: the gateway's platform base is not importable in every
    process that loads this plugin, and the hooks must work in the ones where it
    is not."""
    from gateway.config import Platform
    from gateway.platforms.base import BasePlatformAdapter, SendResult

    class HandheldPushAdapter(BasePlatformAdapter):
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
            logger.info("[handheld-push] platform ready (%d device(s))", len(devices.load()))

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

    return HandheldPushAdapter(config)


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
    for hook_name, callback in (
        ("pre_approval_request", _safe(_on_approval_request)),
        ("post_approval_response", _safe(_on_approval_response)),
        ("pre_tool_call", _safe(_on_pre_tool_call)),
        ("post_tool_call", _safe(_on_post_tool_call)),
        ("on_session_finalize", _safe(_on_session_finalize)),
    ):
        try:
            ctx.register_hook(hook_name, callback)
        except Exception:
            logger.warning("[handheld-push] could not register hook %s", hook_name, exc_info=True)

    try:
        ctx.register_platform(
            name=PLATFORM_NAME,
            label=PLATFORM_LABEL,
            adapter_factory=_build_adapter,
            check_fn=lambda: True,
            emoji="📱",
            # Lets `deliver=handheld` cron jobs route here without patching
            # cron/scheduler.py's hardcoded target sets.
            cron_deliver_env_var="HANDHELD_HOME_CHANNEL",
            standalone_sender_fn=_standalone_send,
        )
    except ImportError:
        # Expected in a process that never imports the gateway — `hermes serve`
        # runs turns and fires hooks but has no platform registry.
        logger.debug("[handheld-push] no platform registry in this process")
    except Exception:
        # Not expected, and not something to shrug off: without the platform
        # face there is no cron delivery, so notifications would half-work with
        # nothing saying why. Registration is unaffected — that is the web
        # server's face, in a different process.
        logger.warning("[handheld-push] platform registration FAILED", exc_info=True)


async def _standalone_send(*_args: Any, **kwargs: Any) -> Dict[str, Any]:
    """Out-of-process cron delivery.

    Cron jobs can run in a process with no live adapter, where a `deliver=` job
    otherwise fails with `No live adapter for platform 'handheld'`. Push has no
    connection to hold, so serving these is just sending.
    """
    text = str(kwargs.get("text") or kwargs.get("message") or "")

    push.notify(
        kind="cronFailures" if _looks_like_failure(text) else "turnComplete",
        title="Hermes",
        body=text[:200],
        data={"source": "cron"},
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
            logger.warning("[handheld-push] hook raised; ignoring", exc_info=True)

    return wrapped
