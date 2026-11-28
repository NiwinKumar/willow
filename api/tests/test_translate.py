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


# --- The language a question is written in (no picker: Wisp answers in kind, Nov 28) ----------


def test_each_language_is_told_from_how_the_question_is_written():
    asked = {
        "en": "Can I use this serum with my retinol at night?",
        "hi": "क्या मैं यह सीरम रात में लगा सकती हूँ?",
        "ta": "இந்த சீரத்தை இரவில் பயன்படுத்தலாமா?",
        "zh": "我晚上可以用这个精华吗？",
        "ja": "この美容液は夜に使えますか？",
        "ko": "이 세럼을 밤에 써도 되나요?",
        "th": "ใช้เซรั่มนี้ตอนกลางคืนได้ไหม",
        "vi": "Tôi có thể dùng serum này vào buổi tối không?",
        "id": "Apakah saya bisa pakai serum ini di malam hari?",
        "ms": "Boleh tak saya guna serum ini selepas mandi?",
        "tl": "Pwede ko bang gamitin ang serum na ito sa gabi?",
    }
    assert {code: translate.detect(q) for code, q in asked.items()} == {c: c for c in asked}
    assert translate.detect("Mình nên dùng gì?") == "vi"  # few marks of its own: its words


def test_a_question_that_cannot_tell_keeps_the_apps_language():
    assert translate.detect("ok", fallback="zh") == "zh"
    assert translate.detect("CeraVe PM?", fallback="hi") == "hi"
    assert translate.detect("", fallback="ta") == "ta"
    assert translate.detect("ok") == "en"


def test_english_product_names_inside_another_language_do_not_make_it_english():
    q = "क्या मैं CeraVe PM Facial Moisturizing Lotion रात में लगा सकती हूँ?"
    assert translate.detect(q) == "hi"
    assert translate.detect("这个CeraVe PM lotion适合晚上用吗") == "zh"
    assert translate.detect("Is 雪花秀 good for my redness?", fallback="zh") == "en"


def test_a_language_willow_does_not_answer_in_reads_as_english():
    assert translate.detect("Можно ли использовать эту сыворотку ночью?", fallback="hi") == "en"
    assert translate.detect("Can you answer in Hindi?") == "en"  # the word, not the language


def test_the_answer_comes_back_in_the_language_of_the_question(client, fake, monkeypatch):
    from app import advisor
    from tests.test_advisor import _fake_model

    english = {"message": "Use it at night.", "product_ids": [], "follow_up_suggestions": []}
    _fake_model(monkeypatch, [], english)

    def answer(prompt_id, contents, schema, **kw):
        if schema is translate._Out:
            return schema(texts=["晚上使用。"])
        return advisor.Reply.model_validate(english)

    monkeypatch.setattr(translate.gemini, "generate_json", answer)
    translate._cache.clear()
    ask = {"messages": [{"role": "user", "text": "我晚上可以用吗？"}]}
    # the question's language wins over the app's (X-Willow-Lang)
    res = client.post("/v1/advisor/chat", json=ask, headers={"X-Willow-Lang": "hi"})
    assert res.status_code == 200, res.text
    assert res.json()["lang"] == "zh" and res.json()["message"] == "晚上使用。"
    ask = {"messages": [{"role": "user", "text": "Can I use it at night?"}]}
    res = client.post("/v1/advisor/chat", json=ask, headers={"X-Willow-Lang": "zh"})
    assert "lang" not in res.json() and res.json()["message"] == "Use it at night."
