"""AI in Willow Proof (app/proof_ai.py): claim drafts and next steps, checked against the facts."""

from datetime import UTC, datetime

import pytest

from app import gemini, proof_ai, retail_intel, retailer, retailer_ask
from tests.test_retail_intel import TODAY, _facts
from tests.test_retailer_ask import INSIGHTS


def _rows(tier):
    return [r for r in retail_intel.rows(_facts()) if r["tier"] == tier]


def _view(tier="proven"):
    return retail_intel.product_view(_facts(), _rows(tier)[0]["product_id"])


@pytest.fixture
def proof(monkeypatch):
    monkeypatch.setattr(retail_intel, "facts", lambda c="mixed", r="all": (_facts(), 1, TODAY))
    monkeypatch.setattr(proof_ai, "_cache", {})


def test_sources_are_the_evidence_then_one_labelled_self_reported_line():
    view = _view()
    src = proof_ai.sources(view)
    assert [s["id"] for s in src if s["measured"]] == [e["id"] for e in view["evidence"]]
    said = [s for s in src if not s["measured"]]
    assert len(said) == 1 and said[0]["id"] == "perception"
    assert "said" in said[0]["text"] and "self-reported" in said[0]["text"]


def test_a_draft_must_cite_quote_and_word_its_sources_honestly():
    by_id = {s["id"]: s for s in proof_ai.sources(_view())}
    eff = by_id["efficacy"]["text"]
    n = eff.split("Measured in ")[1].split(" ")[0]
    pct = eff.split(": ")[1].split("%")[0]
    good = proof_ai.Draft(
        text=f"{pct}% of {n} Willow users had a visible change by week 8.", sources=["efficacy"]
    )
    assert proof_ai._draft_problem(good, by_id, 320) is None

    def problem(text, sources=("efficacy",), limit=320):
        return proof_ai._draft_problem(
            proof_ai.Draft(text=text, sources=list(sources)), by_id, limit
        )

    assert "unknown" in problem("Loved by many.", sources=())
    assert "unknown" in problem("Loved by many.", sources=("made_up",))
    assert "number" in problem(f"{pct}% of 1000 Willow users had a visible change.")
    assert "overclaim" in problem(f"Clinically proven: {pct}% of {n} users.")
    assert "overclaim" in problem(f"Works for everyone: {pct}% of {n} users.")
    assert "too long" in problem(good.text, limit=20)

    said = by_id["perception"]["text"]
    share, people = said.split(", ")[1].split("% of ")[0], said.split("% of ")[1].split(" ")[0]
    plain = f"{share}% of {people} Willow users found it working."
    assert "measurement" in problem(plain, sources=("perception",))
    ok = f"{share}% of {people} Willow users said it is working for them."
    assert problem(ok, sources=("perception",)) is None
    mixed = f"{share}% of {people} users said it works and {pct}% had a visible change."
    assert "mixes" in problem(mixed, sources=("perception", "efficacy"))
    apart = f"{pct}% of {n} Willow users had a visible change. {share}% of {people} said it works."
    assert problem(apart, sources=("perception", "efficacy")) is None


def test_claims_keep_only_checked_drafts_and_fall_back_to_the_statements(
    client, fake, proof, monkeypatch
):
    pid = _rows("proven")[0]["product_id"]
    src = {s["id"]: s for s in proof_ai.sources(_view())}
    statement = src["retention"]["text"]
    replies = iter(
        [
            proof_ai.Drafts(
                drafts=[
                    proof_ai.Draft(text="Clinically proven results.", sources=["efficacy"]),
                    proof_ai.Draft(text="Results in 3 days.", sources=["speed"]),
                    proof_ai.Draft(
                        text=statement.replace(" Simulated cohort.", ""), sources=["retention"]
                    ),
                ]
            )
        ]
    )
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: next(replies))
    res = client.post(f"/v1/retailer/products/{pid}/claims", json={"channel": "pdp"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "gemini" and len(body["drafts"]) == 1
    assert body["drafts"][0]["sources"] == ["retention"]
    assert body["caveat"] and body["blocked"] is None

    monkeypatch.setattr(gemini, "generate_json", _offline)
    day = datetime.now(UTC).date().isoformat()
    before = fake.store.usage_incr("u_test", day, "proof_claims", 0)
    down = client.post(f"/v1/retailer/products/{pid}/claims", json={"channel": "pack"}).json()
    assert down["source"] == "statements"
    assert all(d["text"] in {s["text"] for s in src.values()} for d in down["drafts"])
    assert fake.store.usage_incr("u_test", day, "proof_claims", 0) == before  # refunded

    unclear = _rows("unclear")[0]["product_id"]
    blocked = client.post(f"/v1/retailer/products/{unclear}/claims", json={}).json()
    assert blocked["drafts"] == [] and blocked["blocked"]
    assert (
        client.post(f"/v1/retailer/products/{pid}/claims", json={"channel": "tv"}).status_code
        == 422
    )
    assert client.post("/v1/retailer/products/nope/claims", json={}).status_code == 404


def _offline(*a, **k):
    raise gemini.GeminiError("offline")


def test_next_steps_come_from_the_facts_with_a_link_each():
    view = _view()
    cands = proof_ai.candidates(view)
    assert cands and [a["priority"] for a in cands] == sorted(a["priority"] for a in cands)
    for a in cands:
        assert a["link"]["section"] and a["link"]["id"] == view["product"]["product_id"]
        assert numbers_only_from(a)
    promote = next(a for a in cands if a["id"] == "promote_segment")
    assert promote["link"]["section"] == "campaigns" and promote["link"]["skin_types"]
    # nothing to promote or claim before a product is measured above non-users
    unclear = retail_intel.product_view(_facts(), _rows("unclear")[0]["product_id"])
    ids = {a["id"] for a in proof_ai.candidates(unclear)}
    assert not ids & {"promote_segment", "draft_claims"}


def numbers_only_from(action):
    from app import numbers

    allowed = numbers.collect(action["facts"]) | numbers.percents(action["facts"])
    allowed |= numbers.collect(action["title"]) | {"8"}  # "week 8" is the Proof window
    return numbers.only_known(action["why"], allowed)


def test_actions_keep_valid_picks_and_otherwise_use_the_fixed_order(proof, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    api = TestClient(app)
    view = _view()
    pid = view["product"]["product_id"]
    cands = proof_ai.candidates(view)
    rules = api.get(f"/v1/retailer/products/{pid}/actions").json()
    assert rules["source"] == "rules"
    assert [a["id"] for a in rules["actions"]] == [a["id"] for a in cands[:3]]

    first, second = cands[1], cands[0]
    picks = proof_ai.Picks(
        picks=[
            proof_ai.Pick(id=first["id"], why=f"Act now. {first['why']}"),
            proof_ai.Pick(id="make_it_up", why="Do something."),
            proof_ai.Pick(id=second["id"], why="It lifts results by 99 points."),
        ]
    )
    monkeypatch.setattr(proof_ai, "_cache", {})
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: picks)
    got = api.get(f"/v1/retailer/products/{pid}/actions").json()
    assert got["source"] == "gemini"
    assert [a["id"] for a in got["actions"]] == [first["id"]]
    assert got["actions"][0]["link"] == first["link"]
    assert api.get("/v1/retailer/products/nope/actions").status_code == 404


def test_ask_also_gets_what_users_said_labelled_self_reported(client, fake, proof, monkeypatch):
    seen = {}

    def answer(q, data):
        seen.update(data)
        return {"answer": "ok"}

    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    monkeypatch.setattr(retailer_ask, "ask", answer)
    assert (
        client.post("/v1/retailer/ask", json={"question": "what do people say?"}).status_code == 200
    )
    assert seen["perception"] and all(
        0 <= p["felt"] <= 1 and p["n"] >= 10 for p in seen["perception"]
    )
    assert "self-reported" in retailer_ask.INSTRUCTIONS
    # Proof rows unavailable: Ask still answers from its own aggregates
    monkeypatch.setattr(retail_intel, "facts", lambda *a: (_ for _ in ()).throw(RuntimeError()))
    assert proof_ai.perception_rows("mixed", "all") == []
