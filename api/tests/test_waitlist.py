import pytest

from app import survey
from app.store import MemoryStore, get_store


@pytest.fixture
def store():
    from app.main import app

    s = MemoryStore()
    app.dependency_overrides[get_store] = lambda: s
    survey._seen.clear()
    yield s
    app.dependency_overrides.pop(get_store, None)


def test_an_email_joins_once_keyed_by_its_hash(client, store):
    res = client.post("/v1/waitlist", json={"email": "  Asha@Example.com ", "source": "ig"})
    assert res.status_code == 201, res.text
    assert res.json() == {"ok": True, "already": False}
    [(key, doc)] = store.waitlist.items()
    assert doc["email"] == "asha@example.com" and doc["source"] == "ig"
    assert "asha" not in key  # the id is a hash, not the address

    again = client.post("/v1/waitlist", json={"email": "asha@example.com"})
    assert again.status_code == 201 and again.json() == {"ok": True, "already": True}
    assert len(store.waitlist) == 1


def test_a_bad_email_is_refused(client, store):
    res = client.post("/v1/waitlist", json={"email": "not-an-email"})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "bad_email"
    assert store.waitlist == {}


def test_the_honeypot_is_dropped_quietly(client, store):
    res = client.post("/v1/waitlist", json={"email": "bot@example.com", "website": "x"})
    assert res.status_code == 201 and store.waitlist == {}


def test_one_address_is_capped_per_day(client, store):
    for i in range(survey.PER_ADDRESS):
        assert client.post("/v1/waitlist", json={"email": f"p{i}@example.com"}).status_code == 201
    res = client.post("/v1/waitlist", json={"email": "late@example.com"})
    assert res.status_code == 429 and res.json()["detail"]["code"] == "daily_limit"
