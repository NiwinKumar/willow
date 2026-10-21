import pytest

from app import survey, survey_sheet
from app.store import MemoryStore, get_store


@pytest.fixture
def store():
    from app.main import app

    s = MemoryStore()
    app.dependency_overrides[get_store] = lambda: s
    survey._seen.clear()
    yield s
    app.dependency_overrides.pop(get_store, None)


ANSWERS = {
    "age": "25_34",
    "products_yesterday": "3_4",
    "goals": ["redness", "dark_spots"],
    "bought_3m": "2_3",
    "where_buy": ["multi_brand", "quick"],
    "last_sure": "slightly",
    "story": "  Spent a lot on a serum and could not tell.  ",
    "useful": "very",
    "pilot": "yes",
    "country": "IN",
}


def body(**kw):
    return {"version": "v1", "answers": ANSWERS, "duration_s": 210, "source": "wa", **kw}


def test_a_response_is_kept_with_ids_and_trimmed_text(client, store):
    res = client.post("/v1/survey", json=body())
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    doc = store.survey[rid]
    assert doc["answers"]["goals"] == ["redness", "dark_spots"]
    assert doc["answers"]["story"] == "Spent a lot on a serum and could not tell."
    assert doc["source"] == "wa" and doc["suspect"] == [] and doc["has_contact"] is False
    assert store.survey_contacts == {}


def test_an_email_goes_to_its_own_list_only_with_consent(client, store):
    no_consent = client.post("/v1/survey", json=body(email="a@b.co"))
    assert no_consent.status_code == 422
    bad = client.post("/v1/survey", json=body(email="not-an-email", email_consent=True))
    assert bad.status_code == 422
    res = client.post("/v1/survey", json=body(email=" Mei@Example.com ", email_consent=True))
    assert res.status_code == 201
    rid = res.json()["id"]
    contact = store.survey_contacts[rid]
    assert contact["email"] == "mei@example.com" and contact["pilot"] == "yes"
    assert "email" not in store.survey[rid]["answers"]


@pytest.mark.parametrize(
    "answers",
    [
        {"made_up": "x"},
        {"age": "17"},
        {"goals": ["redness", "lines", "oil", "texture"]},  # more than 3
        {"goals": ["none", "redness"]},  # "nothing in particular" goes alone
        {"country": "India"},
        {"idea": "seen"},  # the info screen holds no answer
    ],
)
def test_answers_the_survey_does_not_have_are_refused(client, store, answers):
    assert client.post("/v1/survey", json=body(answers=answers)).status_code == 422
    assert store.survey == {}


def test_under_18_answers_are_never_kept(client, store):
    res = client.post("/v1/survey", json=body(answers={"age": "under_18"}))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "under_18"
    assert store.survey == {}


def test_a_filled_honeypot_is_dropped_quietly(client, store):
    res = client.post("/v1/survey", json=body(website="http://spam"))
    assert res.status_code == 201 and store.survey == {}


def test_a_very_fast_full_response_is_kept_but_marked(client, store):
    rid = client.post("/v1/survey", json=body(duration_s=9)).json()["id"]
    assert store.survey[rid]["suspect"] == ["fast"]
    quick_no = body(answers={"age": "18_24", "products_yesterday": "0"}, duration_s=6)
    rid2 = client.post("/v1/survey", json={**quick_no, "screened_out": "no_routine"}).json()["id"]
    assert (
        store.survey[rid2]["suspect"] == [] and store.survey[rid2]["screened_out"] == "no_routine"
    )


def test_one_address_is_capped_per_day(client, store):
    codes = [
        client.post("/v1/survey", json=body()).status_code for _ in range(survey.PER_ADDRESS + 1)
    ]
    assert codes[:-1] == [201] * survey.PER_ADDRESS and codes[-1] == 429


def test_the_sheet_gets_readable_labels_in_a_fixed_column_order(client, store, monkeypatch):
    sent: list[tuple[str, list[str], list[list[str]]]] = []
    monkeypatch.setattr(survey_sheet, "enabled", lambda: True)
    monkeypatch.setattr(survey_sheet, "append", lambda tab, h, rows: sent.append((tab, h, rows)))
    rid = client.post("/v1/survey", json=body(email="m@ex.io", email_consent=True)).json()["id"]
    assert store.survey[rid]["sheet_synced"] is True
    (tab, header, [row]), (ctab, _, [crow]) = sent
    assert tab == "Responses" and ctab == "Contacts"
    cell = dict(zip(header, row, strict=True))
    assert cell["goals"] == "Redness; Dark spots or uneven-looking tone"
    assert cell["useful"] == "Very useful" and cell["first_try"] == ""
    assert "email" not in header and "m@ex.io" not in row
    assert crow[2] == "m@ex.io" and crow[3] == "Yes, count me in"


def test_a_failed_sheet_copy_never_fails_the_response(client, store, monkeypatch):
    monkeypatch.setattr(survey_sheet, "enabled", lambda: True)

    def down(*a, **k):
        raise RuntimeError("sheets down")

    monkeypatch.setattr(survey_sheet, "append", down)
    res = client.post("/v1/survey", json=body())
    assert res.status_code == 201
    assert store.survey[res.json()["id"]]["sheet_synced"] is False


def test_every_question_has_unique_ids_and_known_kinds():
    qs = survey.definition()["questions"]
    assert len({q["id"] for q in qs}) == len(qs)
    parts = {p["id"] for p in survey.definition()["parts"]}
    for q in qs:
        assert q["kind"] in {"single", "scale", "multi", "text", "info", "email", "country"}
        assert q["part"] in parts
        ids = [o["id"] for o in q.get("options", [])]
        assert len(set(ids)) == len(ids)
