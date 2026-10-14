"""End-to-end check of the live pipeline: api -> bucket -> engine -> Firestore -> views.

Runs against an api started for local end-to-end work (AUTH_MODE=dev, DEV_UPLOADS=true,
ENGINE_MODE=http, see docs/LOCAL_DEV.md). Everything else is real: uploads land in the bucket,
the deployed engine measures them, Firestore stores them. The test person is deleted at the
start and at the end, so runs never pile up.

    uv run python scripts/e2e.py --dng path/to/forearm.dng --jpeg path/to/forearm.jpg \
        [--face selfie1.jpg selfie2.jpg ...]
"""

import argparse
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import httpx

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}", flush=True)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8080")
    ap.add_argument("--uid", default="e2e_script")
    ap.add_argument("--dng", type=Path, required=True)
    ap.add_argument("--jpeg", type=Path, required=True)
    ap.add_argument("--label", type=Path, help="optional product label photo (calls Gemini)")
    ap.add_argument("--face", type=Path, nargs="*", default=[], help="optional face selfies (JPEG)")
    args = ap.parse_args()

    c = httpx.Client(base_url=args.api, headers={"X-Dev-Uid": args.uid}, timeout=180)

    def session(site: str, mode: str, files: list[Path]) -> dict:
        ct = "image/x-adobe-dng" if mode == "calibrated_raw" else "image/jpeg"
        res = c.post(
            "/v1/sessions",
            json={
                "site": site,
                "capture_mode": mode,
                "n_frames": len(files),
                "content_types": [ct] * len(files),
            },
        )
        res.raise_for_status()
        created = res.json()
        for target, f in zip(created["upload_urls"], files, strict=True):
            put = httpx.put(
                target["url"], content=f.read_bytes(), headers=target["headers"], timeout=180
            )
            put.raise_for_status()
        t0 = time.monotonic()
        res = c.post(f"/v1/sessions/{created['session_id']}/analyze")
        view = res.json() if res.status_code == 200 else {"error": res.text}
        view["_seconds"] = round(time.monotonic() - t0, 1)
        return view

    health = c.get("/v1/health").json()
    check("api is in end-to-end mode", health.get("engine_mode") == "http", str(health))
    check("start clean", c.delete("/v1/me").status_code == 204)

    # 1. First calibrated forearm session, one RAW photo: measured, becomes the baseline.
    v1 = session("forearm_control", "calibrated_raw", [args.dng])
    r1 = v1.get("result") or {}
    check(
        "RAW forearm is measured by the real engine",
        v1.get("session", {}).get("measured") is True
        and not r1.get("engine_version", "").endswith(("-fixture", "-placeholder")),
        f"engine {r1.get('engine_version')}, {v1['_seconds']} s",
    )
    check("frames_used matches the upload", r1.get("frames_used") == 1, str(r1.get("frames_used")))
    ids = {m["id"] for m in r1.get("metrics", [])}
    check("tone and redness measured", {"tone_ita", "redness"} <= ids, str(sorted(ids)))
    check("first session is the baseline", v1["session"]["is_baseline"] is True)
    check(
        "one-photo baseline has no noise band", v1["session"]["baseline"]["has_noise_band"] is False
    )
    check(
        "first reading has no verdicts",
        {m["verdict"] for m in r1["metrics"]} <= {"no_baseline", "low_quality"},
    )

    # 2. A second RAW session: compared with the baseline, but no verdict without a noise band.
    v2 = session("forearm_control", "calibrated_raw", [args.dng])
    r2 = v2.get("result") or {}
    check(
        "second session is compared, not a new baseline",
        v2["session"]["is_baseline"] is False
        and v2["session"]["baseline"]["session_id"] == v1["session"]["id"],
    )
    check(
        "deltas present, no real-change claims without a noise band",
        all(m["delta"] is not None for m in r2["metrics"] if m["verdict"] != "low_quality")
        and "real_change" not in {m["verdict"] for m in r2["metrics"]},
    )

    # 3. A quick selfie of the same site gets its own baseline (never compared with RAW).
    v3 = session("forearm_control", "uncalibrated", [args.jpeg])
    r3 = v3.get("result") or {}
    check(
        "quick selfie is measured",
        v3["session"].get("measured") is True,
        f"{v3['_seconds']} s, confidence {sorted({m['confidence'] for m in r3['metrics']})}",
    )
    check("quick selfie has its own baseline", v3["session"]["is_baseline"] is True)

    # 4. A forearm photo sent as a face: measured, no face found, never a baseline.
    v4 = session("face_full", "calibrated_raw", [args.dng])
    r4 = v4.get("result") or {}
    check(
        "a photo without a face is measured as 'no face found'",
        v4["session"].get("measured") is True
        and r4.get("quality", {}).get("passed") is False
        and "face_not_found" in r4.get("quality", {}).get("reasons", [])
        and v4["session"]["is_baseline"] is False,
        str(r4.get("quality", {}).get("reasons")),
    )
    n_sessions = 4

    # 4b. Real face selfies: five face metrics, spots with crops, Gemini names, the right photo.
    if args.face:
        v5 = session("face_full", "uncalibrated", args.face)
        r5 = v5.get("result") or {}
        n_sessions += 1
        ids5 = {m["id"] for m in r5.get("metrics", []) if m.get("value") is not None}
        check(
            "face selfies are measured",
            v5["session"].get("measured") is True and r5.get("frames_used", 0) >= 1,
            f"{r5.get('frames_used')} of {len(args.face)} used, {v5['_seconds']} s",
        )
        want = {"tone_ita", "pigment_spots", "tone_evenness", "redness", "blemishes"}
        check("five face metrics", want <= ids5, str(sorted(ids5)))
        check("face selfie is its own baseline", v5["session"]["is_baseline"] is True)
        cands = r5.get("candidates") or []
        check(
            "spots come with crops",
            bool(cands) and all(x.get("crop_uri") and x.get("context_crop_uri") for x in cands),
            f"{len(cands)} spots",
        )
        details = v5["session"].get("label_details") or {}
        check(
            "Gemini named spots (both looks agree, or 'uncertain')",
            bool(details) and set(details) <= {x["id"] for x in cands},
            f"{len(details)} named",
        )
        # The engine writes preview.jpg of the photo the rings and regions describe.
        preview = unquote((v5["session"].get("preview") or {}).get("url", ""))
        check(
            "the photo shown is the engine's preview of the measured photo",
            "/preview.jpg" in preview and bool(r5.get("image_size")),
            preview.rsplit("/", 1)[-1][:40],
        )
        check("face explanation by Gemini", v5["session"].get("explanation_source") == "gemini")

    # 5. Reads the web uses.
    listed = c.get("/v1/sessions").json()["sessions"]
    check("sessions list has all of them", len(listed) == n_sessions, str(len(listed)))
    tl = c.get("/v1/timeline", params={"site": "forearm_control"}).json()
    check(
        "timeline has two RAW and one quick reading",
        len(tl["metrics"].get("redness", [])) == 3
        and tl["baseline_session_ids"]["uncalibrated"] == v3["session"]["id"],
    )
    cat = c.get("/v1/catalog/search", params={"q": "niacinamide"}).json()["products"]
    check(
        "catalog search returns products with images",
        len(cat) > 0 and all(p.get("image_url") for p in cat),
        f"{len(cat)} found",
    )

    # 6. Gemini: explanation on a measured session, routine check, advisor.
    check(
        "explanation present on a measured session",
        bool(v2.get("explanation"))
        and v2["session"]["explanation_source"] in ("gemini", "template"),
        str(v2["session"].get("explanation_source")),
    )
    for pid in (
        "minimalist-retinol-0-3-face-serum",
        "paulas-choice-skin-perfecting-2-bha-liquid-exfoliant",
    ):
        c.post("/v1/routine", json={"product_id": pid, "slots": ["pm"], "source": "catalog"})
    t0 = time.monotonic()
    rc = c.post("/v1/routine/check").json()
    rule = [x for x in rc.get("conflicts", []) if x["source"] == "rule"]
    check(
        "routine check flags retinoid + BHA and the missing sunscreen",
        len(rule) >= 1 and any("sunscreen" in g["need"].lower() for g in rc.get("gaps", [])),
        f"{len(rc.get('conflicts', []))} conflicts, {round(time.monotonic() - t0, 1)} s",
    )
    t0 = time.monotonic()
    adv = c.post(
        "/v1/advisor/chat",
        json={
            "messages": [
                {"role": "user", "text": "Which sunscreen under 1000 INR would suit my routine?"}
            ]
        },
    )
    body = adv.json() if adv.status_code == 200 else {}
    check(
        "advisor answers from the catalog",
        adv.status_code == 200
        and bool(body.get("message"))
        and all(p.get("image_url") for p in body.get("products", [])),
        f"{round(time.monotonic() - t0, 1)} s, {len(body.get('products', []))} products, "
        f"{body.get('retrieval')}",
    )
    if body.get("message"):
        print("      advisor:", body["message"][:300])

    ins = httpx.get(f"{args.api}/v1/retailer/insights", timeout=60)
    body = ins.json() if ins.status_code == 200 else {}
    check(
        "retailer insights from BigQuery, small groups suppressed",
        ins.status_code == 200
        and body["cohort"]["synthetic"] > 0
        and all(p["n"] >= 10 for p in body["products"]),
        f"{len(body.get('products', []))} products, {len(body.get('brands', []))} brands",
    )

    ask = c.post("/v1/retailer/ask", json={"question": "Which routine problems are most common?"})
    body = ask.json() if ask.status_code == 200 else {}
    check(
        "retailer question answered by Gemini, numbers checked",
        ask.status_code == 200 and body.get("checks") is not None,
        f"{(body.get('checks') or {}).get('numbers_checked')} numbers, "
        f"chart: {bool(body.get('chart'))}",
    )

    # 8. Judge mode: status, a sample run in this account, the routine setup.
    st = httpx.get(f"{args.api}/v1/demo/status", timeout=60).json()
    check(
        "judge status: engine and BigQuery up",
        st["engine"]["status"] == "ok" and st["bigquery"]["status"] == "ok",
        f"engine {st['engine'].get('version')}",
    )
    samples = httpx.get(f"{args.api}/v1/demo/samples", timeout=30).json()["samples"]
    if check("hosted samples listed", bool(samples), ", ".join(x["id"] for x in samples)):
        started = c.post(f"/v1/demo/samples/{samples[0]['id']}/session")
        sv = c.post(f"/v1/sessions/{started.json()['session_id']}/analyze").json()
        check(
            "sample run measured in the judge's own account",
            sv.get("session", {}).get("sample_id") == samples[0]["id"]
            and sv["session"]["status"] == "done"
            and bool(sv["session"].get("preview")),
            f"explanation: {sv['session'].get('explanation_source')}",
        )

    # 9. Pick a different baseline by hand.
    res = c.post("/v1/baselines/forearm_control", json={"session_id": v2["session"]["id"]})
    check(
        "make this my baseline",
        res.status_code == 200 and res.json()["session_id"] == v2["session"]["id"],
        res.text[:120],
    )

    if args.label:
        import base64

        data = base64.b64encode(args.label.read_bytes()).decode()
        res = c.post(
            "/v1/label-scan", json={"images": [{"mime_type": "image/jpeg", "data_base64": data}]}
        )
        body = res.json() if res.status_code == 200 else {}
        check(
            "label scan reads the pack",
            bool(body.get("scan", {}).get("inci")),
            str(body.get("match")),
        )

    check("delete my data", c.delete("/v1/me").status_code == 204)
    check("nothing left", c.get("/v1/sessions").json()["sessions"] == [])

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
