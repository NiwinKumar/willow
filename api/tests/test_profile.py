"""PUT /v1/me/profile and the profile in GET /v1/me (CONTRACT section 4 users/{uid}.profile)."""

import importlib.util
from pathlib import Path

import pytest


def test_me_has_no_profile_until_one_is_saved(client, fake):
    assert client.get("/v1/me").json()["profile"] is None


def test_partial_updates_merge(client, fake):
    res = client.put("/v1/me/profile", json={"goals": ["dark_spots", "redness"]})
    assert res.status_code == 200
    first = res.json()["profile"]
    assert first["goals"] == ["dark_spots", "redness"]
    assert first["photo_time"] is None and first["checkin"] is None and first["updated_at"]

    checkin = {"days": [4, 0, 2, 2], "time": "21:30", "tz": "Asia/Kolkata"}
    client.put("/v1/me/profile", json={"photo_time": "evening", "checkin": checkin})
    client.put("/v1/me/profile", json={"skin_type": "combination", "display_name": "  Asha  K "})
    profile = client.get("/v1/me").json()["profile"]
    assert profile["goals"] == ["dark_spots", "redness"]  # untouched by later updates
    assert profile["photo_time"] == "evening"
    assert profile["skin_type"] == "combination"
    assert profile["display_name"] == "Asha K"
    assert profile["checkin"] == {"days": [0, 2, 4], "time": "21:30", "tz": "Asia/Kolkata"}

    # null clears one field; goals null means none
    client.put("/v1/me/profile", json={"checkin": None, "goals": None, "display_name": ""})
    profile = client.get("/v1/me").json()["profile"]
    assert profile["checkin"] is None and profile["goals"] == [] and profile["display_name"] is None
    assert profile["skin_type"] == "combination"


def test_duplicate_goals_collapse(client, fake):
    res = client.put("/v1/me/profile", json={"goals": ["lines", "lines", "under_eye"]})
    assert res.json()["profile"]["goals"] == ["lines", "under_eye"]


@pytest.mark.parametrize(
    "body",
    [
        {"goals": ["clearer"]},  # an old local id
        # more than 5
        {"goals": ["dark_spots", "even_tone", "redness", "lines", "blemishes", "under_eye"]},
        {"photo_time": "night"},
        {"skin_type": "very_dry"},
        {"display_name": "x" * 61},
        {"checkin": {"days": [7], "time": "08:00", "tz": "UTC"}},
        {"checkin": {"days": [], "time": "08:00", "tz": "UTC"}},
        {"checkin": {"days": [1], "time": "24:00", "tz": "UTC"}},
        {"checkin": {"days": [1], "time": "8:00", "tz": "UTC"}},
        {"checkin": {"days": [1], "time": "08:00", "tz": "Mars/Olympus"}},
        {"checkin": {"days": [1], "time": "08:00"}},
        {"tone": "light"},  # unknown field
    ],
)
def test_invalid_profiles_are_rejected(client, fake, body):
    res = client.put("/v1/me/profile", json=body)
    assert res.status_code == 422, body
    assert client.get("/v1/me").json()["profile"] is None


def test_delete_me_removes_the_profile(client, fake):
    client.put("/v1/me/profile", json={"goals": ["blemishes"]})
    client.delete("/v1/me")
    assert client.get("/v1/me").json()["profile"] is None


def test_hide_sponsored_defaults_off_and_merges(client, fake):
    profile = client.put("/v1/me/profile", json={"goals": ["redness"]}).json()["profile"]
    assert profile["hide_sponsored"] is False
    client.put("/v1/me/profile", json={"hide_sponsored": True})
    client.put("/v1/me/profile", json={"skin_type": "dry"})  # later updates keep it
    profile = client.get("/v1/me").json()["profile"]
    assert profile["hide_sponsored"] is True and profile["goals"] == ["redness"]
    client.put("/v1/me/profile", json={"hide_sponsored": None})  # null: back to the default
    assert client.get("/v1/me").json()["profile"]["hide_sponsored"] is False
    assert client.put("/v1/me/profile", json={"hide_sponsored": "maybe"}).status_code == 422


def test_export_carries_real_goals_and_skin_type(client, fake):
    from tests.test_analyze_flow import _create, _upload_all

    created = _create(client, n=1)
    _upload_all(fake, created)
    client.post(f"/v1/sessions/{created['session_id']}/analyze")
    client.put("/v1/me/consent", json={"version": "v", "aggregate_insights_opt_in": True})
    client.put("/v1/me/profile", json={"goals": ["oil_glow", "dark_spots"], "skin_type": "oily"})
    path = Path(__file__).resolve().parents[1] / "scripts" / "export_bq.py"
    spec = importlib.util.spec_from_file_location("export_bq", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    rows = mod.real_rows(fake.store)["sessions_flat"]
    assert rows
    # goal ids as the app stores them (retail reads ids and concerns alike), with skin type
    assert all(r["goals"] == ["oil_glow", "dark_spots"] and r["skin_type"] == "oily" for r in rows)


def test_places_to_track_keep_their_order_and_clear_with_null(client, fake):
    first = client.put("/v1/me/profile", json={"goals": ["redness"]}).json()["profile"]
    assert first["track"] is None
    res = client.put("/v1/me/profile", json={"track": ["cheek_macro", "face_full", "cheek_macro"]})
    assert res.status_code == 200
    assert res.json()["profile"]["track"] == ["cheek_macro", "face_full"]
    assert client.get("/v1/me").json()["profile"]["goals"] == ["redness"]  # untouched
    client.put("/v1/me/profile", json={"track": None})
    assert client.get("/v1/me").json()["profile"]["track"] is None


@pytest.mark.parametrize("track", [[], ["left_cheek_macro"], ["moon"]])
def test_places_to_track_refuse_none_or_a_place_the_camera_lacks(client, fake, track):
    assert client.put("/v1/me/profile", json={"track": track}).status_code == 422
