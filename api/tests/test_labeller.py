from app import gemini, labeller, storage
from app.labeller import BatchLabels, CandidateLabel


def _result(n=3):
    return {
        "site": "face_full",
        "candidates": [
            {
                "id": f"c_{i}",
                "kind": "blemish",
                "crop_uri": storage.object_uri(f"results/u/s/crops/c_{i}.jpg"),
                "context_crop_uri": storage.object_uri(f"results/u/s/crops/c_{i}_ctx.jpg"),
            }
            for i in range(n)
        ],
    }


def _model(monkeypatch, runs):
    """Each call returns the next run's labels for the ids it was asked about."""
    calls = []

    def fake(prompt_id, parts, schema, **kw):
        if prompt_id != "candidate_labels":  # the explanation falls back to its template
            raise gemini.GeminiError("offline in tests")
        asked = [p.split(" ")[1] for p in parts if isinstance(p, str) and p.startswith("Candidate")]
        calls.append(asked)
        table = runs[len(calls) - 1]
        return BatchLabels(labels=[CandidateLabel(id=i, **table[i]) for i in asked if i in table])

    monkeypatch.setattr(gemini, "generate_json", fake)
    monkeypatch.setattr(storage, "read_bytes", lambda name: b"\xff\xd8jpeg")
    return calls


def test_labels_are_kept_only_when_both_runs_agree_confidently(monkeypatch):
    blackhead = {"label": "open_comedone", "confidence": "high", "visible_features": ["dark"]}
    calls = _model(
        monkeypatch,
        [
            {
                "c_0": blackhead,
                "c_1": {"label": "freckle", "confidence": "medium"},
                "c_2": {"label": "mole", "confidence": "low"},
            },
            {
                "c_0": blackhead,
                "c_1": {"label": "post_blemish_mark", "confidence": "high"},
                "c_2": {"label": "mole", "confidence": "high"},
            },
        ],
    )
    out = labeller.label_candidates(_result())
    assert out["c_0"] == {
        "label": "open_comedone",
        "confidence": "high",
        "visible_features": ["dark"],
    }
    assert out["c_1"]["label"] == "uncertain"  # the runs disagree
    assert out["c_2"]["label"] == "uncertain"  # one run was unsure
    assert calls[1] == list(reversed(calls[0]))  # second run sees the reverse order


def test_batches_of_ten_and_banned_words_dropped(monkeypatch):
    same = {
        "label": "papule_pustule",
        "confidence": "medium",
        "visible_features": ["raised", "looks like rosacea"],
    }
    table = {f"c_{i}": same for i in range(12)}
    calls = _model(monkeypatch, [table] * 4)
    out = labeller.label_candidates(_result(12))
    assert sorted(len(c) for c in calls) == [2, 2, 10, 10]
    assert out["c_11"]["visible_features"] == ["raised"]


def test_no_crops_or_no_gemini_means_no_labels(monkeypatch):
    assert labeller.label_candidates(_result()) == {}  # read_bytes is offline in tests
    monkeypatch.setattr(storage, "read_bytes", lambda name: b"x")
    assert labeller.label_candidates(_result()) == {}  # generate_json is offline in tests


def test_analysis_stores_labels_next_to_the_result(client, fake, monkeypatch):
    from app import engine

    def with_candidates(request):
        r = engine.fixture_result(request)
        r["candidates"] = _result(1)["candidates"]
        return r

    monkeypatch.setattr(engine, "analyze", with_candidates)
    _model(monkeypatch, [{"c_0": {"label": "freckle", "confidence": "high"}}] * 2)
    res = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    ).json()
    fake.put(res["upload_urls"][0]["object_uri"].split("/", 3)[3])
    view = client.post(f"/v1/sessions/{res['session_id']}/analyze").json()
    assert view["labels"] == {"c_0": "freckle"}
    assert view["session"]["label_details"]["c_0"]["confidence"] == "high"
