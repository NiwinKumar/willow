"""Wisp's live voice over a WebSocket (app/live.py).

Browsers cannot put an Authorization header on a WebSocket, so the first message carries it:
{"type": "start", "token": <Firebase ID token>, "lang": "en"} (with AUTH_MODE=dev, "dev_uid"
instead of the token). The demo journey's route needs no sign-in and answers from its data, on one
shared daily cap, like the demo's typed Wisp. After the start message: binary frames are 16 kHz
16-bit mono PCM from the microphone; text frames are {"type": "mute"} or {"type": "end"}. The api
sends binary 24 kHz PCM (Wisp's voice) and JSON events: ready, caption, tool, interrupted, flush,
corrected, refused, turn_complete, reconnecting, reconnected, ending, ended, error.

WebSockets skip CORS, so the Origin is checked here against the same allowed origins.
"""

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from firebase_admin import auth as fb_auth

from app import limits, live
from app.auth import _firebase_app
from app.settings import get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["voice"])
log = logging.getLogger("willow.api.live")

START_TIMEOUT_S = 10.0
BUSY = "Wisp's voice is busy right now. Try again in a moment, or type your question."


def user_of(start: dict[str, Any]) -> str | None:
    """The signed-in uid from the start message, or None."""
    s = get_settings()
    if s.auth_mode == "dev":
        uid = start.get("dev_uid")
        return uid if isinstance(uid, str) and uid else None
    token = start.get("token")
    if not isinstance(token, str) or not token:
        return None
    try:
        return fb_auth.verify_id_token(token, app=_firebase_app(s))["uid"]
    except Exception:  # expired, revoked, malformed
        return None


async def _send(ws: WebSocket, event: dict[str, Any]) -> None:
    with contextlib.suppress(Exception):  # the browser may already be gone
        await ws.send_text(json.dumps(event))


async def serve(ws: WebSocket, store: Store, demo: bool) -> None:
    origin = ws.headers.get("origin")
    if origin and origin not in get_settings().origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        start = json.loads(await asyncio.wait_for(ws.receive_text(), START_TIMEOUT_S))
    except Exception:
        await ws.close(code=1008)
        return
    uid = get_settings().demo_user_id if demo else user_of(start)
    if not uid:
        await _send(ws, {"type": "error", "code": "unauthenticated", "message": "Sign in again."})
        await ws.close(code=1008)
        return
    action = "demo_voice_live" if demo else "voice_live"
    try:
        await asyncio.to_thread(limits.take, store, uid, action)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        await _send(ws, {"type": "error", **detail})
        await ws.close(code=1000)
        return

    conv = live.Conversation(
        store,
        uid,
        str(start.get("lang") or "en"),
        send=lambda e: _send(ws, e),
        send_audio=ws.send_bytes,
    )
    try:
        await conv.open()
    except Exception as exc:
        log.info("voice live connect retry: %s", type(exc).__name__)
        try:  # Vertex is often busy for a moment (1011): one more try
            await asyncio.sleep(0.8)
            await conv.open()
        except Exception:
            log.warning("voice live connect failed: %s", type(exc).__name__)
            await asyncio.to_thread(limits.refund, store, uid, action)
            await _send(ws, {"type": "error", "code": "voice_busy", "message": BUSY})
            await ws.close(code=1000)
            return

    events: asyncio.Queue[Any] = asyncio.Queue()

    async def read_browser() -> None:
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await events.put(msg["bytes"])
                elif msg.get("text"):
                    with contextlib.suppress(ValueError):
                        await events.put(json.loads(msg["text"]))
        except (WebSocketDisconnect, RuntimeError):
            pass
        await events.put(None)

    reader = asyncio.create_task(read_browser())
    try:
        await _send(ws, {"type": "ready", "max_seconds": live.MAX_S})
        await conv.greet()
        reason = await live.run(conv, events)
        if reason == "gemini_error":
            await _send(ws, {"type": "error", "code": "voice_busy", "message": BUSY})
        else:
            await _send(ws, {"type": "ended", "reason": reason})
    finally:
        reader.cancel()
        await conv.close()
        with contextlib.suppress(Exception):
            await ws.close(code=1000)


@router.websocket("/voice/live")
async def voice_live(ws: WebSocket) -> None:
    await serve(ws, get_store(), demo=False)


@router.websocket("/demo/voice/live")
async def demo_voice_live(ws: WebSocket) -> None:
    """The demo journey (no sign-in): answered from its data, never stored, one shared cap."""
    await serve(ws, get_store(), demo=True)
