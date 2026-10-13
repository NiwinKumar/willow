import importlib.util
from pathlib import Path


def test_consent_is_stored_and_kept_across_toggles(client, fake):
    res = client.put(
        "/v1/me/consent", json={"version": "2026-10-13", "aggregate_insights_opt_in": False}
    )
    assert res.status_code == 200
    first = res.json()["consent"]["accepted_at"]
    again = client.put(
        "/v1/me/consent", json={"version": "2026-10-13", "aggregate_insights_opt_in": True}
    ).json()
    assert again["consent"]["accepted_at"] == first  # same version: original acceptance kept
    me = client.get("/v1/me").json()
    assert me["consent"]["aggregate_insights_opt_in"] is True
    client.delete("/v1/me")
    assert client.get("/v1/me").json()["consent"] is None


def test_export_includes_only_people_who_opted_in(client, fake):
    from tests.test_analyze_flow import _create, _upload_all

    created = _create(client, n=1)
    _upload_all(fake, created)
    client.post(f"/v1/sessions/{created['session_id']}/analyze")
    path = Path(__file__).resolve().parents[1] / "scripts" / "export_bq.py"
    spec = importlib.util.spec_from_file_location("export_bq", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    assert mod.real_rows(fake.store)["sessions_flat"] == []
    client.put("/v1/me/consent", json={"version": "v", "aggregate_insights_opt_in": True})
    rows = mod.real_rows(fake.store)["sessions_flat"]
    assert rows and all(not r["is_synthetic"] and r["user_hash"].startswith("real_") for r in rows)
    assert "u_test" not in str(rows)
