def test_healthz(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "willow-api"
    assert body["engine_mode"] == "fixture"
