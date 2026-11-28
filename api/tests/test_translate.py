"""Willow's words in the person's language (app/translate.py): English is validated first, and a
translation is used only if it quotes exactly the same numbers and references."""

from app import translate


def test_a_translation_that_changes_a_number_keeps_the_english(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        return schema(texts=["लालिमा 3.2 से घटी", "हम 8 हफ़्ते देखेंगे"])  # 3.1 became 3.2

    monkeypatch.setattr(translate.gemini, "generate_json", fake)
    translate._cache.clear()
    got = translate.texts(["Redness fell by 3.1", "We will look for 8 weeks"], "hi")
    assert got == ["Redness fell by 3.1", "हम 8 हफ़्ते देखेंगे"]


def test_references_and_native_digits(monkeypatch):
    src = "Use [product:cerave-pm] at night; 2 weeks in"
    assert translate.same_numbers(src, "रात में [product:cerave-pm] लगाएँ; २ हफ़्ते")
    assert not translate.same_numbers(src, "रात में CeraVe लगाएँ; 2 हफ़्ते")  # reference lost


def test_english_and_unknown_languages_never_call_gemini(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("no call")

    monkeypatch.setattr(translate.gemini, "generate_json", boom)
    assert translate.texts(["Calmer skin"], "en") == ["Calmer skin"]
    assert translate.texts(["Calmer skin"], "xx") == ["Calmer skin"]
    assert translate.normalise("ja-JP") == "ja"


def test_gemini_down_keeps_the_english(monkeypatch):
    def down(*a, **k):
        raise RuntimeError("503")

    monkeypatch.setattr(translate.gemini, "generate_json", down)
    translate._cache.clear()
    assert translate.texts(["Calmer skin by 2 points"], "ja") == ["Calmer skin by 2 points"]


def test_a_translation_that_names_a_disease_keeps_the_english(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        return schema(texts=["ニキビが2つ減りました", "赤みが落ち着きました"])  # "acne" in Japanese

    monkeypatch.setattr(translate.gemini, "generate_json", fake)
    translate._cache.clear()
    got = translate.texts(["2 fewer blemishes", "Calmer redness"], "ja")
    assert got == ["2 fewer blemishes", "赤みが落ち着きました"]
