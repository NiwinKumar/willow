"""Wisp's live voice (Nov 28, docs/GEMINI_SPEC.md "Voice"): a spoken conversation with Gemini Live.

The browser streams microphone audio (16 kHz PCM) to the api over a WebSocket; the api holds the
Live session on Vertex (the browser never holds Google credentials) and streams Wisp's voice
(24 kHz PCM) back. Nothing is written into the chat and no audio or transcript is stored.

Live voice gives up checking the text before it is spoken (the typed Wisp's order) for a real
conversation, so the guards move around it:
1. Instructions: cosmetic language only, no condition names, no scores, skin age or tone ranking,
   numbers only from tool results ("I don't have that" otherwise).
2. Tools are the only source of facts: the person's readings, routine, catalog search, product
   comparison and the routine check, run here for the signed-in person (or the demo journey).
3. Model Armor screens what the person said (the input transcription) before any of the model's
   reply is passed on; a match drops the reply, starts a fresh session (so the attempt is not in
   its context) and has it say the fixed refusal.
4. The output transcription is checked as it streams and at the end of each turn: every number
   must be in a tool result or the person's own words (app/numbers.py; spoken English number
   words such as "seven" or "a dozen" too, see spoken_numbers), and no banned word in the
   language spoken (app/translate.py clean_words). A violation stops the audio in the browser and
   Wisp says a short correction. The transcript leads the audio by a fraction of a second, so the
   check usually lands before the number is heard, but not always: a wrong number may be partly
   heard before the correction.
Logs carry counts and violation kinds only (prompt_id voice_live), never transcript text.
"""

import asyncio
import contextlib
import json
import logging
import os
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

import google.auth
from google import genai
from google.genai import types

from app import advisor, armor, numbers, translate
from app.settings import get_settings
from app.store import Store

log = logging.getLogger("willow.live")

MODEL = os.environ.get("GEMINI_LIVE_MODEL", "gemini-live-2.5-flash-native-audio")
LOCATION = "us-central1"  # Live is regional: not the global endpoint the text models use
VOICE = "Achernar"  # the narration's voice
# Cloud Run ends a request (a WebSocket included) at the service's --timeout, 300 s for the api
# today: the default cap stays inside it. Raise both together for longer talks (infra/README.md).
MAX_S = int(os.environ.get("VOICE_LIVE_MAX_S") or 270)
GOODBYE_BEFORE_S = 15
RECONNECTS = 2  # Vertex closes busy Live sessions with 1011 "Resource exhausted" (Nov 28)
REOPEN_WAIT_S = 0.8  # a fresh session after a refusal gets one more try after this
SCREEN_WAIT_S = armor.TIMEOUT_S + 1.0

INSTRUCTIONS = """You are Wisp, Willow's skincare assistant, talking with one person by voice.
Speak naturally and briefly: one to three short sentences, then stop and let them talk.
Always answer in the language the person is speaking.
- Facts come only from your tools. For anything about their readings, results, check-ins or how
  something changed, call get_my_readings first. For their routine, call get_my_routine; for
  whether their products go together, check_routine. For products, prices and ingredients, call
  search_catalog or compare_products. Never answer those from memory.
- Say a number only if it is in a tool result in this conversation, or the person said it. Never
  estimate, compute, round differently or convert a number. If you don't have it, say "I don't
  have that".
- Willow gives no skin score, no skin age and never ranks skin tone. Never imply lighter skin is
  better. A change is against the person's own start: verdict real_change = changed by more than
  their photos usually vary; within_noise = about the same; no_baseline = not enough yet. Say it
  in everyday words ("7 fewer blemishes than at your start"), never delta, noise band or mdc.
- Cosmetic language only. Never name a skin condition or disease, never diagnose, never say acne,
  treat, cure or heal; say blemishes or breakouts. For a changing mole, bleeding, pain or a rash,
  suggest seeing a dermatologist. Never advise on a prescription medicine: say to ask a doctor or
  pharmacist.
- Recommend only products a tool returned, and only those Willow may suggest (check status not
  avoid). Never call a product safe; say "no flags for your profile". One currency, as the tool
  gives it; never convert. Cohort outcome rates are from Willow's simulated cohort: say so.
- A product that stings, burns or reddens the skin: say to stop using it and rinse with water.
- If you are told the person's last words were screened out, say only the line you are given."""

GREETING = (
    "(Willow: the person just opened voice mode. Greet them in one short sentence in {language}: "
    "say you are Wisp and ask what they would like to know about their skin or routine. No "
    "numbers. Then listen.)"
)
CORRECTIONS = {
    "number": "Sorry, I misspoke; I can only give numbers from your readings.",
    "wording": "Sorry, I misspoke; Willow only talks about how skin looks, not conditions.",
}
CORRECT = (
    "(Willow: your last spoken answer broke Willow's rules and was cut off. Say only this, in the "
    'language you were speaking, then stop: "{line}")'
)
REFUSE = (
    "(Willow: the person's last words were screened out by Willow's safety filter and are not "
    'shown to you. Say only this, in {language}, then stop: "{line}")'
)
DROPPED = (
    "(Willow: the line dropped for a moment. Say sorry in a few words and ask them to say their "
    "last question again.)"
)
GOODBYE = (
    "(Willow: this voice session ends in a few seconds. Say a short goodbye in one sentence and "
    "that they can start again any time.)"
)

TOOLS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="get_my_readings",
            description="The person's latest check-in readings per site with each metric's "
            "verdict against their own start, what they noted since, patterns found across "
            "check-ins, skin type and goals.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
        types.FunctionDeclaration(
            name="get_my_routine",
            description="The person's routine products (slots, actives, how often used recently, "
            "how it feels to them) and their safety profile.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
        *advisor.TOOLS.function_declarations,  # search_catalog, compare_products, check_routine
    ]
)


def run_tool(name: str, args: dict[str, Any], store: Store, uid: str) -> dict[str, Any]:
    """One tool call, always for `uid` (the signed-in person or the demo journey): the model's
    arguments never choose whose data is read."""
    if name in ("get_my_readings", "get_my_routine"):
        ctx = advisor.context(store, uid)
        profile = ctx["profile"]
        if name == "get_my_readings":
            return {
                "latest_sessions": ctx["latest_sessions"],
                "life_patterns": ctx["life_patterns"],
                "skin_type": profile.get("skin_type"),
                "goals": profile.get("goals"),
                "note": ctx["note"],
            }
        return {
            "routine": ctx["routine"],
            "recent_window_days": ctx["recent_window_days"],
            "safety": profile.get("safety"),
        }
    if name in ("search_catalog", "compare_products", "check_routine"):
        return advisor.run_tool(name, args, store, uid)
    return {"error": f"unknown tool {name}"}


class Guard:
    """What Wisp may say aloud: numbers from tool results or the person's own words, no banned
    words in the language spoken (product names from tool results are left out of the word
    check: a catalog name may hold a word Wisp itself must not use)."""

    def __init__(self) -> None:
        self.allowed: set[str] = set()
        self.names: set[str] = set()

    def tool_result(self, result: dict[str, Any]) -> None:
        self.allowed |= numbers.collect(result)
        # outcome rates may be spoken as percents (0.61 -> 61), as the typed Wisp allows
        rates = [v for k, v in _walk(result) if k == "measured_outcomes"]
        self.allowed |= numbers.percents(rates)
        for k, v in _walk(result):
            if k in ("products", "not_checked") and isinstance(v, list):
                for p in v:
                    if isinstance(p, dict) and p.get("name"):
                        self.names |= {str(p["name"]), f"{p.get('brand', '')} {p['name']}".strip()}

    def heard(self, text: str) -> None:
        self.allowed |= numbers.in_text(text)
        for value in spoken_numbers(text):
            self.allowed |= numbers.collect(value)

    def check(self, said: str, final: bool, lang: str | None = None) -> str | None:
        """'number', 'wording' or None. While streaming (`final` False) only the text up to the
        last space is checked, so "1" of a "12" still arriving is not read as a number."""
        text = said if final else said[: max(said.rfind(" "), 0)]
        if not text.strip():
            return None
        if not numbers.only_known(text, self.allowed):
            return "number"
        for value in spoken_numbers(text, open_end=not final):
            if not numbers.collect(value) & self.allowed:
                return "number"
        for name in sorted(self.names, key=len, reverse=True):
            text = re.sub(re.escape(name), " ", text, flags=re.I)
        code = translate.normalise(lang) if lang else translate.detect(text)
        return None if translate.clean_words(text, code) else "wording"


# English number words, so "seven" is held to the same rule as "7" (the transcript writes either).
_UNIT_WORDS = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen"
)
_TENS_WORDS = "twenty thirty forty fifty sixty seventy eighty ninety"
_UNITS = {w: i for i, w in enumerate(_UNIT_WORDS.split())}
_TENS = {w: 10 * i for i, w in enumerate(_TENS_WORDS.split(), 2)}
_TIMES = {"hundred": 100, "dozen": 12}
_WORD = (
    "(?:" + "|".join(sorted([*_UNITS, *_TENS, *_TIMES, "thousand"], key=len, reverse=True)) + r")\b"
)
# a run of number words: "twenty-one", "a hundred and five", "a dozen", "sixty one percent"
_RUN = re.compile(
    rf"\b(?:an?\s+(?=(?:hundred|thousand|dozen)\b))?{_WORD}"
    rf"(?:(?:\s+|-|(?:(?<=hundred)|(?<=thousand))\s+and\s+){_WORD})*",
    re.I,
)


def spoken_numbers(text: str, open_end: bool = False) -> list[float]:
    """The values of the English number words in `text` ("twenty-one" 21, "a dozen" 12, "one
    hundred and five" 105; "sixty percent" is 60, checked like "60%"). A lone "one" is left out:
    it is far more often a pronoun ("this one", "one of them") than a quantity. `open_end`: a run
    at the very end of a still-streaming transcript is skipped ("twenty" may yet become
    "twenty-one")."""
    values: list[float] = []
    for m in _RUN.finditer(text):
        if open_end and not text[m.end() :].strip(" -"):
            continue
        words = [
            w for w in re.findall(r"[a-z]+", m.group(0).lower()) if w not in ("a", "an", "and")
        ]
        if words == ["one"]:
            continue
        values.extend(_value(words))
    return values


def _value(words: list[str]) -> list[float]:
    """Number words to values; "two three" is two numbers (2 and 3), "twenty one" is one (21)."""
    out: list[float] = []
    total = current = 0
    last: str | None = None

    def flush() -> None:
        nonlocal total, current, last
        if last is not None:
            out.append(float(total + current))
        total = current = 0
        last = None

    for w in words:
        if w in _UNITS:
            v = _UNITS[w]
            if last in ("unit", "dozen") or (last == "tens" and v >= 10):
                flush()
            current += v
            last = "unit"
        elif w in _TENS:
            if last in ("unit", "tens", "dozen"):
                flush()
            current += _TENS[w]
            last = "tens"
        elif w == "thousand":
            total += (current or 1) * 1000
            current, last = 0, "thousand"
        else:  # hundred, dozen
            current = (current or 1) * _TIMES[w]
            last = "dozen" if w == "dozen" else "hundred"
    flush()
    return out


def _walk(obj: Any):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


_client: genai.Client | None = None


def client() -> genai.Client:
    global _client
    if _client is None:
        # Credentials passed in, so a live token is reused: without them the SDK reads ADC and
        # refreshes a token on every connect.
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        _client = genai.Client(
            vertexai=True, project=get_settings().project_id, location=LOCATION, credentials=creds
        )
    return _client


def live_config(handle: str | None = None) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=f"{INSTRUCTIONS}",
        tools=[TOOLS],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE)
            )
        ),
        session_resumption=types.SessionResumptionConfig(handle=handle),
    )


def _log(event: str, **fields: Any) -> None:
    log.info(json.dumps({"prompt_id": "voice_live", "event": event, **fields}))


Send = Callable[[dict[str, Any]], Awaitable[None]]
SendAudio = Callable[[bytes], Awaitable[None]]
# Opens a Live session (an async context manager), with a resumption handle or None.
Connect = Callable[[str | None], Any]


def vertex_connect(handle: str | None):
    return client().aio.live.connect(model=MODEL, config=live_config(handle))


class Conversation:
    """One voice session between the browser and Gemini Live, with the guards in the middle.

    `handle` is the core: every message from Gemini goes through it. Model output (audio, tool
    calls, its transcript, turn ends) waits while what the person said is being screened, and is
    dropped once a guard has cut the turn."""

    def __init__(
        self,
        store: Store,
        uid: str,
        lang: str,
        send: Send,
        send_audio: SendAudio,
        connect: Connect | None = None,
    ) -> None:
        self.store, self.uid = store, uid
        self.lang = translate.normalise(lang)
        self.send, self.send_audio = send, send_audio
        self.connect = connect or vertex_connect
        self.guard = Guard()
        self.session: Any = None
        self._cm: Any = None
        self.generation = 0  # bumped on every new Live session (a reconnect or a fresh start)
        self.ready = asyncio.Event()
        self.broken = asyncio.Event()  # the session is gone for good: run() ends the call
        self.resume: str | None = None
        self.heard = ""  # what the person said since the last screening
        self.heard_lang: str | None = None
        self.screen: asyncio.Task[bool] | None = None
        self.screening = ""
        self.held: list[tuple[str, Any]] = []
        self.releasing = False
        self.said = ""  # Wisp's transcript for the turn in progress
        self.said_lang: str | None = None
        self.cut = False  # the turn in progress was stopped by a guard: drop what is left of it
        self.correcting = False  # the turn in progress is a correction: never corrected again
        self.reset_pending = False
        self._tasks: set[asyncio.Task[Any]] = set()  # kept referenced until done
        self.asked_at: float | None = None  # when the person's turn ended (for time to audio)
        self.stats = {
            "turns": 0,
            "tool_calls": 0,
            "violations": 0,
            "refusals": 0,
            "reconnects": 0,
            "first_audio_ms": [],
            "connect_ms": [],
            "tokens": 0,
        }

    # --- the Live session ------------------------------------------------------------------
    async def open(self, handle: str | None = None) -> None:
        t0 = time.monotonic()
        self._cm = self.connect(handle)
        self.session = await self._cm.__aenter__()
        self.stats["connect_ms"].append(round((time.monotonic() - t0) * 1000))
        self.generation += 1
        self.ready.set()
        if armor.enabled() and self.generation == 1:
            # the first screening on an instance pays for auth (~1.5 s): pay it now, not mid-turn
            self._spawn(asyncio.to_thread(armor.blocked, "hello"))

    def _spawn(self, coro: Any) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def close(self) -> None:
        self.ready.clear()
        cm, self._cm, self.session = self._cm, None, None
        if cm is not None:
            with contextlib.suppress(Exception):
                await cm.__aexit__(None, None, None)

    async def say(self, text: str) -> None:
        """A turn from Willow (not the person): the greeting, a correction, a refusal."""
        if self.session is None:
            return
        await self.session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=text)]), turn_complete=True
        )

    async def greet(self) -> None:
        await self.say(GREETING.format(language=self.language))

    async def audio_in(self, pcm: bytes) -> None:
        if self.session is not None and pcm:
            await self.session.send_realtime_input(
                audio=types.Blob(data=pcm, mime_type="audio/pcm;rate=16000")
            )

    async def mic_paused(self) -> None:
        if self.session is not None:
            await self.session.send_realtime_input(audio_stream_end=True)

    # --- Gemini to the browser --------------------------------------------------------------
    async def handle(self, msg: types.LiveServerMessage) -> None:
        upd = msg.session_resumption_update
        if upd and upd.resumable and upd.new_handle:
            self.resume = upd.new_handle
        if msg.usage_metadata and msg.usage_metadata.total_token_count:
            self.stats["tokens"] = msg.usage_metadata.total_token_count
        sc = msg.server_content
        if sc and sc.input_transcription and sc.input_transcription.text:
            await self._heard(sc.input_transcription)
        if msg.tool_call:
            await self._output("tool", msg.tool_call)
        if sc is None:
            return
        if sc.interrupted:
            # the person spoke over Wisp (barge-in): Gemini stopped, so does the browser
            self.held = [h for h in self.held if h[0] not in ("audio", "said")]
            self.said, self.cut = "", False
            await self.send({"type": "interrupted"})
        for part in (sc.model_turn.parts or []) if sc.model_turn else []:
            if part.inline_data and part.inline_data.data:
                await self._output("audio", part.inline_data.data)
        if sc.output_transcription and sc.output_transcription.text:
            await self._output("said", sc.output_transcription)
        if sc.turn_complete:
            await self._output("turn_complete", None)

    async def _heard(self, tr: types.Transcription) -> None:
        text = tr.text or ""
        self.heard += text
        self.heard_lang = tr.language_code or self.heard_lang
        self.guard.heard(text)
        self.asked_at = time.monotonic()
        await self.send({"type": "caption", "role": "you", "text": text})
        if tr.finished:
            self._start_screen()

    def _start_screen(self) -> None:
        if self.screen is None and self.heard.strip():
            self.screening = self.heard
            if armor.enabled():
                self.screen = asyncio.create_task(asyncio.to_thread(armor.blocked, self.heard))
            else:
                self.screen = asyncio.create_task(_false())

    async def _output(self, kind: str, data: Any) -> None:
        if self.reset_pending:
            return  # this session is being replaced: nothing more from it reaches the person
        if kind == "tool":
            # Tools only read the person's own data for the model; they run while the question is
            # screened (off the critical path), and nothing reaches the person until it clears.
            await self._tools(data)
            return
        if self.heard.strip() or self.screen is not None or self.releasing:
            self.held.append((kind, data))
            self._start_screen()
            if not self.releasing:
                self.releasing = True
                self._spawn(self._release())
            return
        await self._emit(kind, data)

    async def _release(self) -> None:
        """Wait for the screening of what the person said, then pass the held output on in order
        (or refuse). Output arriving meanwhile joins the queue."""
        try:
            while True:
                if self.screen is not None:
                    try:
                        blocked = await asyncio.wait_for(self.screen, SCREEN_WAIT_S)
                    except Exception:  # armor itself fails open; a hung call does too
                        blocked = False
                    self.screen = None
                    self.heard = self.heard[len(self.screening) :]
                    if blocked:
                        self.held.clear()
                        self.heard = ""
                        await self._refuse()
                        return
                    self._start_screen()  # more words arrived while this was screened
                    continue
                if self.held:
                    kind, data = self.held.pop(0)
                    await self._emit(kind, data)
                    continue
                return
        finally:
            self.releasing = False

    async def _emit(self, kind: str, data: Any) -> None:
        if kind == "turn_complete":
            await self._turn_end()
            return
        if self.cut:
            return
        if kind == "audio":
            if self.asked_at is not None:
                waited = round((time.monotonic() - self.asked_at) * 1000)
                self.stats["first_audio_ms"].append(waited)
                self.asked_at = None
            await self.send_audio(data)
        elif kind == "said":
            self.said += data.text
            self.said_lang = data.language_code or self.said_lang
            await self.send({"type": "caption", "role": "wisp", "text": data.text})
            bad = self.guard.check(self.said, final=False, lang=self.said_lang)
            if bad:
                await self._correct(bad, ended=False)

    async def _turn_end(self) -> None:
        if self.said and not self.cut:
            bad = self.guard.check(self.said, final=True, lang=self.said_lang)
            if bad:
                await self._correct(bad, ended=True)
            else:
                self.correcting = False
        if self.said:
            self.stats["turns"] += 1
        self.said, self.said_lang, self.cut = "", None, False
        await self.send({"type": "turn_complete"})

    async def _tools(self, call: types.LiveServerToolCall) -> None:
        responses = []
        for fc in call.function_calls or []:
            self.stats["tool_calls"] += 1
            await self.send({"type": "tool", "name": fc.name})
            try:
                out = await asyncio.to_thread(
                    run_tool, fc.name or "", dict(fc.args or {}), self.store, self.uid
                )
            except Exception as exc:  # a store or catalog failure: say so, never guess
                log.warning("voice tool %s failed: %s", fc.name, type(exc).__name__)
                out = {"error": "not available right now: say you don't have that"}
            self.guard.tool_result(out)
            responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response=out))
        if self.session is not None and responses:
            await self.session.send_tool_response(function_responses=responses)

    async def _correct(self, kind: str, ended: bool) -> None:
        """A guard stopped Wisp: the browser drops what it has not played, and Wisp says a short
        correction (once: a correction that breaks a rule is only cut)."""
        self.stats["violations"] += 1
        _log("violation", kind=kind, during="correction" if self.correcting else "answer")
        await self.send({"type": "flush"})
        await self.send({"type": "corrected", "kind": kind})
        if not ended:
            self.cut = True
        if self.correcting:
            return
        self.correcting = True
        await self.say(CORRECT.format(line=CORRECTIONS[kind]))

    async def _refuse(self) -> None:
        """Model Armor matched what the person said: nothing of the reply is passed on, and the
        session starts afresh so the screened words are not in its context."""
        self.stats["refusals"] += 1
        _log("refused", by="model_armor")
        await self.send({"type": "flush"})
        await self.send({"type": "refused"})
        self.reset_pending = True
        await self.close()
        self.resume, self.said, self.cut, self.correcting = None, "", False, True
        try:
            try:
                await self._open_fresh()
            finally:
                self.reset_pending = False
            await self.say(REFUSE.format(language=self.language, line=armor.REFUSAL))
        except Exception as exc:
            # No session to speak with (Vertex busy, 1011): end the call now with the busy
            # message, not silence until the time cap. run() sees `broken` and returns.
            log.warning("voice live reopen after a refusal failed: %s", type(exc).__name__)
            _log("reopen_failed", after="refusal")
            self.broken.set()

    async def _open_fresh(self) -> None:
        """A new session without resumption; one more try after a moment if Vertex is busy."""
        try:
            await self.open(None)
        except Exception as exc:
            if not transient(exc):
                raise
            await self.close()
            await asyncio.sleep(REOPEN_WAIT_S)
            await self.open(None)

    @property
    def language(self) -> str:
        return translate.LANGUAGES[self.lang][1]

    def summary(self, seconds: float, reason: str) -> dict[str, Any]:
        ms = self.stats["first_audio_ms"]
        return {
            "seconds": round(seconds),
            "reason": reason,
            **{k: v for k, v in self.stats.items() if k != "first_audio_ms"},
            "first_audio_ms": ms[:8],
            "first_audio_ms_median": sorted(ms)[len(ms) // 2] if ms else None,
        }


async def _false() -> bool:
    return False


def transient(exc: BaseException) -> bool:
    """Worth a reconnect: Vertex's 1011 (busy, internal) or a dropped connection."""
    text = str(exc)
    return "1011" in text or "Resource exhausted" in text or "1006" in text or "1001" in text


async def run(conv: Conversation, browser_events: "asyncio.Queue[Any]") -> str:
    """Pump Gemini into `conv` and the browser's audio and events into Gemini until the person
    ends it, the cap is reached, or Gemini fails for good. Returns why it ended."""
    started = time.monotonic()
    said_goodbye = False

    async def upstream() -> str:
        while True:
            item = await browser_events.get()
            if item is None:
                return "closed"
            if isinstance(item, bytes):
                with contextlib.suppress(Exception):  # dropped while reconnecting
                    await conv.audio_in(item)
            elif item.get("type") == "end":
                return "ended"
            elif item.get("type") == "mute":
                with contextlib.suppress(Exception):
                    await conv.mic_paused()

    async def downstream() -> str:
        reconnects = 0
        while True:
            await conv.ready.wait()
            session, gen = conv.session, conv.generation
            try:
                while gen == conv.generation:
                    async for msg in session.receive():
                        if gen != conv.generation:
                            break  # replaced (a refusal's fresh start): read the new one
                        await conv.handle(msg)
            except Exception as exc:
                if gen != conv.generation or conv.reset_pending:
                    continue  # this session was closed on purpose
                if not transient(exc) or reconnects >= RECONNECTS:
                    log.warning("voice live failed: %s", type(exc).__name__)
                    return "gemini_error"
                reconnects += 1
                conv.stats["reconnects"] += 1
                await conv.send({"type": "reconnecting"})
                handle = conv.resume
                await conv.close()
                conv.said, conv.cut, conv.held = "", False, []
                for wait, h in ((0.4 * reconnects, handle), (1.0, None)):
                    await asyncio.sleep(wait)
                    try:
                        await conv.open(h)
                        break
                    except Exception as again:
                        if not transient(again):
                            return "gemini_error"
                else:
                    return "gemini_error"
                await conv.send({"type": "reconnected"})
                await conv.say(DROPPED)

    async def clock() -> str:
        nonlocal said_goodbye
        await asyncio.sleep(max(0.0, MAX_S - GOODBYE_BEFORE_S))
        said_goodbye = True
        await conv.send({"type": "ending", "reason": "time", "seconds": GOODBYE_BEFORE_S})
        with contextlib.suppress(Exception):
            await conv.say(GOODBYE)
        await asyncio.sleep(GOODBYE_BEFORE_S)
        return "time"

    async def broken() -> str:
        await conv.broken.wait()
        return "gemini_error"  # the route tells the browser Wisp's voice is busy

    tasks = [asyncio.create_task(c) for c in (upstream(), downstream(), clock(), broken())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    reason = next(iter(done)).result() if not next(iter(done)).exception() else "error"
    _log("end", **conv.summary(time.monotonic() - started, reason))
    return reason
