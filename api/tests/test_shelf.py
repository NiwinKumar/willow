"""Shelf vs results (app/shelf.py, app/shelf_agent.py, /v1/retailer/shelf): share of use (or the
retailer's uploaded stock) against share of results, and the flags Gemini writes, checked."""

from datetime import date
from functools import lru_cache

import pytest

from app import cohort, retailer, shelf, shelf_agent


def _row(pid, cat, users, n, rate, tier="unclear"):
    return {
        "product_id": pid,
        "product": pid,
        "brand": "B",
        "category": cat,
        "users": users,
        "n": n,
        "rate": rate,
        "tier": tier,
        "lift": None,
        "lift_lo": None,
        "cont8": 0.6,
    }


ROWS = [
    _row("a", "serum", 300, 100, 0.2),  # 60% of use, 20 changes
    _row("b", "serum", 100, 50, 0.8, tier="proven"),  # 20% of use, 40 changes
    _row("c", "serum", 100, 40, 1.0, tier="proven"),  # 20% of use, 40 changes
    _row("tiny", "serum", 8, 8, 1.0),  # under 10 people: left out
    _row("x", "mask", 50, 20, 0.5),  # one product only: no comparison
]


def test_share_of_use_and_of_results_per_category():
    (c,) = shelf.categories(ROWS, None)
    by = {p["product_id"]: p for p in c["products"]}
    assert c["category"] == "serum" and c["basis"] == "use" and set(by) == {"a", "b", "c"}
    assert (by["a"]["use_share"], by["a"]["results_share"], by["a"]["gap"]) == (0.6, 0.2, -0.4)
    assert (by["b"]["use_share"], by["b"]["results_share"], by["b"]["gap"]) == (0.2, 0.4, 0.2)
    assert by["a"]["stock_share"] is None and by["a"]["shelf_share"] == by["a"]["use_share"]


def test_an_uploaded_stock_file_becomes_the_shelf_and_is_checked_against_use():
    stock = {"rows": [{"product_id": "a", "qty": 10}, {"product_id": "b", "qty": 30}]}
    (c,) = shelf.categories(ROWS, stock)
    by = {p["product_id"]: p for p in c["products"]}
    assert c["basis"] == "stock" and c["stocked"] == 2
    # a and b hold 80% of use; the file splits that 25/75, so a = 20%, b = 60% of the category
    assert (by["a"]["stock_share"], by["b"]["stock_share"]) == (0.2, 0.6)
    assert (
        by["a"]["basis"] == "stock" and by["c"]["basis"] == "use" and by["c"]["shelf_share"] == 0.2
    )
    # stock 25/75 vs use 75/25 among a and b: half the shelf differs
    assert c["agreement"] == 0.5
    assert shelf.kind_ok(by["b"], "stocked_unused", 0.1) and shelf.kind_ok(
        by["a"], "used_understocked", 0.1
    )


def test_flags_must_point_the_way_the_numbers_do():
    (c,) = shelf.categories(ROWS, None)
    by = {p["product_id"]: p for p in c["products"]}
    assert shelf.kind_ok(by["a"], "taking_space", 0.03)
    assert not shelf.kind_ok(by["a"], "under_shelved", 0.03)
    assert shelf.kind_ok(by["b"], "under_shelved", 0.03)  # proven, delivers more than its shelf
    assert not shelf.kind_ok(by["b"], "stocked_unused", 0.03)  # no stock file
    fixed = shelf.rules_flags([c])
    assert {(f["product_id"], f["kind"]) for f in fixed} >= {
        ("a", "taking_space"),
        ("b", "under_shelved"),
    }
    assert all(f["label"] == shelf.KIND_LABEL[f["kind"]] for f in fixed)


SERUM = "the-ordinary-alpha-arbutin-2-ha"


@pytest.mark.parametrize(
    ("text", "error"),
    [
        ("product_id,facings\n" + SERUM + ",4\n", None),
        ("product,stock_units\nThe Ordinary Alpha Arbutin 2% + HA,12\nNo Such Thing,3\n", None),
        ("name,qty\nx,1\n", "needs a header"),
        ("product_id,facings\n" + SERUM + ",lots\n", "should be a number"),
        ("product_id,facings\n" + SERUM + ",-2\n", "can't be negative"),
        ("product_id,facings\nnope,2\n", "No row matched"),
    ],
)
def test_the_stock_file_is_read_or_refused_with_a_reason(text, error):
    if error is None:
        rows, unmatched, col = shelf.parse_stock(text)
        assert rows[0]["product_id"] == SERUM and col in shelf.STOCK_COLUMNS
        assert unmatched == ([] if "No Such" not in text else ["No Such Thing"])
    else:
        with pytest.raises(shelf.BadUpload, match=error):
            shelf.parse_stock(text)


# -- the agent -----------------------------------------------------------------------------------


class Script:
    def __init__(self, rounds):
        self.rounds = list(rounds)
        self.answers: list[tuple[str, dict]] = []

    def __call__(self, contents, config):
        for part in contents[-1].parts or []:
            fr = getattr(part, "function_response", None)
            if fr is not None:
                self.answers.append((fr.name, dict(fr.response)))
        if not self.rounds:
            return [], "Done.", None
        step = self.rounds.pop(0)
        if isinstance(step, Exception):
            raise step
        return step, None, None

    def errors(self, tool):
        return [a["error"] for n, a in self.answers if n == tool and not a.get("ok", True)]


def test_the_agent_flags_what_it_chooses_and_code_refuses_the_rest(monkeypatch):
    cats = shelf.categories(ROWS, None)
    s = Script(
        [
            [("list_categories", {}), ("get_category", {"category": "serum"})],
            [
                (
                    "flag",
                    {
                        "product_id": "b",
                        "kind": "taking_space",
                        "title": "Cut b",
                        "reason": "It lags.",
                        "priority": 1,
                    },
                ),
                (
                    "flag",
                    {
                        "product_id": "a",
                        "kind": "taking_space",
                        "title": "Review a's space",
                        "reason": "a is 99% of use.",
                        "priority": 1,
                    },
                ),
                (
                    "flag",
                    {
                        "product_id": "a",
                        "kind": "stocked_unused",
                        "title": "Check a",
                        "reason": "Too much stock.",
                        "priority": 1,
                    },
                ),
                (
                    "flag",
                    {
                        "product_id": "a",
                        "kind": "taking_space",
                        "title": "Review the space for a",
                        "reason": "60% of serum use but 20% of the visible changes (n=100).",
                        "priority": 2,
                    },
                ),
                (
                    "flag",
                    {
                        "product_id": "b",
                        "kind": "under_shelved",
                        "title": "Give b more facings",
                        "reason": "Proven, with 40% of the changes from 20% of use.",
                        "priority": 1,
                    },
                ),
            ],
            [("finish", {"summary": "Serum space is out of step with results."})],
        ]
    )
    monkeypatch.setattr(shelf_agent, "model_round", s)
    flags, summary = shelf_agent.run(cats, "mixed", "all", False)
    errors = s.errors("flag")
    assert "The numbers don't point that way for this product." in errors
    assert any("number no tool returned" in e for e in errors)
    assert any("No uploaded stock" in e for e in errors)
    assert [(f["product_id"], f["kind"]) for f in flags] == [
        ("b", "under_shelved"),
        ("a", "taking_space"),
    ]
    assert flags[1]["label"] == "Taking space, not delivering"
    assert summary == "Serum space is out of step with results."


def test_without_gemini_the_agent_raises_for_the_fixed_flags(monkeypatch):
    from app import gemini

    monkeypatch.setattr(shelf_agent, "model_round", Script([RuntimeError("down")]))
    with pytest.raises(gemini.GeminiError):
        shelf_agent.run(shelf.categories(ROWS, None), "mixed", "all", False)


# -- the routes --------------------------------------------------------------------------------


@lru_cache
def _raw():
    return retailer.raw_from_tables(cohort.generate(date(2026, 10, 18)))


@pytest.fixture
def rows(monkeypatch):
    from app import retail_intel

    monkeypatch.setattr(retailer, "fetch", _raw)
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retail_intel, "_facts", {})
    monkeypatch.setattr(shelf, "_cache", {})
    monkeypatch.setattr(shelf, "_inflight", {})
    monkeypatch.setattr(shelf, "WAIT_S", 10.0)


def test_upload_view_and_remove_the_stock_file(client, fake, rows):
    out = client.get("/v1/retailer/shelf").json()
    assert out["stock"] is None and out["categories"] and "share of use" in out["note"]
    assert out["source"] == "rules" and out["pending"] is False  # Gemini offline in tests
    serums = next(c for c in out["categories"] if c["category"] == "serum")
    ids = [p["product_id"] for p in serums["products"][:3]]
    text = (
        "product_id,facings\n" + "\n".join(f"{p},{i + 2}" for i, p in enumerate(ids)) + "\nnope,1\n"
    )
    up = client.put("/v1/retailer/shelf/stock", json={"filename": "shelf.csv", "csv": text})
    assert up.status_code == 200 and up.json()["stock"]["matched"] == 3
    assert up.json()["stock"]["unmatched"] == ["nope"]
    out = client.get("/v1/retailer/shelf").json()
    serums = next(c for c in out["categories"] if c["category"] == "serum")
    assert serums["basis"] == "stock" and serums["agreement"] is not None
    assert out["stock"]["filename"] == "shelf.csv"
    bad = client.put("/v1/retailer/shelf/stock", json={"filename": "x.csv", "csv": "a,b\n1,2\n"})
    assert bad.status_code == 422 and "header" in bad.json()["detail"]["message"]
    assert client.delete("/v1/retailer/shelf/stock").status_code == 204
    assert client.get("/v1/retailer/shelf").json()["stock"] is None


def test_the_upload_is_private_and_goes_with_the_account(client, fake, rows):
    from fastapi.testclient import TestClient

    from app.main import app

    text = f"product_id,facings\n{SERUM},4\n"
    client.put("/v1/retailer/shelf/stock", json={"filename": "s.csv", "csv": text})
    other = TestClient(app, headers={"X-Dev-Uid": "someone_else"})
    assert other.get("/v1/retailer/shelf").json()["stock"] is None
    assert client.delete("/v1/me").status_code == 204
    assert fake.store.shelf_get("u_test") is None


def test_while_the_agent_works_the_fixed_flags_are_pending(client, fake, rows, monkeypatch):
    import threading

    gate = threading.Event()

    def slow(contents, config):
        gate.wait(5)
        raise RuntimeError("released")

    monkeypatch.setattr(shelf_agent, "model_round", slow)
    monkeypatch.setattr(shelf, "WAIT_S", 0.05)
    out = client.get("/v1/retailer/shelf").json()
    gate.set()
    assert out["pending"] is True and out["source"] == "rules"


def test_the_route_degrades_to_503(client, fake, rows, monkeypatch):
    monkeypatch.setattr(retailer, "fetch", lambda: (_ for _ in ()).throw(RuntimeError("bq")))
    assert client.get("/v1/retailer/shelf").status_code == 503
