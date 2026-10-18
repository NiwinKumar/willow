import base64

import pytest

from app import catalog, product_requests, storage

CATALOG = (
    {
        "product_id": "cosrx-snail-96",
        "brand": "COSRX",
        "name": "Advanced Snail 96 Mucin Power Essence",
        "category": "serum",
        "concerns": ["dryness_barrier"],
        "key_actives": [],
        "inci": [],
        "price": {"amount": 25, "currency": "USD"},
        "stores": [],
    },
)
PHOTO = {"mime_type": "image/jpeg", "data_base64": base64.b64encode(b"jpeg").decode()}


@pytest.fixture(autouse=True)
def small_catalog(monkeypatch):
    monkeypatch.setattr(catalog, "products", lambda: CATALOG)


@pytest.fixture
def photos(monkeypatch):
    kept: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "put_bytes", lambda name, data, ct: kept.__setitem__(name, data))
    monkeypatch.setattr(storage, "delete_object", lambda name: kept.pop(name, None))
    return kept


def test_a_request_needs_a_name_and_brand_or_a_photo(client, fake, photos):
    assert client.post("/v1/product-requests", json={"brand": "Anua"}).status_code == 422
    res = client.post("/v1/product-requests", json={"photo": PHOTO})
    assert res.status_code == 201, res.text
    assert res.json()["has_photo"] is True and res.json()["status"] == "pending"
    assert list(photos) == [f"requests/u_test/{res.json()['id']}.jpg"]


def test_a_product_already_in_the_catalog_is_offered_instead(client, fake):
    res = client.post(
        "/v1/product-requests",
        json={"brand": "cosrx", "name": "Advanced Snail 96 Mucin Power Essence"},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["product"]["product_id"] == "cosrx-snail-96"


def test_everyone_who_asked_is_counted_once_and_hears_back(client, fake, photos):
    body = {"brand": "Anua", "name": "Heartleaf 77% Soothing Toner", "photo": PHOTO}
    first = client.post("/v1/product-requests", json=body).json()
    again = client.post("/v1/product-requests", json=body).json()
    other = client.post("/v1/product-requests", json=body, headers={"X-Dev-Uid": "u_other"}).json()
    assert (first["askers"], again["askers"], other["askers"]) == (1, 1, 2)

    key = product_requests.key_of("Anua", "Heartleaf 77% Soothing Toner")
    with pytest.raises(ValueError):
        product_requests.resolve(fake.store, key, "added", "not-in-catalog")
    uids = product_requests.resolve(fake.store, key, "added", "cosrx-snail-96")
    assert sorted(uids) == ["u_other", "u_test"]
    assert photos == {}  # the photos go once the request is answered

    mine = client.get("/v1/product-requests").json()["requests"]
    assert {r["status"] for r in mine} == {"added"}
    assert mine[0]["product"]["product_id"] == "cosrx-snail-96" and mine[0]["seen"] is False
    assert (
        client.patch(f"/v1/product-requests/{mine[0]['id']}", json={"seen": True}).status_code
        == 204
    )
    assert client.patch("/v1/product-requests/nope", json={"seen": True}).status_code == 404


def test_deleting_an_account_removes_the_person_from_requests(client, fake, photos):
    client.post("/v1/product-requests", json={"brand": "Anua", "name": "Toner"})
    fake.store.delete_user("u_test")
    ((key, wish),) = fake.store.product_wishes()
    assert wish["requesters"] == [] and wish["count"] == 0
    assert fake.store.product_requests_of("u_test") == []
