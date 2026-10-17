"""Close-ups of one place (left cheek, right cheek, forehead, chin) and RAW being for
close-ups and forearms only: a whole face is taken as quick photos."""

import typing

import pytest

from app import advisor_blocks, engine, explain
from app.models import RAW_SITES, Site

NEW = ("left_cheek_macro", "right_cheek_macro", "forehead_macro", "chin_macro")


def _create(client, site, mode, n=1):
    ct = "image/x-adobe-dng" if mode == "calibrated_raw" else "image/jpeg"
    return client.post(
        "/v1/sessions",
        json={"site": site, "capture_mode": mode, "n_frames": n, "content_types": [ct] * n},
    )


def test_a_raw_whole_face_is_refused(client, fake):
    res = _create(client, "face_full", "calibrated_raw")
    assert res.status_code == 422
    assert "quick photos" in res.json()["detail"]["message"]
    assert _create(client, "face_full", "uncalibrated").status_code == 200


@pytest.mark.parametrize("site", [*NEW, "nose_macro", "cheek_macro", "forearm_treated"])
def test_raw_takes_every_close_up_and_the_forearms(client, fake, site):
    assert _create(client, site, "calibrated_raw").status_code == 200


@pytest.mark.parametrize("site", NEW)
def test_a_close_up_of_one_place_runs_like_a_cheek_close_up(client, fake, site):
    created = _create(client, site, "calibrated_raw", n=3).json()
    for target in created["upload_urls"]:
        fake.put(target["object_uri"].split("/", 3)[3])
    view = client.post(f"/v1/sessions/{created['session_id']}/analyze").json()
    assert view["result"]["site"] == site
    ids = [m["id"] for m in view["result"]["metrics"]]
    assert ids == list(engine.SITE_METRICS["cheek_macro"])


def test_every_site_has_its_metrics_retake_advice_and_advisor_name():
    sites = set(typing.get_args(Site))
    assert sites == set(engine.SITE_METRICS) == set(advisor_blocks.SITES)
    assert sites == set(explain.RETAKE)
    assert sites - {"face_full"} == RAW_SITES
