def test_health(client):
    res = client.get("/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "willow-api"
    assert body["engine_mode"] == "fixture"


def test_public_data_is_cacheable_and_large_bodies_are_compressed(client, monkeypatch):
    from app import retailer

    monkeypatch.setattr(retailer, "insights", lambda: {"rows": ["x" * 50] * 100})
    res = client.get("/v1/retailer/insights", headers={"Accept-Encoding": "gzip"})
    assert res.headers["Cache-Control"] == "public, max-age=300"
    assert res.headers["Content-Encoding"] == "gzip"
    pre = client.options(
        "/v1/sessions",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert pre.headers["Access-Control-Max-Age"] == "7200"
