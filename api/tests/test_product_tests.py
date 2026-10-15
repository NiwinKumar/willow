"""Product tests: start, list, change length, end, resume, delete."""

from datetime import timedelta

from app import routine_log


def _day(offset: int = 0) -> str:
    return (routine_log.today() + timedelta(days=offset)).isoformat()


def test_start_from_a_routine_product(client, fake):
    entry = client.post(
        "/v1/routine",
        json={"product_id": "the-ordinary-niacinamide-10-zinc-1", "slots": ["pm"]},
    ).json()
    res = client.post("/v1/product-tests", json={"entry_id": entry["id"]})
    assert res.status_code == 200, res.text
    test = res.json()
    assert test["id"].startswith("pt_")
    assert test["entry_id"] == entry["id"]
    assert test["product_id"] == "the-ordinary-niacinamide-10-zinc-1"
    assert test["name"] == "Niacinamide 10% + Zinc 1%"
    assert test["site_pair"] == "forearm"
    assert test["length_days"] == 28
    assert test["started_at"] == _day() and test["ended_at"] is None
    assert client.get("/v1/product-tests").json()["tests"] == [test]


def test_start_a_named_test_and_validation(client, fake):
    assert client.post("/v1/product-tests", json={}).status_code == 422  # nothing named
    assert client.post("/v1/product-tests", json={"name": "x", "length_days": 6}).status_code == 422
    assert (
        client.post("/v1/product-tests", json={"name": "x", "length_days": 57}).status_code == 422
    )
    assert (
        client.post("/v1/product-tests", json={"name": "x", "started_at": _day(5)}).status_code
        == 422
    )
    assert client.post("/v1/product-tests", json={"entry_id": "r_nope"}).status_code == 404
    assert client.post("/v1/product-tests", json={"product_id": "nope"}).status_code == 404
    res = client.post(
        "/v1/product-tests",
        json={"name": " Self-tanner ", "length_days": 14, "started_at": _day(-3)},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Self-tanner"
    assert res.json()["product_id"] is None and res.json()["entry_id"] is None
    assert res.json()["started_at"] == _day(-3)


def test_one_test_runs_at_a_time_and_ending_frees_the_arms(client, fake):
    first = client.post("/v1/product-tests", json={"name": "Self-tanner"}).json()
    again = client.post("/v1/product-tests", json={"name": "Serum"})
    assert again.status_code == 409

    longer = client.patch(f"/v1/product-tests/{first['id']}", json={"length_days": 42})
    assert longer.json()["length_days"] == 42
    assert (
        client.patch(f"/v1/product-tests/{first['id']}", json={"length_days": 3}).status_code == 422
    )
    early = client.patch(f"/v1/product-tests/{first['id']}", json={"ended_at": _day(-1)})
    assert early.status_code == 422  # before it started
    ended = client.patch(f"/v1/product-tests/{first['id']}", json={"ended_at": _day()}).json()
    assert ended["ended_at"] == _day()

    second = client.post("/v1/product-tests", json={"name": "Serum"})
    assert second.status_code == 200
    # the running test is listed first
    assert [t["name"] for t in client.get("/v1/product-tests").json()["tests"]] == [
        "Serum",
        "Self-tanner",
    ]
    # resuming the first while the second runs is refused
    resume = client.patch(f"/v1/product-tests/{first['id']}", json={"ended_at": None})
    assert resume.status_code == 409


def test_delete_and_unknown_ids(client, fake):
    test = client.post("/v1/product-tests", json={"name": "Self-tanner"}).json()
    assert client.patch("/v1/product-tests/pt_00000000", json={"name": "x"}).status_code == 404
    assert client.patch("/v1/product-tests/../../x", json={"name": "x"}).status_code == 404
    assert client.delete(f"/v1/product-tests/{test['id']}").status_code == 204
    assert client.get("/v1/product-tests").json()["tests"] == []


def test_delete_my_data_removes_product_tests(client, fake):
    client.post("/v1/product-tests", json={"name": "Self-tanner"})
    assert client.delete("/v1/me").status_code == 204
    assert fake.store.product_tests == {}


def test_tests_are_private_to_each_person(client, fake):
    client.post("/v1/product-tests", json={"name": "Self-tanner"})
    other = client.get("/v1/product-tests", headers={"X-Dev-Uid": "u_other"})
    assert other.json()["tests"] == []
