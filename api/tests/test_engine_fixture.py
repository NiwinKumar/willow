import pytest

from app import contract, engine


def _request(
    site="face_full", mode="calibrated_raw", n=5, baseline=None, sid="s_20261014_aaaa0001"
):
    return {
        "schema_version": "1.0",
        "session_id": sid,
        "user_id": "u_test",
        "site": site,
        "capture_mode": mode,
        "frames": [{"uri": f"gs://b/uploads/u/{sid}/frame_{i}.dng"} for i in range(1, n + 1)],
        "baseline": baseline,
        "output_prefix": f"gs://b/results/u/{sid}/",
    }


@pytest.mark.parametrize("site", list(engine.SITE_METRICS))
def test_fixture_result_is_schema_valid_and_site_specific(site):
    result = engine.analyze(_request(site=site))
    assert contract.errors("analysis_result.schema.json", result) == []
    assert [m["id"] for m in result["metrics"]] == list(engine.SITE_METRICS[site])
    assert result["engine_version"].endswith("-fixture")
    assert engine.FIXTURE_WARNING in result["warnings"]
    assert all(m["verdict"] == "no_baseline" and m["delta"] is None for m in result["metrics"])


def test_fixture_is_deterministic_per_session_and_varies_across_sessions():
    a = engine.analyze(_request(sid="s_20261014_aaaa0001"))
    b = engine.analyze(_request(sid="s_20261014_aaaa0001"))
    c = engine.analyze(_request(sid="s_20261014_bbbb0002"))
    assert a == b
    assert [m["value"] for m in a["metrics"]] != [m["value"] for m in c["metrics"]]


def test_fixture_applies_baseline_verdict_rules():
    baseline = {
        "redness": {"mean": 10.0, "mdc95": 0.86},
        "tone_ita": {"mean": 28.4, "mdc95": 50.0},
    }
    result = engine.analyze(_request(site="forearm_treated", baseline=baseline))
    by_id = {m["id"]: m for m in result["metrics"]}
    assert by_id["redness"]["verdict"] == "real_change"
    assert by_id["redness"]["direction"] == "increase"
    assert by_id["redness"]["delta"] == round(by_id["redness"]["value"] - 10.0, 2)
    assert by_id["tone_ita"]["verdict"] == "within_noise"


def test_uncalibrated_single_frame_is_indicative_without_noise_band():
    result = engine.analyze(_request(mode="uncalibrated", n=1))
    assert {m["confidence"] for m in result["metrics"]} == {"indicative"}
    assert all(m["mdc95"] is None for m in result["metrics"])
    assert result["quality"]["card_detected"] is False


def test_invalid_request_is_rejected_before_the_engine():
    bad = _request()
    bad["site"] = "elbow"
    with pytest.raises(engine.EngineError) as err:
        engine.analyze(bad)
    assert err.value.code == "bad_request"


def test_http_mode_maps_engine_errors(monkeypatch):
    class Res:
        status_code = 422
        text = "nope"

        def json(self):
            return {"error": {"code": "frame_unreadable", "message": "cannot decode frame 2"}}

    monkeypatch.setattr(engine.get_settings(), "engine_mode", "http")
    monkeypatch.setattr(engine.get_settings(), "engine_url", "http://localhost:8081")
    monkeypatch.setattr(engine.httpx, "post", lambda *a, **k: Res())
    with pytest.raises(engine.EngineError) as err:
        engine.analyze(_request())
    assert err.value.code == "frame_unreadable"


def test_the_engine_id_token_is_reused_until_it_nears_expiry(monkeypatch):
    import threading

    minted = []
    monkeypatch.setattr(engine, "_id_tokens", {})
    monkeypatch.setattr(
        engine, "_mint_id_token", lambda aud: minted.append(aud) or f"t{len(minted)}"
    )
    threads = [
        threading.Thread(target=engine._id_token, args=("https://engine",)) for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert engine._id_token("https://engine") == "t1" and minted == ["https://engine"]
    # past ID_TOKEN_REUSE_S a fresh one is minted
    monkeypatch.setitem(engine._id_tokens, "https://engine", ("t1", 0.0))
    assert engine._id_token("https://engine") == "t2"
    assert engine.ID_TOKEN_REUSE_S < 3600  # Google ID tokens live an hour
