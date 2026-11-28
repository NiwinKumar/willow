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


def test_every_glossary_word_passes_the_languages_own_word_check():
    for lang in translate.LANGUAGES:
        got = translate.labels(lang)
        if lang == "en":
            assert got is None
            continue
        assert set(got["metrics"]) == set(translate.METRIC_ORDER)
        assert set(got["ui"]) == set(translate.UI_ORDER)
        for group in got.values():
            for key, word in group.items():
                assert word.strip() and translate.clean_words(word, lang), (lang, key, word)
                assert not translate.stray_english(word), (lang, key, word)


def test_an_english_measurement_name_left_in_a_translation_is_put_into_the_language(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        assert "redness = 泛红" in kw["instructions"]  # the glossary is told to the translator
        return schema(
            texts=["你的redness读数下降了 2 点，[metric:redness] 也是", "CeraVe Glow 精华"]
        )

    monkeypatch.setattr(translate.gemini, "generate_json", fake)
    translate._cache.clear()
    got = translate.texts(
        ["Your redness reading fell by 2 points, [metric:redness] too", "CeraVe Glow serum"], "zh"
    )
    assert got[0] == "你的泛红读数下降了 2 点，[metric:redness] 也是"
    assert not translate.stray_english(got[0])
    assert got[1] == "CeraVe Glow 精华"  # a product's own name is left as it is written


def test_a_translated_answer_carries_its_labels_pairings_and_translated_names(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        return schema(texts=["你的 [metric:redness] 稳定", "下一步？", "两者同晚使用", "隔晚使用"])

    monkeypatch.setattr(translate.gemini, "generate_json", fake)
    translate._cache.clear()
    reply = {
        "message": "Your redness is steady",
        "blocks": [{"type": "answer", "text": "Your [metric:redness] is steady"}],
        "follow_up_suggestions": ["What next?"],
        "pairings": {"p1": {"issue": "Both on one night", "suggestion": "Alternate", "with": []}},
        "products": [],
    }
    out = translate.wisp_reply(reply, "zh")
    assert out["lang"] == "zh" and out["message"] == "你的 泛红 稳定"
    assert out["labels"]["metrics"]["redness"] == "泛红"
    assert out["labels"]["ui"]["not_compared"] == "无法比较"
    assert out["pairings"]["p1"] == {"issue": "两者同晚使用", "suggestion": "隔晚使用", "with": []}


def test_an_answer_whose_translation_failed_stays_english_throughout(monkeypatch):
    def down(*a, **k):
        raise RuntimeError("503")

    monkeypatch.setattr(translate.gemini, "generate_json", down)
    translate._cache.clear()
    reply = {"message": "Steady", "blocks": [{"type": "answer", "text": "Steady by 2"}]}
    assert translate.wisp_reply(reply, "zh") is reply  # no lang, no labels: one language
