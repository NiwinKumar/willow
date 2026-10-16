"""Willow Proof views (app/retail_intel.py) and the generator's switching and skin effects."""

import hashlib
import json
import math
from collections import Counter
from datetime import UTC, date, datetime
from functools import lru_cache

import pytest
from fastapi.testclient import TestClient

from app import catalog, cohort, gemini, numbers, retail_intel, retailer
from app.main import app

TODAY = date(2026, 10, 15)
CICA = "dot-and-key-cica-calming-night-gel"  # moisturiser: redness, blemishes, shine (Dot & Key)
BALM = "la-roche-posay-cicaplast-baume-b5-plus"  # moisturiser: redness (La Roche-Posay)
DRY_ONLY = "cerave-pm-facial-moisturizing-lotion"  # dryness only: nothing Willow measures
M = retailer.MIN_GROUP


@lru_cache
def _tables():
    return cohort.generate(TODAY)


@lru_cache
def _facts():
    raw = retailer.raw_from_tables(_tables())
    return retail_intel.build_facts(
        retailer.select(raw, "mixed", "all", TODAY), {"cohort": "mixed", "range": "all"}
    )


def _user(i, goals=("redness",), last_week=8, skin="dry", tone="tan"):
    return {
        "user_hash": f"u{i:02d}",
        "synthetic": True,
        "region": "IN",
        "tone": tone,
        "skin_type": skin,
        "goals": list(goals),
        "last_week": last_week,
        "started_at": None,
        "last_ts": datetime(2026, 10, 15, 9, tzinfo=UTC).isoformat(),
    }


def _use(i, pid, started=0, stopped=None):
    p = catalog.by_id(pid)
    return {
        "user_hash": f"u{i:02d}",
        "product_id": pid,
        "brand": p["brand"],
        "category": p["category"],
        "started_week": started,
        "stopped_week": stopped,
    }


def _changed(i, metric="redness", start=4):
    return {"user_hash": f"u{i:02d}", "metric_id": metric, "improved_weeks": list(range(start, 9))}


def _f(users, first=(), routine=(), conflicts=()):
    return retail_intel.build_facts(
        {
            "users": list(users),
            "months": [],
            "first": list(first),
            "routine": list(routine),
            "conflicts": list(conflicts),
        }
    )


def _small():
    """20 users of CICA (12 changed from week 4), 10 non-users with redness (3 changed at 8)."""
    return _f(
        [_user(i) for i in range(30)],
        first=[_changed(i) for i in range(12)] + [_changed(i, start=8) for i in (20, 21, 22)],
        routine=[_use(i, CICA) for i in range(20)],
    )


# ── statistics ─────────────────────────────────────────────────────────────────────────────


def test_lift_ci_tiers_and_what_it_would_take():
    lift, lo, hi = retail_intel.lift_ci(12, 20, 3, 10)
    se = math.sqrt(0.6 * 0.4 / 20 + 0.3 * 0.7 / 10)
    assert (lift, lo, hi) == (0.3, round(0.3 - 1.96 * se, 2), round(0.3 + 1.96 * se, 2))
    assert retail_intel.tier_of(9, 0.5, 0.2) == "too_few"
    assert retail_intel.tier_of(29, 0.5, 0.2) == "promising"  # proven needs n >= 30
    assert retail_intel.tier_of(30, 0.5, 0.2) == "proven"
    assert retail_intel.tier_of(30, 0.1, -0.05) == "promising"
    assert retail_intel.tier_of(30, 0.0, -0.1) == "unclear"
    assert retail_intel.tier_of(30, None, None) == "unclear"  # no base to compare with
    assert retail_intel.to_proven(12, 20, 3, 10) == 79
    assert retail_intel.to_proven(10, 20, 10, 20) is None


def test_complementary_suppression():
    assert retail_intel.suppress([50, 30, 4, 20]) == {2, 3}  # 4 hidden, so 20 hides too
    assert retail_intel.suppress([50, 0, 30]) == {1}  # an empty cell reveals no one
    assert retail_intel.suppress([5, 4, 30, 40]) == {0, 1}
    f = _f(
        [_user(i, skin="dry") for i in range(15)]
        + [_user(i, skin="oily") for i in range(15, 27)]
        + [_user(i, skin="sensitive") for i in range(27, 31)],
        routine=[_use(i, CICA) for i in range(31)],
    )
    skin = {c["id"]: c for c in retail_intel.product_view(f, CICA)["segments"]["skin"]}
    assert skin["dry"]["n"] == 15 and not skin["dry"]["suppressed"]
    for s in ("oily", "sensitive", "normal", "combination"):
        assert skin[s]["n"] is None and skin[s]["rate"] is None and skin[s]["suppressed"]


# ── products ───────────────────────────────────────────────────────────────────────────────


def test_product_row_rate_base_lift_and_curve():
    f = _small()
    d = retail_intel.product_view(f, CICA)
    row = d["product"]
    assert (row["n"], row["users"], row["rate"], row["base_rate"]) == (20, 20, 0.6, 0.3)
    assert (row["rate_lo"], row["rate_hi"]) == retailer._wilson(12, 20)
    assert row["lift"] == 0.3 and row["lift_lo"] < 0 < row["lift_hi"]
    assert row["tier"] == "promising" and row["to_proven"] == 79
    assert row["weeks"] == 4 and row["cont8"] == 1.0
    assert row["stores"] == len(catalog.by_id(CICA)["stores"])
    c = d["curve"]
    assert c["weeks"] == list(range(1, 9))
    assert c["users"] == [0, 0, 0, 0.6, 0.6, 0.6, 0.6, 0.6]
    assert c["base"] == [0] * 7 + [0.3]
    assert c["users"][-1] == row["rate"]
    goal = {g["id"]: g for g in d["segments"]["goal"]}
    assert goal["redness"]["rate"] == 0.6 and goal["redness"]["base_rate"] == 0.3
    assert d["eligibility"]["eligible"] is False
    assert any("79 more people" in r for r in d["eligibility"]["reasons"])
    assert d["competitors"]["rank"] == 1 and d["competitors"]["note"]


def test_too_few_unused_and_not_measured_rows_carry_no_numbers():
    f = _f([_user(i) for i in range(12)], routine=[_use(i, CICA) for i in range(6)])
    rows = {r["product_id"]: r for r in retail_intel.products_view(f)["products"]}
    assert rows[CICA]["tier"] == "too_few" and rows[CICA]["reason"] == "few"
    assert rows[BALM]["reason"] == "unused" and rows[DRY_ONLY]["reason"] == "not_measured"
    for key in ("n", "rate", "rate_lo", "base_rate", "lift", "lift_lo", "weeks", "cont8"):
        assert rows[CICA][key] is None
    assert rows[CICA]["users"] is None  # 6 people: suppressed too
    d = retail_intel.product_view(f, CICA)
    assert d["curve"]["users"] == [None] * 8 and d["evidence"] == []
    assert all(c["suppressed"] for c in d["segments"]["skin"])
    counts = retail_intel.products_view(f)["counts"]
    assert counts["products"] == len(catalog.products())
    assert (
        counts["measured"] + counts["too_few"] + counts["unused"] + counts["not_measured"]
        == (counts["products"])
    )


def test_switching_co_use_and_conflicts():
    users = [_user(i) for i in range(14)]
    routine = (
        [_use(i, CICA, stopped=3) for i in range(13)]
        + [_use(i, BALM, started=4) for i in range(12)]
        + [_use(12, BALM, started=7)]  # starts 4 weeks after the stop: not a switch
    )
    conflicts = [{"user_hash": f"u{i:02d}", "kind": "duplicate_active"} for i in range(12)]
    f = _f(users, routine=routine, conflicts=conflicts)
    assert len(f.switches) == 12
    d = retail_intel.product_view(f, CICA)
    assert d["switching"]["stopped"] == 13
    assert d["switching"]["to"] == [
        {
            "product_id": BALM,
            "product": catalog.by_id(BALM)["name"],
            "brand": "La Roche-Posay",
            "n": 12,
        }
    ]
    assert retail_intel.product_view(f, BALM)["switching"]["from"][0]["product_id"] == CICA
    assert d["co_used"][0]["product_id"] == BALM and d["co_used"][0]["n"] == 13
    assert d["co_used"][0]["share"] == 1.0
    assert d["conflicts"] == [
        {
            "kind": "duplicate_active",
            "label": "Duplicate active",
            "fix": "Keep one product per active",
            "n": 12,
            "share": 1.0,
        }
    ]
    lrp = retail_intel.brand_view(f, "La Roche-Posay")
    assert lrp["switching"]["won"] == [{"brand": "Dot & Key", "n": 12}]
    assert lrp["switching"]["net"] is None  # lost side under 10: no net that would reveal it
    assert retail_intel.brand_view(f, "Dot & Key")["switching"]["lost"][0]["brand"] == (
        "La Roche-Posay"
    )
    lrp_to = {"brand": "La Roche-Posay", "label": "La Roche-Posay", "same_brand": False, "n": 12}
    assert d["switching"]["to_brands"] == [lrp_to] and d["switching"]["from_brands"] == []


def test_brand_flows_fill_better_and_label_the_own_brand():
    tord = "the-ordinary-niacinamide-10-zinc-1"
    same = "the-ordinary-alpha-arbutin-2-ha"  # another The Ordinary serum
    m_nia, m_aa = "minimalist-niacinamide-10-face-serum", "minimalist-alpha-arbutin-2-face-serum"
    routine = (
        [_use(i, tord, stopped=3) for i in range(26)]
        + [_use(i, m_nia, started=3) for i in range(6)]  # 6 people: under 10 as a product
        + [_use(i, m_aa, started=4) for i in range(6, 11)]  # 5 people
        + [_use(i, m_aa, started=5) for i in range(3)]  # u00-u02 take both Minimalist serums
        + [_use(i, same, started=4) for i in range(11, 23)]  # 12 people, same brand
    )
    f = _f([_user(i, goals=["blemishes"]) for i in range(26)], routine=routine)
    s = retail_intel.product_view(f, tord)["switching"]
    assert [r["product_id"] for r in s["to"]] == [same]  # each Minimalist serum under 10
    assert s["to_brands"] == [
        {
            "brand": "The Ordinary",
            "label": "Same brand, other product",
            "same_brand": True,
            "n": 12,
        },
        {"brand": "Minimalist", "label": "Minimalist", "same_brand": False, "n": 11},
    ]  # Minimalist: 6 + 8 switch rows, 11 people (a person counts once per brand)
    assert s["stopped"] == 26


def test_scoreboard_on_the_synthetic_cohort():
    d = retail_intel.products_view(_facts())
    assert len(d["products"]) == len(catalog.products())
    tiers = Counter(r["tier"] for r in d["products"])
    assert tiers["proven"] and tiers["promising"] and tiers["unclear"]
    keys = {
        "product_id", "product", "brand", "category", "category_label", "goal_ids", "price_tier",
        "image_url", "users", "n", "rate", "rate_lo", "rate_hi", "base_rate", "lift", "lift_lo",
        "lift_hi", "weeks", "cont8", "routine_share", "tier",
    }  # fmt: skip
    for r in d["products"]:
        assert keys <= set(r)
        assert r["users"] is None or r["users"] >= M
        if r["tier"] == "too_few":
            assert r["rate"] is None and r["lift"] is None
            continue
        assert r["n"] >= M and r["rate_lo"] <= r["rate"] <= r["rate_hi"]
        if r["tier"] == "proven":
            assert r["n"] >= 30 and r["lift_lo"] > 0
        elif r["tier"] == "promising":
            assert r["lift"] > 0 and not (r["n"] >= 30 and r["lift_lo"] > 0)
        else:
            assert r["lift"] is None or r["lift"] <= 0
        if r["lift"] is not None:
            assert r["lift_lo"] <= r["lift"] <= r["lift_hi"]


def test_product_detail_on_the_synthetic_cohort():
    f = _facts()
    proven = next(r for r in retail_intel.rows(f) if r["tier"] == "proven")
    d = retail_intel.product_view(f, proven["product_id"])
    for series in (d["curve"]["users"], d["curve"]["base"]):
        vals = [v for v in series if v is not None]
        assert vals == sorted(vals)  # cumulative
    assert d["curve"]["users"][-1] == d["product"]["rate"]
    assert d["curve"]["base"][-1] == d["product"]["base_rate"]
    for cells in d["segments"].values():
        for c in cells:
            assert (c["n"] is None) == c["suppressed"] and (c["n"] is None or c["n"] >= M)
    comp = d["competitors"]["rows"]
    assert sum(r["is_self"] for r in comp) == 1 and d["competitors"]["of"] == len(comp)
    assert [r["rate"] for r in comp] == sorted((r["rate"] for r in comp), reverse=True)
    assert all(c["n"] >= M for c in d["co_used"]) and len(d["co_used"]) <= 6
    assert d["eligibility"]["eligible"] == bool(d["eligibility"]["goals"])
    assert retail_intel.product_view(f, "no-such-product") is None


def test_evidence_is_measured_cosmetic_and_quotes_only_computed_numbers():
    f = _facts()
    proven = next(r for r in retail_intel.rows(f) if r["tier"] == "proven")
    d = retail_intel.product_view(f, proven["product_id"])
    allowed = numbers.collect(d) | numbers.percents(d)
    kinds = {e["kind"] for e in d["evidence"]}
    assert {"efficacy", "retention"} <= kinds
    for e in d["evidence"]:
        assert numbers.only_known(e["text"], allowed), e["text"]
        assert "clinically" not in e["text"].lower() and "treat" not in e["text"].lower()
        assert e["text"].endswith("Simulated cohort.") and e["cohort_label"] == "Simulated cohort"
        assert e["method"] == retail_intel.METHOD and e["window"] == "8 weeks"
        assert "not a controlled trial" in e["caveat"] and e["n"] >= M
    assert retail_intel.cohort_label({"real": 3, "synthetic": 0}) == "Consented users"
    assert retail_intel.cohort_label({"real": 3, "synthetic": 9}) == "Mixed"


# ── segments and brands ────────────────────────────────────────────────────────────────────


def test_segments_view():
    d = retail_intel.segments_view(_facts())
    assert [s["id"] for s in d["skin_types"]] == cohort.SKIN_TYPES
    assert len(d["goals"]) == 8 and len(d["cells"]) == 5 * 8
    for c in d["cells"]:
        assert c["users"] is None or c["users"] >= M
        assert c["unmet"] is None or 0 <= c["unmet"] <= 1
        if c["best"]:
            assert c["best"]["n"] >= M
            assert c["runner_up"] is None or c["runner_up"]["rate"] <= c["best"]["rate"]
    assert any(c["best"] for c in d["cells"])
    for s in d["by_skin"]:
        assert len(s["top_goals"]) <= 3 and len(s["top_products"]) <= 5
        assert all(p["n"] >= M for p in s["top_products"])
        assert s["conflict_share"] is None or 0 <= s["conflict_share"] <= 1


def test_brands_and_one_brand():
    f = _facts()
    d = retail_intel.brands_view(f)
    assert {b["brand"] for b in d["brands"]} == {p["brand"] for p in catalog.products()}
    assert d["note"] == retail_intel.COMPARE_NOTE
    for b in d["brands"]:
        assert b["n"] is None or (b["n"] >= M and b["lo"] <= b["rate"] <= b["hi"])
    one = retail_intel.brand_view(f, "cosrx")  # case-insensitive
    assert one["brand"] == "COSRX" and one["note"]
    assert all(r["brand"] == "COSRX" for r in one["products"])
    for g in one["goals"]:
        assert g["brand"] is None or g["brand"]["n"] >= M
        assert g["rank"] is None or 1 <= g["rank"] <= g["of"]
        assert g["best_competitor"] is None or g["best_competitor"]["brand"] != "COSRX"
    assert sum(p["is_self"] for p in one["positioning"]) == 1
    assert all(s["n"] is None or s["n"] >= M for s in one["skin"])
    assert retail_intel.brand_view(f, "Acme") is None


# ── brief ──────────────────────────────────────────────────────────────────────────────────


def test_brief_cards_retailer_and_brand():
    f = _facts()
    cards = retail_intel.brief_cards(f)
    assert 4 <= len(cards) <= 6
    assert {c["kind"] for c in cards} >= {"win", "risk", "opportunity"}
    sections = {"products", "categories", "segments", "competitors", "demand", "promote"}
    for c in cards:
        assert c["link"]["section"] in sections
        assert {"id", "kind", "title", "body", "value", "unit", "n", "link"} == set(c)
    brand = retail_intel.brief_cards(f, "The Ordinary")
    assert brand and all(
        "The Ordinary" in c["title"] or c["link"]["section"] == "products" for c in brand
    )
    assert retail_intel.brief_cards(_f([_user(i) for i in range(5)])) == []


def test_summary_may_only_quote_numbers_in_the_cards():
    cards = [
        {"id": "a", "kind": "win", "title": "X is Proven", "body": "61% vs 20% (n=212).",
         "value": 41, "unit": "points", "n": 212, "link": {"section": "products"}},
    ]  # fmt: skip
    assert (
        retail_intel.summary_problems("X leads: 61% against 20%, 41 points (n=212).", cards) == []
    )
    assert retail_intel.summary_problems("X leads by 45 points.", cards) == [
        "quotes a number that is not in the cards"
    ]
    assert "banned wording" in retail_intel.summary_problems("X is clinically proven.", cards)
    assert retail_intel.summary_problems(" ".join(["word"] * 61), cards) == ["longer than 60 words"]


@pytest.fixture
def proof(monkeypatch):
    monkeypatch.setattr(retail_intel, "facts", lambda c="mixed", r="all": (_facts(), 1, TODAY))
    monkeypatch.setattr(retail_intel, "_summaries", {})
    _facts().memo.pop(("view", "brief", None), None)
    return TestClient(app)


def test_routes_answer_without_sign_in_and_404_unknowns(proof):
    for path in ("products", "segments", "brands", "brief", f"products/{CICA}", "brands/COSRX"):
        res = proof.get(f"/v1/retailer/{path}?cohort=simulated&range=all")
        assert res.status_code == 200, (path, res.text)
    assert proof.get("/v1/retailer/brands/Dot%20%26%20Key").json()["brand"] == "Dot & Key"
    assert proof.get("/v1/retailer/products/nope").status_code == 404
    assert proof.get("/v1/retailer/brands/Acme").status_code == 404
    assert proof.get("/v1/retailer/brief?brand=Acme").status_code == 404
    assert proof.get("/v1/retailer/products?cohort=everyone").status_code == 422
    body = proof.get("/v1/retailer/brief").json()
    assert body["cards"] and body["summary"] is None  # Gemini is offline in tests


def test_brief_summary_is_validated_and_cached(proof, monkeypatch):
    calls = []
    cards = retail_intel.brief_cards(_facts())
    good = f"{cards[0]['title']}: {cards[0]['value']} points (simulated cohort)."

    def reply(*a, **k):
        calls.append(1)
        return retail_intel.Summary(text=good)

    monkeypatch.setattr(gemini, "generate_json", reply)
    a = proof.get("/v1/retailer/brief").json()
    assert a["summary"] == {"text": good, "validated": True}
    assert proof.get("/v1/retailer/brief").json()["summary"] == a["summary"]
    assert len(calls) == 1  # cached per filter, brand and data version

    monkeypatch.setattr(retail_intel, "_summaries", {})
    monkeypatch.setattr(
        gemini, "generate_json", lambda *a, **k: retail_intel.Summary(text="Up 999 points.")
    )
    assert proof.get("/v1/retailer/brief").json()["summary"] is None


def test_routes_degrade_to_503_when_rows_are_unavailable(monkeypatch):
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    client = TestClient(app)
    for path in ("products", "segments", "brands", "brief", f"products/{CICA}", "brands/COSRX"):
        assert client.get(f"/v1/retailer/{path}").status_code == 503


def test_facts_are_built_once_per_filter_and_eligibility_for_campaigns(monkeypatch):
    raw = retailer.raw_from_tables(_tables())
    built = []
    real_build = retail_intel.build_facts
    monkeypatch.setattr(retailer, "fetch", lambda: raw)
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retail_intel, "_facts", {})
    monkeypatch.setattr(
        retail_intel, "build_facts", lambda *a, **k: built.append(1) or real_build(*a, **k)
    )
    a = retail_intel.products()
    assert retail_intel.products() is a and retail_intel.segments() and len(built) == 1
    assert a["filters"]["cohort"] == "mixed"
    retail_intel.products("simulated", "30d")
    assert len(built) == 2
    entries = retail_intel.eligibility_all()
    assert len(entries) == len(catalog.products()) and len(built) == 2  # mixed/all reused
    keys = {"product_id", "product", "brand", "tier", "eligible", "reasons", "goals",
            "skin_types", "evidence"}  # fmt: skip
    for e in entries:
        assert set(e) == keys and e["reasons"]
        assert not e["eligible"] or (e["tier"] == "proven" and e["goals"] and e["evidence"])
    assert any(e["eligible"] for e in entries)
    one = retail_intel.product_eligibility(entries[0]["product_id"])
    assert one == entries[0]
    assert retail_intel.product_eligibility("nope") is None
    with pytest.raises(ValueError):
        retail_intel.facts("everyone", "all")


# ── generator: switching and skin effects ──────────────────────────────────────────────────

# Digest of cohort.generate(2026-10-15) on origin/main before switching and skin effects
# (users, routines, conflicts, months, and the first 50 people's readings).
BEFORE = "2116406a73a0b96f14068c8980abcd76acc96bc226dff5a7d914c52de478eee5"


def _digest(t):
    first = {u["user_hash"] for u in t["users_flat"][:50]}
    body = {k: t[k] for k in ("users_flat", "routine_flat", "routine_conflicts", "goals_monthly")}
    body["sessions_first_50"] = [r for r in t["sessions_flat"] if r["user_hash"] in first]
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def test_existing_draws_are_unchanged_and_replacements_are_added():
    before = cohort.generate(TODAY, switching=False, skin_effects=False)
    assert _digest(before) == BEFORE
    after = _tables()
    assert after["users_flat"] == before["users_flat"]
    assert after["goals_monthly"] == before["goals_monthly"]
    key = ("user_hash", "product_id", "started_week", "stopped_week")
    old = Counter(tuple(r[k] for k in key) for r in before["routine_flat"])
    new = Counter(tuple(r[k] for k in key) for r in after["routine_flat"])
    assert not old - new  # every earlier routine row is still there
    added = new - old
    assert sum(added.values()) > 200
    assert all(started >= 2 for _, _, started, _ in added)
    assert len(_facts().switches) > 200
    products = {p["product_id"]: p for p in catalog.products()}
    assert all(products[a]["category"] == products[b]["category"] for _, a, b in _facts().switches)


def test_switchers_concentrate_enough_for_the_switching_views():
    f = _facts()
    big = [
        pid
        for pid in retail_intel._catalog()[0]
        if sum(1 for uh in f.users_of.get(pid, []) if f.rows_of[(uh, pid)]["stopped_week"]) >= 30
    ]
    views = {pid: retail_intel.product_view(f, pid)["switching"] for pid in big}
    assert len(big) >= 6
    assert sum(1 for s in views.values() if s["to"]) * 2 > len(big)  # most show a `to` row
    assert sum(1 for s in views.values() if s["to_brands"]) >= sum(
        1 for s in views.values() if s["to"]
    )
    # switches concentrate: in each busy category the most chosen product takes 10 or more
    products = retail_intel._catalog()[0]
    landed = Counter(b for _, _, b in f.switches)
    for cat in {p["category"] for p in products.values()}:
        ids = [pid for pid, p in products.items() if p["category"] == cat]
        if sum(landed[pid] for pid in ids) >= 30:
            top = max(ids, key=lambda pid: landed[pid])
            assert landed[top] >= 10


def test_skin_type_changes_effect_size():
    by_id = {p["product_id"]: p for p in catalog.products()}
    niac = cohort.skin_effect(by_id["the-ordinary-niacinamide-10-zinc-1"])
    assert niac["oily"] > niac["normal"] > niac["dry"]
    balm = cohort.skin_effect(by_id[BALM])
    assert balm["dry"] > balm["normal"] > balm["oily"]
    retinal = cohort.skin_effect(by_id["the-ordinary-retinal-0-2-emulsion"])
    assert retinal["sensitive"] < retinal["normal"]

    def pooled(f, skin):
        k = n = 0
        for pid, p in by_id.items():
            traits = cohort.product_traits(p)
            if "oil_control" not in traits or "barrier" in traits:
                continue
            ms = retailer.product_targets(p)
            for uh in f.users_of.get(pid, []):
                if f.eligible(uh) and f.users[uh]["skin_type"] == skin:
                    n += 1
                    k += f.outcome(uh, ms) is not None
        return k / n

    f = _facts()
    assert pooled(f, "oily") - pooled(f, "dry") > 0.15  # oil control works better on oily skin
