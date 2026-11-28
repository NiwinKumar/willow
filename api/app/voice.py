"""Talk to Wisp (finals B2, Nov 28): Gemini hears the question and speaks the checked answer.

Gemini Live would speak while it thinks, so a number could be said before any check. Willow
keeps the order its other answers have: Gemini transcribes the spoken question (any language,
`hear`), Wisp answers it through the same pipeline as typed questions (number and wording
validators in English, then translation with its own checks, app/translate.py), and only that
checked text is spoken (`speak`, Gemini TTS). Every number Wisp says aloud was checked first.
Audio is never stored: it is read and dropped in the request.
"""

import base64
import io
import logging
import wave

from google.genai import types
from pydantic import BaseModel, Field

from app import explain, gemini, translate
from app.settings import get_settings

log = logging.getLogger("willow.voice")

MAX_AUDIO_BYTES = 2_500_000  # about 60 s of compressed speech
MAX_SPEAK_CHARS = 900
VOICE = "Achernar"  # the narration's voice: calm, clear
HEAR_INSTRUCTIONS = (
    "Transcribe the person's spoken question to Willow, a skincare app, exactly as said, in the "
    "language they spoke (do not translate). Keep product names, brand names and numbers as said. "
    "`language`: the ISO 639-1 code of the language spoken. If there is no speech, return empty "
    "text."
)


class Heard(BaseModel):
    text: str = Field(max_length=1000, description="the question as spoken")
    language: str = Field(max_length=8, description="ISO 639-1 code of the spoken language")


class VoiceError(Exception):
    """The speech could not be read or spoken; the caller answers 422 or 502."""


def hear(audio: bytes, mime_type: str) -> dict[str, str]:
    """The spoken question as text and its language (normalised to Willow's list; English when
    the language is not one Willow answers in)."""
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError("That recording is empty or too long. Keep questions under a minute.")
    try:
        out = gemini.generate_json(
            "voice_hear",
            [types.Part.from_bytes(data=audio, mime_type=mime_type), "Transcribe this question."],
            Heard,
            instructions=HEAR_INSTRUCTIONS,
            timeout_ms=15_000,
        )
    except Exception as exc:  # Gemini down or slow
        log.warning("voice hear failed: %s", type(exc).__name__)
        raise VoiceError("Wisp couldn't hear that just now. Try again, or type it.") from exc
    return {"text": out.text.strip(), "lang": translate.normalise(out.language)}


def _wav(pcm: bytes, rate: int = 24_000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def speak(text: str, lang: str) -> bytes:
    """A WAV of `text` read aloud. Only text that passes Willow's wording checks is spoken (the
    app sends Wisp's already-validated answer; this stops anything else being voiced)."""
    text = " ".join(text.split())[:MAX_SPEAK_CHARS]
    lang = translate.normalise(lang)
    if not text:
        raise VoiceError("Nothing to read aloud.")
    if explain.BANNED.search(text) or not translate.clean_words(text, lang):
        raise VoiceError("This answer can't be read aloud.")
    model = get_settings().gemini_tts_model
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE)
            )
        ),
        http_options=types.HttpOptions(timeout=25_000),
    )
    prompt = f"Read this calmly and warmly, like a friend who knows skincare:\n\n{text}"
    try:
        res = gemini.client().models.generate_content(model=model, contents=prompt, config=config)
        data = res.candidates[0].content.parts[0].inline_data
    except Exception as exc:
        log.warning("voice speak failed: %s", type(exc).__name__)
        raise VoiceError("Wisp couldn't read this aloud just now.") from exc
    rate = 24_000
    for part in (data.mime_type or "").split(";"):
        if part.strip().startswith("rate="):
            rate = int(part.strip()[5:])
    return _wav(data.data, rate)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()
