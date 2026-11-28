"""Talk to Wisp (app/voice.py): Gemini hears the question; only checked words are read aloud."""

import pytest

from app import voice


def test_only_checked_words_are_read_aloud(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("no TTS call for a refused text")

    monkeypatch.setattr(voice.gemini, "client", boom)
    with pytest.raises(voice.VoiceError):
        voice.speak("This serum will cure your acne.", "en")
    with pytest.raises(voice.VoiceError):
        voice.speak("ニキビが減りました", "ja")  # "acne" in Japanese


def test_a_recording_too_long_is_refused_before_gemini(monkeypatch):
    monkeypatch.setattr(voice.gemini, "generate_json", lambda *a, **k: 1 / 0)
    with pytest.raises(voice.VoiceError):
        voice.hear(b"x" * (voice.MAX_AUDIO_BYTES + 1), "audio/webm")


def test_hear_returns_the_text_and_a_language_willow_answers_in(monkeypatch):
    monkeypatch.setattr(
        voice.gemini,
        "generate_json",
        lambda *a, **k: voice.Heard(text=" Is my serum working? ", language="sw"),
    )
    assert voice.hear(b"audio", "audio/webm") == {"text": "Is my serum working?", "lang": "en"}


def test_the_routes_count_on_the_voice_cap(client, monkeypatch):
    monkeypatch.setattr(voice, "speak", lambda text, lang: b"RIFF")
    res = client.post("/v1/advisor/voice/speak", json={"text": "Calmer redness."})
    assert res.status_code == 200 and res.json()["mime_type"] == "audio/wav"
    bad = client.post(
        "/v1/advisor/voice/hear", json={"audio_base64": "@@", "mime_type": "audio/webm"}
    )
    assert bad.status_code == 422
