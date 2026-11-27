"""Past reactions (finals F1): ingredients the person reacted to, their note and Willow's reading
of it (app/safety_note.py), the public rule families, the in-aisle routine preview, Wisp's
market preference and the reminder that names the tracked places."""

from app import advisor, gemini, reminders, safety, safety_note

NOTE = (
    "Fragrance and tea tree oil made my cheeks sting. Fine with niacinamide, but lanolin creams "
    "broke me out."
)


def test_reacted_ingredients_are_cleaned_and_flag_a_label_that_lists_them(client, fake):
    body = {"avoid_ingredients": ["  lanolin ", "Lanolin", "Linalool"], "note": "  hi  "}
    saved = client.put("/v1/me/profile", json={"safety": body}).json()["profile"]["safety"]
    assert saved["avoid_ingredients"] == ["lanolin", "Linalool"] and saved["note"] == "hi"
    bad = client.put("/v1/me/profile", json={"safety": {"avoid_ingredients": ["<script>"]}})
    assert bad.status_code == 422
    long = client.put("/v1/me/profile", json={"safety": {"note": "x" * 501}})
    assert long.status_code == 422

    cream = {"product_id": "c", "inci": ["Aqua", "Lanolin Alcohol", "Cetyl Alcohol"]}
    [flag] = safety.flags(cream, {"avoid_ingredients": ["lanolin"]})
    assert flag["level"] == "avoid" and flag["title"] == "You've reacted to lanolin"
    assert "Lanolin Alcohol" in flag["detail"]
    assert safety.check(cream, {"avoid_ingredients": ["lanolin"]})["status"] == "avoid"
    # a word inside another name is not that ingredient: "alcohol" is not "Cetyl Alcohol"
    assert safety.flags(cream, {"avoid_ingredients": ["alcohol"]}) == []


def test_the_keyword_reading_skips_what_the_note_says_is_fine():
    out = safety_note.keyword_read(NOTE)
    s = out["suggest"]
    assert out["source"] == "rules" and s["reactive"] is True and s["life_stage"] is None
    assert s["avoid"] == ["fragrance", "essential_oils", "lanolin"]
    assert "Lanolin" in s["avoid_ingredients"] and "Niacinamide" not in s["avoid_ingredients"]
    assert all(safety.in_vocabulary(n) for n in s["avoid_ingredients"])


def _model(monkeypatch, **answer):
    base = {"avoid": [], "avoid_ingredients": [], "reactive": None, "life_stage": None}
    reply = safety_note.NoteRead.model_validate(
        {**base, "summary": "Your note mentions lanolin.", **answer}
    )
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: reply)


def test_a_valid_model_reading_is_shown(client, fake, monkeypatch):
    _model(monkeypatch, avoid=["fragrance"], avoid_ingredients=["Lanolin"], reactive=True)
    out = client.post("/v1/safety/note/read", json={"note": NOTE}).json()
    assert out["source"] == "model" and out["suggest"]["avoid_ingredients"] == ["Lanolin"]
    assert out["summary"] == "Your note mentions lanolin."


def test_invented_ingredients_enum_values_and_words_fall_back_to_the_keywords(
    client, fake, monkeypatch
):
    bad_answers = [
        {"avoid_ingredients": ["Unicorn Extract"]},  # on no label
        {"avoid_ingredients": ["Dimethicone"]},  # on labels, but the note never mentions it
        {"avoid": ["gluten"]},
        {"life_stage": "pregnant"},  # the note does not say so
        {"life_stage": "teenager"},
        {"summary": "Your note suggests eczema."},
        {"summary": "Lanolin is safe for 3 days."},
    ]
    for answer in bad_answers:
        _model(monkeypatch, **answer)
        out = client.post("/v1/safety/note/read", json={"note": NOTE}).json()
        assert out["source"] == "rules", answer
        assert out == safety_note.keyword_read(NOTE)


def test_gemini_down_reads_by_keywords_and_gives_the_use_back(client, fake):
    # tests run offline: generate_json raises
    out = client.post("/v1/safety/note/read", json={"note": NOTE}).json()
    assert out["source"] == "rules" and "model_failed" not in out
    assert client.get("/v1/me/usage").json()["label_scan"]["used"] == 0
    assert client.post("/v1/safety/note/read", json={"note": "   "}).status_code == 422


def test_the_rule_families_are_public_sourced_and_hold_no_person_data(client, fake):
    out = client.get("/v1/safety/rules").json()
    assert out["rules"] == len(safety.rules())
    for fam in out["families"]:
        assert fam["label"] and fam["applies"] and fam["sources"] and fam["grades"]
        assert set(fam["grades"]) <= {"A", "B", "C"}
    names = client.get("/v1/safety/ingredients").json()["names"]
    assert "Niacinamide" in names and "Linalool" in names


def _add(client, pid, slots):
    assert client.post("/v1/routine", json={"product_id": pid, "slots": slots}).status_code == 200


def test_the_in_aisle_preview_shows_only_what_the_new_product_brings(client, fake):
    _add(client, "cerave-resurfacing-retinol-serum", ["pm"])
    _add(client, "cerave-am-facial-moisturizing-lotion-spf-30", ["am"])
    acid = client.post(
        "/v1/routine/check/preview",
        json={"product_id": "the-ordinary-glycolic-acid-7-exfoliating-toner", "slots": ["pm"]},
    ).json()
    [clash] = acid["clashes"]
    assert "retinoid" in clash["issue"] and clash["with"] == ["CeraVe Resurfacing Retinol Serum"]
    assert acid["gaps"] == [] and acid["routine_size"] == 2
    serum = client.post(
        "/v1/routine/check/preview", json={"product_id": "the-ordinary-niacinamide-10-zinc-1"}
    ).json()
    assert serum["clashes"] == []
    assert [a["active"] for a in serum["already_use"]] == ["niacinamide"]
    same = client.post(
        "/v1/routine/check/preview", json={"product_id": "cerave-resurfacing-retinol-serum"}
    ).json()
    assert same["in_routine"] and same["already_use"] == [] and same["clashes"] == []


def test_wisp_sees_the_note_trimmed_and_searches_the_persons_market_first(fake):
    note = "Lanolin broke me out. " + "word " * 100
    fake.store.user_merge(
        "u1",
        {"profile": {"safety": {"market": "IN", "note": note, "avoid_ingredients": ["Lanolin"]}}},
    )
    ctx = advisor.context(fake.store, "u1")["profile"]
    assert "note" not in ctx["safety"] and ctx["safety"]["avoid_ingredients"] == ["Lanolin"]
    assert ctx["past_reactions_note"].startswith("Lanolin broke me out.")
    assert len(ctx["past_reactions_note"]) <= advisor.NOTE_IN_CONTEXT + 1
    found = advisor.run_tool("search_catalog", {"query": "serum"}, fake.store, "u1")["products"]
    here = [p["sold_here"] for p in found]
    assert here and here[0] and here == sorted(here, reverse=True)


def test_the_reminder_names_the_places_the_person_tracks():
    face_and_cheek = reminders.places_of({"track": ["face_full", "cheek_macro"]}, test_running=True)
    assert face_and_cheek == ["cheek_macro", "face_full", "arms"]
    body = reminders.payload("checkin", face_and_cheek)["body"]
    assert body.startswith("Time for your cheek close-up, face and both arms,")
    # never chose: the app's default (the face only when a goal needs it)
    assert reminders.places_of({"goals": ["lines"]}) == ["cheek_macro", "face_full"]
    assert "face" not in reminders.payload("checkin", reminders.places_of({}))["body"]
