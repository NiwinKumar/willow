from datetime import UTC, date, datetime, timedelta
from functools import lru_cache

import pytest
from fastapi.testclient import TestClient

from app import catalog, cohort, demo, retailer
from app.main import app

# captured before conftest's offline stubs replace them
REAL_FETCH = retailer.fetch
REAL_PROBE = demo.probe_bigquery

TODAY = date(2026, 10, 15)
CICA = "dot-and-key-cica-calming-night-gel"  # moisturiser for redness (and blemishes, oil)
BALM = "la-roche-posay-cicaplast-baume-b5-plus"  # moisturiser for redness


@lru_cache
def _tables():
    return cohort.generate(TODAY)


@lru_cache
def _raw():
    return retailer.raw_from_tables(_tables())


@lru_cache
def _data():
    return retailer.aggregate(retailer.select(_raw(), "mixed", "all", TODAY))


def _user(i, goals=("redness",), last_week=8, synthetic=True, last=TODAY, **kw):
    return {
        "user_hash": f"u{i:02d}",
        "synthetic": synthetic,
        "region": "IN",
        "tone": "tan",
        "skin_type": "dry",
        "goals": list(goals),
        "last_week": last_week,
        "started_at": None,
        "last_ts": datetime(last.year, last.month, last.day, 9, tzinfo=UTC).isoformat(),
        **kw,
    }


def _raw_of(users, first=(), routine=(), conflicts=(), months=()):
    return {
        "users": list(users),
        "months": list(months),
        "first": list(first),
        "routine": list(routine),
        "conflicts": list(conflicts),
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


# ── the generator ──────────────────────────────────────────────────────────────────────────


def test_cohort_rows_are_all_synthetic_and_reproducible():
    a, b = cohort.generate(TODAY), cohort.generate(TODAY)
    assert a == b
    assert all(r["is_synthetic"] for t in a.values() for r in t)


def test_people_start_in_aug_sep_oct_and_data_runs_to_today():
    t = _tables()
    starts = {u["started_at"][:7] for u in t["users_flat"]}
    assert starts == {"2026-08", "2026-09", "2026-10"}
    last = max(r["session_ts"] for r in t["sessions_flat"])
    assert TODAY - timedelta(days=8) <= datetime.fromisoformat(last).date() <= TODAY
    assert {r["month"] for r in t["goals_monthly"]} == {"2026-08", "2026-09", "2026-10"}
    # nothing after today, and no stop recorded in a week that has not happened
    weeks = {u["user_hash"]: u["last_week"] for u in t["users_flat"]}
    assert all(
        r["stopped_week"] is None or r["stopped_week"] <= weeks[r["user_hash"]]
        for r in t["routine_flat"]
    )


def test_a_later_today_only_reveals_more_weeks_of_the_same_people():
    early = cohort.generate(date(2026, 9, 20))
    late = _tables()
    early_users = {u["user_hash"] for u in early["users_flat"]}
    assert early_users < {u["user_hash"] for u in late["users_flat"]}
    late_rows = {
        (r["user_hash"], r["weeks_since_baseline"], r["metric_id"]): r
        for r in late["sessions_flat"]
    }
    for r in early["sessions_flat"][:2000]:
        assert (
            late_rows[(r["user_hash"], r["weeks_since_baseline"], r["metric_id"])]["delta"]
            == r["delta"]
        )


def test_goals_shift_by_month_and_skin_type_is_a_fixed_mix():
    d = _data()
    nbm = d["needs_by_month"]
    assert nbm["months"] == ["2026-08", "2026-09", "2026-10"]
    spots = next(g for g in nbm["goals"] if g["goal_id"] == "dark_spots")
    oil = next(g for g in nbm["goals"] if g["goal_id"] == "oil_glow")
    assert spots["share_of_peak"][2] > spots["share_of_peak"][0]  # dark spots grow into October
    assert oil["share_of_peak"][0] >= oil["share_of_peak"][2]
    skins = {u["skin_type"] for u in _tables()["users_flat"]}
    assert skins == set(cohort.SKIN_TYPES)


def test_goal_ids_are_the_apps_eight_and_old_ids_map_onto_them():
    assert set(retailer.GOAL_LABEL) == set(cohort.GOALS) == set(cohort.GOAL_METRICS)
    assert cohort.goals_of(["clearer", "calmer", "smoother"]) == [
        "blemishes",
        "redness",
        "pores_texture",
    ]
    assert cohort.goals_of(["softer_lines", "even_tone"]) == ["lines", "even_tone"]
    assert cohort.goals_of(["dark_spots_pigmentation", "dullness", "dryness_barrier"]) == [
        "dark_spots",
        "oil_glow",
    ]
    # an export that wrote goals as catalog concerns (oil_glow -> oiliness_shine + dullness)
    assert cohort.goals_of(["oiliness_shine", "dullness", "uneven_tone"]) == [
        "oil_glow",
        "even_tone",
    ]
    for c, g in cohort.CONCERN_GOAL.items():
        assert g is None if c == "dryness_barrier" else g in cohort.GOALS


def test_duplicate_actives_are_recorded_from_the_rule_table():
    entries = [
        {"id": pid, **catalog.by_id(pid), "custom_name": "x", "slots": ["pm"], "ended_at": None}
        for pid in ("the-ordinary-niacinamide-10-zinc-1", "cerave-pm-facial-moisturizing-lotion")
    ]
    assert "duplicate_active" in cohort.finding_kinds(entries)
    assert cohort.finding_kinds([]) == ["none"]
    kinds = {c["kind"] for c in _data()["conflicts"]}
    assert "duplicate_active" in kinds


# ── aggregation: suppression, shapes ───────────────────────────────────────────────────────


def test_small_groups_are_suppressed_everywhere():
    d = _data()
    m = retailer.MIN_GROUP
    for p in d["products"]:
        assert p["n"] >= m
        for c in p["cells"] + p["cells_skin"]:
            assert (c["value"] is None) == (c["n"] < m) or c["suppressed"]
        assert p["base"] is None or p["base"]["n"] >= m
    assert all(o["n"] >= m for o in d["product_outcomes"].values())
    assert all(b["n"] >= m for b in d["brands"])
    assert all(n["n"] >= m for n in d["needs"])
    assert all(n["weeks_n"] is None or n["weeks_n"] >= m for n in d["needs"])
    for g in d["needs_by_month"]["goals"]:
        assert all(c is None or c >= m for c in g["counts"])
    for g in d["gaps"]:
        for t in ("budget", "mid", "premium"):
            assert g[t]["n"] is None or g[t]["n"] >= m
            assert (g[t]["rate"] is None) == (g[t]["n"] is None)
    for c in d["categories"]:
        assert all(b["n"] >= m for b in c["brands"])
        for f in c["flows"]:
            assert f["n"] >= m and (f["base"] is None or f["base"]["n"] >= m)
    assert all(c["n"] >= m for c in d["conflicts"])
    assert d["kpis"]["continuation_wk8"]["n"] >= m


def test_fewer_than_ten_people_show_nothing_but_the_head_count():
    raw = _raw_of([_user(i) for i in range(6)], first=[], routine=[_use(i, CICA) for i in range(6)])
    d = retailer.aggregate(raw)
    assert d["empty"] is True and d["cohort"]["synthetic"] == 6
    assert d["tiles"] == [] and d["products"] == [] and d["needs_by_month"]["goals"] == []


def test_shapes_and_ranges():
    d = _data()
    assert d["empty"] is False
    assert d["cohort"]["real"] == 0 and d["cohort"]["synthetic"] == len(_tables()["users_flat"])
    for n in d["needs"]:
        assert n["real"] + n["none"] + n["early"] == 100
        assert n["goal"] == retailer.GOAL_LABEL[n["goal_id"]]
    for b in d["brands"]:
        assert 0 <= b["lo"] <= b["rate"] <= b["hi"] <= 1
    assert all(0 <= c["share"] <= 1 for c in d["conflicts"])
    assert d["routines_checked"] == d["cohort"]["synthetic"]
    assert len(d["tone_bands"]) == len(cohort.TONE_BANDS) == len(d["products"][0]["cells"])
    assert len(d["skin_types"]) == len(d["products"][0]["cells_skin"])
    cat = d["kpis"]["catalog"]
    assert cat["products"] == len(catalog.products())
    assert cat["with_outcomes"] + cat["below_min"] + cat["unused"] + cat["not_measured"] == len(
        catalog.products()
    )
    assert cat["with_outcomes"] == len(d["product_outcomes"])
    for p in d["product_outcomes"].values():
        assert {"category", "cont8", "lift"} <= set(p)


def test_outcome_needs_the_improvement_to_hold_at_week_8():
    raw = _raw_of(
        [_user(i, goals=["redness_sensitivity"]) for i in range(12)],
        first=[
            {"user_hash": f"u{i:02d}", "metric_id": "redness", "improved_weeks": [6, 7, 8]}
            for i in range(6)
        ]
        + [
            {"user_hash": f"u{i:02d}", "metric_id": "redness", "improved_weeks": [3]}
            for i in range(6, 12)
        ],
    )
    d = retailer.aggregate(raw)
    calm = next(n for n in d["needs"] if n["goal_id"] == "redness")  # old concern id maps over
    assert calm["real"] == 50  # a single lucky reading at week 3 does not count
    assert calm["weeks"] is None  # 6 people changed: under 10, so no median
    assert d["tiles"][3]["value"] == "–"


# ── filters ────────────────────────────────────────────────────────────────────────────────


def test_cohort_and_range_filters_keep_only_their_people():
    old = TODAY - timedelta(days=45)
    users = (
        [_user(i) for i in range(12)]
        + [_user(i, synthetic=False) for i in range(12, 24)]
        + [_user(i, last=old) for i in range(24, 36)]
    )
    months = [
        {
            "user_hash": u["user_hash"],
            "month": u["last_ts"][:7],
            "last_ts": u["last_ts"],
            "goals": u["goals"],
        }
        for u in users
    ]
    raw = _raw_of(
        users,
        months=months,
        conflicts=[{"user_hash": u["user_hash"], "kind": "none"} for u in users],
    )
    sim = retailer.aggregate(retailer.select(raw, "simulated", "all", TODAY))
    assert (sim["cohort"]["synthetic"], sim["cohort"]["real"]) == (24, 0)
    real = retailer.aggregate(retailer.select(raw, "real", "all", TODAY))
    assert (real["cohort"]["synthetic"], real["cohort"]["real"]) == (0, 12)
    recent = retailer.aggregate(retailer.select(raw, "mixed", "30d", TODAY))
    assert (recent["cohort"]["synthetic"], recent["cohort"]["real"]) == (12, 12)
    assert recent["needs_by_month"]["months"] == ["2026-10"]
    assert recent["routines_checked"] == 24
    wide = retailer.aggregate(retailer.select(raw, "mixed", "90d", TODAY))
    assert wide["needs_by_month"]["months"] == ["2026-08", "2026-10"]
    assert retailer.since_of("30d", TODAY).date() == date(2026, 9, 16)
    assert retailer.since_of("all", TODAY) is None


def test_month_buckets_count_people_and_share_of_the_months_peak():
    users = [_user(i, goals=["redness"]) for i in range(30)]
    months = (
        [
            {
                "user_hash": f"u{i:02d}",
                "month": "2026-09",
                "last_ts": "2026-09-20T09:00:00+00:00",
                "goals": ["redness"],
            }
            for i in range(20)
        ]
        + [
            {
                "user_hash": f"u{i:02d}",
                "month": "2026-09",
                "last_ts": "2026-09-20T09:00:00+00:00",
                "goals": ["lines"],
            }
            for i in range(20, 25)
        ]
        + [
            {
                "user_hash": f"u{i:02d}",
                "month": "2026-10",
                "last_ts": "2026-10-10T09:00:00+00:00",
                "goals": ["redness", "dark_spots"],
            }
            for i in range(30)
        ]
    )
    nbm = retailer.aggregate(_raw_of(users, months=months))["needs_by_month"]
    assert nbm["months"] == ["2026-09", "2026-10"]
    assert nbm["people"] == [25, 30]
    red = next(g for g in nbm["goals"] if g["goal_id"] == "redness")
    assert red["counts"] == [20, 30] and red["share_of_peak"] == [1.0, 1.0]
    spots = next(g for g in nbm["goals"] if g["goal_id"] == "dark_spots")
    assert spots["counts"] == [None, 30]  # no one in September: suppressed, not 0
    assert all(g["goal_id"] != "lines" for g in nbm["goals"])  # 5 people: hidden everywhere


# ── category × goal flow ───────────────────────────────────────────────────────────────────


def test_category_flow_counts_change_by_week_and_still_using():
    users = [_user(i, goals=["redness"]) for i in range(30)]
    first = [
        # u00-u04 changed from week 2, u05-u09 from week 4, u10-u14 from week 7 (held to week 8)
        {"user_hash": f"u{i:02d}", "metric_id": "redness", "improved_weeks": list(range(s, 9))}
        for s, rng_ in ((2, range(0, 5)), (4, range(5, 10)), (7, range(10, 15)))
        for i in rng_
    ] + [
        # u20-u24 do not use a moisturiser; two of them changed
        {"user_hash": f"u{i:02d}", "metric_id": "redness", "improved_weeks": [8]}
        for i in (20, 21)
    ]
    routine = [_use(i, CICA, stopped=3 if i < 4 else None) for i in range(20)] + [
        _use(i, BALM, started=5) for i in range(16, 20)
    ]
    d = retailer.aggregate(_raw_of(users, first=first, routine=routine))
    moist = next(c for c in d["categories"] if c["category"] == "moisturizer")
    flow = next(f for f in moist["flows"] if f["goal_id"] == "redness")
    assert flow["n"] == 20 and flow["weeks"] == [2, 4, 8]
    assert flow["changed"] == [5, 10, 15]
    assert flow["using"] == [20, 16, 16]  # 4 stopped at week 3
    assert flow["rate"] == 0.75 and flow["median_weeks"] == 4
    assert flow["base"] == {"k": 2, "n": 10, "rate": 0.2}
    assert moist["label"] == "Moisturisers"


def test_gap_tiers_carry_users_and_conflicts_their_denominator():
    d = _data()
    assert any(g[t]["n"] for g in d["gaps"] for t in ("budget", "mid", "premium"))
    top = d["conflicts"][0]
    assert top["share"] == round(top["n"] / d["routines_checked"], 2)
    assert d["brands_hidden"] >= 0


# ── endpoint, cache ────────────────────────────────────────────────────────────────────────


def test_route_takes_filters_validates_them_and_degrades(monkeypatch):
    client = TestClient(app)
    seen = []
    monkeypatch.setattr(retailer, "insights", lambda c, r: seen.append((c, r)) or _data())
    assert client.get("/v1/retailer/insights").status_code == 200
    assert client.get("/v1/retailer/insights?cohort=real&range=30d").status_code == 200
    assert seen == [("mixed", "all"), ("real", "30d")]
    assert client.get("/v1/retailer/insights?cohort=everyone").status_code == 422
    assert client.get("/v1/retailer/insights?range=7d").status_code == 422

    def down(*a):
        raise RuntimeError("bq down")

    monkeypatch.setattr(retailer, "insights", down)
    assert client.get("/v1/retailer/insights").status_code == 503


def test_rows_are_fetched_once_and_each_filter_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(retailer, "fetch", lambda: calls.append(1) or _raw())
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retailer, "_views", {})
    a = retailer.insights()
    b = retailer.insights("simulated", "90d")
    assert retailer.insights() is a and len(calls) == 1
    assert a["filters"]["cohort"] == "mixed" and b["filters"]["range"] == "90d"
    assert b["filters"]["since"] is not None and a["filters"]["since"] is None
    with pytest.raises(ValueError):
        retailer.insights("everyone", "all")


def test_bigquery_failure_after_expiry_serves_the_last_rows(monkeypatch):
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": _raw(), "version": 3})
    monkeypatch.setattr(retailer, "_views", {})

    def down():
        raise RuntimeError("bq down")

    monkeypatch.setattr(retailer, "fetch", down)
    assert retailer.insights()["cohort"]["synthetic"] > 0


def test_stale_rows_are_served_at_once_while_one_refresh_runs(monkeypatch):
    import threading

    old, new = _raw(), _raw()
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": old, "version": 3})
    monkeypatch.setattr(retailer, "_views", {})
    gate, calls = threading.Event(), []

    def slow():
        calls.append(1)
        gate.wait(5)  # BigQuery taking its time
        return new

    monkeypatch.setattr(retailer, "fetch", slow)
    assert retailer._rows() == (old, 3)  # stale: served at once...
    assert retailer._rows() == (old, 3)  # ...and the refresh is not started twice
    gate.set()
    with retailer._refreshing:  # the background refresh has finished
        pass
    assert len(calls) == 1 and retailer._rows() == (new, 4)


def test_the_five_queries_run_side_by_side_on_one_client(monkeypatch):
    import threading

    started, both = [], threading.Barrier(len(retailer.QUERIES), timeout=5)

    class Job:
        def result(self, timeout=None):
            both.wait()  # every query is in flight at once, or this times out
            return [{"x": 1}]

    class Client:
        def query(self, sql):
            started.append(sql)
            return Job()

        def get_table(self, name, timeout=None):
            started.append(name)

    monkeypatch.setattr(retailer, "bq_client", lambda: Client())
    out = REAL_FETCH()  # conftest replaces retailer.fetch with an offline stub
    assert set(out) == set(retailer.QUERIES) and len(started) == len(retailer.QUERIES)
    REAL_PROBE()  # the judge status probe uses the same shared client
    assert started[-1].endswith(".sessions_flat")


def test_goal_labels_match_the_app():
    """GOAL_LABEL uses the app's goal labels exactly (web/src/lib/metrics.ts GOALS)."""
    import re
    from pathlib import Path

    web = (Path(__file__).resolve().parents[2] / "web/src/lib/metrics.ts").read_text()
    found = dict(re.findall(r"\{ id: '([a-z_]+)', label: '([^']+)', metrics:", web))
    if not found:
        pytest.skip("metrics.ts still has the old 7 goals (the 8-goal branch is not merged)")
    assert found == retailer.GOAL_LABEL
