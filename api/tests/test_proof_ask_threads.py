"""Proof by Willow, finals P1: Ask conversations per person and org (follow-ups get the last turns
as context, numbers still checked against the aggregates only), Ask scoped to the org, starter
questions per org kind, brand logos and the demo instance's name."""

import pytest
from fastapi.testclient import TestClient

from app import brand_logos, gemini, retail_intel, retailer, retailer_ask
from app.main import app
from app.retailer_ask import Answer
from app.routes import proof_routes

MINIMALIST = "minimalist-alpha-arbutin-2-face-serum"
MINIMALIST_NAME = "Alpha Arbutin 2% Face Serum"
NIACINAMIDE = "minimalist-niacinamide-10-face-serum"
ORDINARY = "the-ordinary-alpha-arbutin-2-ha"
ORDINARY_NAME = "Alpha Arbutin 2% + HA"

INSIGHTS = {
    "cohort": {"synthetic": 500, "real": 0, "weeks": 8},
    "tiles": [],
    "needs": [
        {"goal": "Dark spots", "n": 100, "real": 24, "none": 61, "early": 15},
        {"goal": "Dryness", "n": 80, "real": 30, "none": 50, "early": 20},
    ],
    "products": [],
    "product_outcomes": {
        MINIMALIST: {
            "product": MINIMALIST_NAME,
            "brand": "Minimalist",
            "concern": "dark spots",
            "category": "serum",
            "n": 40,
            "rate": 0.61,
            "weeks": 6,
            "cont": 0.77,
        },
        NIACINAMIDE: {
            "product": "Niacinamide 10% Face Serum",
            "brand": "Minimalist",
            "concern": "oiliness",
            "category": "serum",
            "n": 90,
            "rate": 0.5,
            "weeks": 5,
            "cont": 0.6,
        },
        ORDINARY: {
            "product": ORDINARY_NAME,
            "brand": "The Ordinary",
            "concern": "dark spots",
            "category": "serum",
            "n": 30,
            "rate": 0.5,
            "weeks": 7,
            "cont": 0.5,
        },
    },
    "brands": [{"brand": "The Ordinary", "n": 30}, {"brand": "Minimalist", "n": 40}],
    "categories": [
        {"category": "serum", "label": "Serums", "flows": [{"n": 70}], "brands": []},
        {"category": "sunscreen", "label": "Sunscreens", "flows": [{"n": 20}], "brands": []},
    ],
    "gaps": [
        {"goal": "Dark spots", "action": "Covered in every tier."},
        {"goal": "Dryness", "action": "Add a budget option for dryness."},
    ],
    "conflicts": [],
}


@pytest.fixture(autouse=True)
def fresh_answers():
    proof_routes._answers.clear()
    yield
    proof_routes._answers.clear()


@pytest.fixture
def gemini_says(monkeypatch):
    """Gemini answers with the scripted texts in turn and records each prompt it was given."""
    seen: list[str] = []
    script: list[str] = []

    def gen(*a, **k):
        seen.append(a[1][0])
        return Answer(answer=script.pop(0) if script else f"{MINIMALIST_NAME} reached 61%.")

    monkeypatch.setattr(gemini, "generate_json", gen)
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    return seen, script


def _as(uid: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": uid})


def _join(c: TestClient, org: str, role: str = "viewer") -> None:
    res = c.post("/v1/proof/join", json={"instance": "northside", "org_id": org, "role": role})
    assert res.status_code == 200, res.text


def _ask(c: TestClient, org: str, q: str, thread_id: str | None = None) -> dict:
    body = {"question": q, **({"thread_id": thread_id} if thread_id else {})}
    res = c.post(f"/v1/proof/orgs/{org}/ask", json=body)
    assert res.status_code == 200, res.text
    return res.json()


# -- conversations ------------------------------------------------------------------------------


def test_a_conversation_keeps_turns_and_a_follow_up_gets_the_last_ones(client, fake, gemini_says):
    seen, script = gemini_says
    script += [f"{MINIMALIST_NAME} reached 61% for dark spots.", "Dryness: 30% saw a change."]
    _join(client, "minimalist")
    first = _ask(client, "minimalist", f"How is {MINIMALIST_NAME} doing for dark spots?")
    tid = first["thread_id"]
    assert tid.startswith("t_") and "QUESTION: How is Alpha" in seen[0]
    # a product name with a digit in the question does not stop the answer from naming it
    assert first["refused"] is False
    assert "EARLIER IN THIS CONVERSATION" not in seen[0]

    second = _ask(client, "minimalist", "And for dry skin?", tid)
    assert second["thread_id"] == tid and second["refused"] is False
    # the follow-up saw the earlier question and answer as context
    assert f"Q: How is {MINIMALIST_NAME}" in seen[1] and "A: Alpha Arbutin 2% Face" in seen[1]

    listed = client.get("/v1/proof/orgs/minimalist/ask/threads").json()
    assert listed == [
        {
            "id": tid,
            "title": f"How is {MINIMALIST_NAME} doing for dark spots?",
            "updated_at": listed[0]["updated_at"],
            "turns": 2,
        }
    ]
    full = client.get(f"/v1/proof/orgs/minimalist/ask/threads/{tid}").json()
    assert [t["q"] for t in full["turns"]] == [
        f"How is {MINIMALIST_NAME} doing for dark spots?",
        "And for dry skin?",
    ]
    assert full["turns"][1]["answer"]["answer"] == "Dryness: 30% saw a change."
    assert full["turns"][1]["answer"]["scope"] == {"brand": "Minimalist", "names_hidden": True}

    assert client.delete(f"/v1/proof/orgs/minimalist/ask/threads/{tid}").status_code == 204
    assert client.get("/v1/proof/orgs/minimalist/ask/threads").json() == []


def test_a_conversation_is_private_to_its_person_and_org(client, fake, gemini_says):
    _join(client, "minimalist")
    tid = _ask(client, "minimalist", "How is our arbutin serum doing?")["thread_id"]
    other = _as("someone-else")
    _join(other, "minimalist")
    url = f"/v1/proof/orgs/minimalist/ask/threads/{tid}"
    assert other.get(url).status_code == 404
    assert other.delete(url).status_code == 404
    body = {"question": "And for dry skin?", "thread_id": tid}
    assert other.post("/v1/proof/orgs/minimalist/ask", json=body).status_code == 404
    assert other.get("/v1/proof/orgs/minimalist/ask/threads").json() == []
    # the same person in another org does not see it either
    _join(client, "northside")
    assert client.get(f"/v1/proof/orgs/northside/ask/threads/{tid}").status_code == 404
    # and a non-member gets 403
    stranger = _as("stranger")
    assert stranger.get("/v1/proof/orgs/minimalist/ask/threads").status_code == 403


def test_only_the_newest_threads_and_turns_are_kept(client, fake, gemini_says, monkeypatch):
    monkeypatch.setattr(proof_routes, "MAX_THREADS", 2)
    monkeypatch.setattr(proof_routes, "MAX_TURNS", 3)
    _join(client, "minimalist")
    ids = [_ask(client, "minimalist", f"Question number {w}?")["thread_id"] for w in "abc"]
    listed = client.get("/v1/proof/orgs/minimalist/ask/threads").json()
    assert [t["id"] for t in listed] == [ids[2], ids[1]]  # the oldest went
    for q in ("one?", "two?", "three?"):
        _ask(client, "minimalist", f"Follow-up {q}", ids[2])
    full = client.get(f"/v1/proof/orgs/minimalist/ask/threads/{ids[2]}").json()
    assert [t["q"] for t in full["turns"]] == [
        "Follow-up one?",
        "Follow-up two?",
        "Follow-up three?",
    ]
    assert len(proof_routes._title("word " * 40)) <= proof_routes.TITLE_CHARS + 1


def test_follow_up_numbers_are_checked_against_the_aggregates_not_earlier_answers(monkeypatch):
    prompts: list[str] = []

    def gen(*a, **k):
        prompts.append(a[1][0])
        return Answer(answer="Still 99%, as before.")

    monkeypatch.setattr(gemini, "generate_json", gen)
    # 99% is only in an earlier answer, never in the aggregates: rejected twice, then refused
    history = [("How is it?", "It reached 99%.")]
    out = retailer_ask.ask("And now?", INSIGHTS, history=history)
    assert out["refused"] is True and len(prompts) == 2
    # the question's own percent still can't be echoed, even when the data has it
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: Answer(answer="It is 61%."))
    assert retailer_ask.ask("Is it 61%?", INSIGHTS, history=history)["refused"] is True
    assert retailer_ask.ask("How is it?", INSIGHTS, history=history)["refused"] is False


# -- scoped to the org --------------------------------------------------------------------------


def test_a_brand_follow_up_never_shows_gemini_another_brands_name(client, fake, gemini_says):
    seen, script = gemini_says
    _join(client, "minimalist")
    q = f"How do we compare with The Ordinary {ORDINARY_NAME}?"
    tid = _ask(client, "minimalist", q)["thread_id"]
    _ask(client, "minimalist", "And for dry skin?", tid)
    # neither the aggregates nor the earlier question (in the follow-up) carry The Ordinary's
    # real names; the brand's own product keeps its name
    for prompt in seen:
        context = prompt.partition("QUESTION:")[0]
        assert "The Ordinary" not in context and ORDINARY_NAME not in context
        assert MINIMALIST_NAME in context
    assert "Q: How do we compare with Brand " in seen[1]


def test_the_retailer_sees_every_brand_by_name(client, fake, gemini_says):
    seen, _ = gemini_says
    _join(client, "northside")
    out = _ask(client, "northside", "Which arbutin serum does best?")
    assert out["scope"] == {"brand": None, "names_hidden": False}
    assert "The Ordinary" in seen[0] and "Minimalist" in seen[0]


# -- starter questions ----------------------------------------------------------------------------


def test_starter_questions_per_org_kind(client, fake, monkeypatch):
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    _join(client, "minimalist")
    brand = client.get("/v1/proof/orgs/minimalist/ask/suggestions").json()
    assert brand["kind"] == "brand" and len(brand["suggestions"]) == 4
    # its own products, most used first; never another brand
    assert "Niacinamide 10% Face Serum" in brand["suggestions"][0]
    assert MINIMALIST_NAME in brand["suggestions"][3]
    assert not any("Ordinary" in s or ORDINARY_NAME in s for s in brand["suggestions"])

    _join(client, "northside")
    shop = client.get("/v1/proof/orgs/northside/ask/suggestions").json()
    assert shop["kind"] == "retailer" and len(shop["suggestions"]) == 4
    assert "serums" in shop["suggestions"][0] and "dark spots" in shop["suggestions"][0]
    assert "dryness" in shop["suggestions"][1]  # the first goal that is not covered

    # no data: still four, without names
    def offline(*a):
        raise RuntimeError("BigQuery down")

    monkeypatch.setattr(retailer, "insights", offline)
    generic = client.get("/v1/proof/orgs/minimalist/ask/suggestions").json()["suggestions"]
    assert len(generic) == 4 and all("Minimalist" in s for s in generic)
    assert _as("stranger").get("/v1/proof/orgs/minimalist/ask/suggestions").status_code == 403


# -- logos and the demo instance ------------------------------------------------------------------


def test_brand_logos_reach_the_catalog_the_orgs_and_the_brand_list(client, fake, monkeypatch):
    seed = {"Minimalist": {"logo_url": "https://beminimalist.co/icon.png", "kind": "icon"}}
    monkeypatch.setattr(brand_logos, "_seed", lambda: seed)
    res = TestClient(app).get("/v1/catalog/brand-logos")  # public: no sign-in
    assert res.status_code == 200
    assert res.json() == {"logos": {"Minimalist": "https://beminimalist.co/icon.png"}}

    orgs = {o["id"]: o for o in client.get("/v1/proof/instance?slug=northside").json()["orgs"]}
    assert orgs["minimalist"]["logo_url"] == "https://beminimalist.co/icon.png"
    assert orgs["the-derma-co"]["logo_url"] is None and orgs["northside"]["logo_url"] is None

    rows = [{"brand": "Minimalist", "n": 40}, {"brand": "The Ordinary", "n": 30}]
    monkeypatch.setattr(retail_intel, "brands_list", lambda *a: {"brands": rows, "note": ""})
    listed = client.get("/v1/retailer/brands").json()["brands"]
    assert [r["logo_url"] for r in listed] == ["https://beminimalist.co/icon.png", None]
    assert "logo_url" not in rows[0]  # the cached view is not changed


def test_the_fallback_instance_reads_as_a_demo():
    inst = TestClient(app).get("/v1/proof/instance?host=unknown.example").json()["instance"]
    assert inst["id"] == "willow" and inst["name"] == "Proof demo"
    assert inst["label"] == "Demo catalog · every brand"
    northside = TestClient(app).get("/v1/proof/instance?slug=northside").json()["instance"]
    assert northside["name"] == "Northside Beauty" and northside["label"] is None


def test_a_campaign_question_reads_the_askers_own_campaigns_and_is_not_shared(
    gemini_says, monkeypatch
):
    from app.routes import retailer_routes

    calls: list[tuple] = []
    real = retailer_routes._ask_inputs

    def spy(cohort, range_, store=None, uid=None, org_id=None):
        calls.append((uid, org_id))
        return real(cohort, range_, store, uid, org_id)

    monkeypatch.setattr(retailer_routes, "_ask_inputs", spy)
    a, b = _as("ask-camp-a"), _as("ask-camp-b")
    _join(a, "minimalist")
    _join(b, "minimalist")
    _ask(a, "minimalist", "How did our last campaign do?")
    _ask(b, "minimalist", "How did our last campaign do?")
    assert calls == [("ask-camp-a", "minimalist"), ("ask-camp-b", "minimalist")]
