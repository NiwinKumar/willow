import base64
import csv
import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

from app import catalog, gemini, label_scan

CATALOG = (
    {
        "product_id": "the-ordinary-niacinamide-10-zinc-1",
        "brand": "The Ordinary",
        "name": "Niacinamide 10% + Zinc 1%",
        "category": "serum",
        "concerns": ["acne_blemishes", "oiliness_shine", "texture_pores"],
        "key_actives": [{"name": "niacinamide", "pct": 10}, {"name": "zinc pca", "pct": 1}],
        "inci": ["Aqua (Water)", "Niacinamide", "Pentylene Glycol", "Zinc PCA"],
        "price": {"amount": 590, "currency": "INR"},
        "size": "30 ml",
        "region": ["IN", "GLOBAL"],
        "stores": [
            {
                "store": "Nykaa",
                "url": "https://www.nykaa.com/x",
                "region": "IN",
                "price": {"amount": 590, "currency": "INR", "checked": "2026-10-15"},
            },
            {"store": "Ulta", "url": "https://www.ulta.com/x", "region": "US", "price": None},
        ],
        "source_url": "https://theordinary.com/x",
        "last_verified": "2026-10-13",
    },
    {
        "product_id": "minimalist-salicylic-acid-2-face-serum",
        "brand": "Minimalist",
        "name": "Salicylic Acid 2% Face Serum",
        "category": "exfoliant",
        "concerns": ["acne_blemishes", "texture_pores"],
        "key_actives": [{"name": "salicylic acid", "pct": 2}],
        "inci": ["Aqua", "Salicylic Acid", "Fragrance"],
        "price": {"amount": 545, "currency": "INR"},
        "size": "30 ml",
        "region": ["IN"],
        "stores": [
            {
                "store": "Brand site",
                "url": "https://beminimalist.co/x",
                "region": "IN",
                "price": {"amount": 545.5, "currency": "INR", "checked": "2026-10-15"},
            }
        ],
        "source_url": "https://beminimalist.co/x",
        "last_verified": "2026-10-13",
    },
)


@pytest.fixture(autouse=True)
def small_catalog(monkeypatch):
    monkeypatch.setattr(catalog, "products", lambda: CATALOG)


def test_search_filters_by_concern_price_query_and_excluded_ingredients(client, fake):
    found = client.get("/v1/catalog/search", params={"concern": "acne_blemishes"}).json()
    assert [p["product_id"] for p in found["products"]] == [
        "minimalist-salicylic-acid-2-face-serum",  # cheaper first
        "the-ordinary-niacinamide-10-zinc-1",
    ]
    cheap = client.get("/v1/catalog/search", params={"max_price": 550, "currency": "INR"}).json()
    assert len(cheap["products"]) == 1
    by_name = client.get("/v1/catalog/search", params={"q": "niacinamide"}).json()
    assert by_name["products"][0]["brand"] == "The Ordinary"
    assert catalog.search(concern="acne_blemishes", exclude_ingredients=["fragrance"]) == [
        CATALOG[0]
    ]
    assert client.get("/v1/catalog/search", params={"concern": "glowing"}).status_code == 422


def test_match_needs_the_same_brand_and_a_close_name():
    hit = catalog.match("The Ordinary", "Niacinamide 10% + Zinc 1% serum")
    assert hit and hit[0]["product_id"] == "the-ordinary-niacinamide-10-zinc-1"
    assert catalog.match("Some Other Brand", "Niacinamide 10% + Zinc 1%") is None
    assert catalog.match("The Ordinary", "Hyaluronic Acid 2% + B5") is None
    assert catalog.match(None, "x") is None


def _png_b64() -> str:
    return base64.b64encode(b"\x89PNG\r\n\x1a\n fake").decode()


def test_label_scan_returns_the_reading_and_a_catalog_match(client, fake, monkeypatch):
    seen = {}

    def fake_generate(prompt_id, contents, schema, **kw):
        seen["prompt_id"] = prompt_id
        seen["n_images"] = sum(1 for c in contents if not isinstance(c, str))
        return schema(
            brand="The Ordinary",
            product_name="Niacinamide 10% + Zinc 1%",
            category="serum",
            inci=["Aqua (Water)", "Niacinamide"],
            key_actives=[{"name": "niacinamide", "pct": 10}],
            confidence="high",
        )

    monkeypatch.setattr(gemini, "generate_json", fake_generate)
    res = client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}]}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert seen == {"prompt_id": "label_scan", "n_images": 1}
    assert body["scan"]["brand"] == "The Ordinary"
    assert body["match"]["product_id"] == "the-ordinary-niacinamide-10-zinc-1"


def test_label_scan_failure_is_a_clear_error(client, fake, monkeypatch):
    def fail(*a, **k):
        raise gemini.GeminiError("schema")

    monkeypatch.setattr(gemini, "generate_json", fail)
    res = client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}]}
    )
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "label_scan_failed"
    too_many = client.post(
        "/v1/label-scan",
        json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}] * 3},
    )
    assert too_many.status_code == 422


def test_label_scan_model_rejects_unknown_categories():
    with pytest.raises(ValueError):
        label_scan.LabelScan(brand="x", product_name="y", category="perfume", confidence="low")


def test_routine_add_from_catalog_custom_stop_and_delete(client, fake):
    added = client.post(
        "/v1/routine",
        json={
            "product_id": "the-ordinary-niacinamide-10-zinc-1",
            "slots": ["pm"],
            "source": "catalog",
            "started_at": "2026-10-01",
            "custom_name": "typed",
        },
    )
    assert added.status_code == 200, added.text
    entry = added.json()
    assert entry["custom_name"] == "Niacinamide 10% + Zinc 1%"  # catalog facts win
    assert entry["inci"] == CATALOG[0]["inci"]
    assert entry["started_at"] == "2026-10-01" and entry["ended_at"] is None

    custom = client.post(
        "/v1/routine",
        json={"custom_name": "Grandma's rose water", "brand": "", "source": "manual"},
    )
    assert custom.status_code == 200
    assert client.post("/v1/routine", json={"source": "manual"}).status_code == 422
    assert client.post("/v1/routine", json={"product_id": "nope"}).status_code == 404

    stopped = client.patch(f"/v1/routine/{entry['id']}", json={"ended_at": "2026-10-14"})
    assert stopped.json()["ended_at"] == "2026-10-14"

    listed = client.get("/v1/routine").json()["entries"]
    assert [e["started_at"] for e in listed][0] == "2026-10-01"
    assert len(listed) == 2

    assert client.delete(f"/v1/routine/{custom.json()['id']}").status_code == 204
    assert len(client.get("/v1/routine").json()["entries"]) == 1


def test_import_script_round_trips_the_sheet(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts" / "import_catalog.py"
    spec = importlib.util.spec_from_file_location("import_catalog", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    rows = [mod.to_row(p) for p in CATALOG]
    csv_path = tmp_path / "catalog.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=mod.COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    with open(csv_path, newline="") as f:
        back = [mod.from_row(r) for r in csv.DictReader(f)]
    for original, parsed in zip(CATALOG, back, strict=True):
        assert parsed["key_actives"] == [
            {"name": a["name"], "pct": float(a["pct"])} for a in original["key_actives"]
        ]
        assert parsed["inci"] == original["inci"]
        assert parsed["stores"] == original["stores"]
        assert mod.validate(parsed) == []
    broken = dict(back[0], category="perfume", stores=[])
    assert mod.validate(broken) == ["category 'perfume'", "no store links"]
    bad_price = dict(
        back[0],
        stores=[dict(back[0]["stores"][0], price={"amount": 0, "currency": "rs", "checked": "x"})],
    )
    assert mod.validate(bad_price) == ["store price 'Nykaa' (amount > 0, ISO currency, YYYY-MM-DD)"]
    linked = dict(back[0], image_url="https://brand.example/p.jpg", image_source=None)
    assert mod.validate(linked) == ["image_source (the page the image is shown on)"]
    assert (
        mod.from_row(mod.to_row(dict(linked, image_source="https://brand.example/p")))["image_url"]
        == "https://brand.example/p.jpg"
    )


def test_tidy_strips_list_punctuation():
    raw = label_scan.LabelScan(
        brand="The Ordinary.",
        product_name=" Niacinamide 10% + Zinc 1% ",
        category="serum",
        inci=["Aqua (Water)", "Chlorphenesin.", " "],
        key_actives=[{"name": "Zinc PCA", "pct": 1}],
        confidence="high",
    )
    clean = label_scan.tidy(raw)
    assert clean.brand == "The Ordinary"
    assert clean.product_name == "Niacinamide 10% + Zinc 1%"
    assert [i.name for i in clean.inci] == ["Aqua (Water)", "Chlorphenesin"]
    assert clean.key_actives[0].name == "zinc pca"


def test_failed_scans_are_refunded_and_bad_photos_are_a_clear_error(client, fake, monkeypatch):
    from datetime import UTC, datetime

    def fail(*a, **k):
        raise gemini.GeminiError("schema")

    monkeypatch.setattr(gemini, "generate_json", fail)
    client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}]}
    )
    bad = client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": "%%%"}]}
    )
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "bad_image"
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_incr("u_test", day, "label_scan", 0) == 0


def test_a_future_start_date_is_refused(client, fake):
    res = client.post(
        "/v1/routine",
        json={"custom_name": "Serum", "slots": ["pm"], "started_at": "2099-01-01"},
    )
    assert res.status_code == 422


def test_browsing_the_catalog_lists_every_currency(client, fake):
    found = client.get("/v1/catalog/search", params={"limit": 60}).json()["products"]
    names = [f"{p['brand']} {p['name']}".lower() for p in found]
    assert names == sorted(names)


def test_store_prices_come_back_from_search_and_product(client, fake):
    found = client.get("/v1/catalog/search", params={"q": "niacinamide"}).json()["products"][0]
    nykaa = {"amount": 590, "currency": "INR", "checked": "2026-10-15"}
    assert found["stores"][0]["price"] == nykaa
    assert found["stores"][1]["price"] is None
    one = client.get("/v1/catalog/minimalist-salicylic-acid-2-face-serum").json()
    assert one["stores"][0]["price"]["amount"] == 545.5


def test_every_real_store_price_is_a_checked_amount_in_a_currency():
    """The bundled catalog: each store price is real (> 0, ISO currency, a date) or null."""
    real = json.loads(catalog.CATALOG_PATH.read_text())  # not the small fixture catalog
    stores = [s for p in real for s in p["stores"]]
    assert stores and all("price" in s for s in stores)
    priced = [s["price"] for s in stores if s["price"] is not None]
    assert priced
    for price in priced:
        catalog.StorePrice.model_validate(price)
        assert price["amount"] > 0
        assert len(price["currency"]) == 3 and price["currency"].isupper()
        date.fromisoformat(price["checked"])
    with pytest.raises(ValueError):
        catalog.StorePrice.model_validate({"amount": 0, "currency": "INR", "checked": "2026-10-15"})
    with pytest.raises(ValueError):
        catalog.StorePrice.model_validate({"amount": 5, "currency": "Rs", "checked": "2026-10-15"})
    with pytest.raises(ValueError):
        catalog.StorePrice.model_validate({"amount": 5, "currency": "INR", "checked": "2026-02-30"})
def test_label_scan_reports_ingredient_confidence_and_a_failure_reason(client, fake, monkeypatch):
    def fake_generate(prompt_id, contents, schema, **kw):
        return schema(
            brand="Some Brand",
            product_name="Night Serum",
            category="serum",
            inci=[{"name": "Aqua", "confidence": "high"}, {"name": "Parfum", "confidence": "low"}],
            confidence="high",
            failure="glare",
        )

    monkeypatch.setattr(gemini, "generate_json", fake_generate)
    res = client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}]}
    )
    assert res.status_code == 200, res.text
    scan = res.json()["scan"]
    assert scan["inci"] == [
        {"name": "Aqua", "confidence": "high"},
        {"name": "Parfum", "confidence": "low"},
    ]
    assert scan["failure"] == "glare"
    assert scan["confidence"] == "low"  # a reported problem is never high confidence


def test_label_scan_model_keeps_plain_ingredient_strings_working():
    old = label_scan.LabelScan(
        brand="x", product_name="y", category="serum", inci=["Aqua", "Glycerin"], confidence="high"
    )
    assert [(i.name, i.confidence) for i in old.inci] == [("Aqua", "high"), ("Glycerin", "high")]
    assert old.failure is None and old.confidence == "high"
    shaky = label_scan.LabelScan(
        brand="x",
        product_name="y",
        category="serum",
        inci=["Aqua", {"name": "Parfum", "confidence": "low"}],
        confidence="high",
    )
    assert shaky.confidence == "medium"  # one hard-to-read ingredient caps the overall reading
    nothing = label_scan.LabelScan(
        brand="Guess",
        product_name="Guess",
        category="other",
        inci=["Aqua"],
        confidence="low",
        failure="no_label",
    )
    assert nothing.inci == [] and nothing.brand is None and nothing.unreadable
    with pytest.raises(ValueError):
        label_scan.LabelScan(
            brand=None, product_name=None, category="other", confidence="low", failure="dark"
        )


def test_an_unreadable_label_photo_does_not_cost_a_scan(client, fake, monkeypatch):
    from datetime import UTC, datetime

    def blurry(prompt_id, contents, schema, **kw):
        return schema(
            brand=None, product_name=None, category="other", confidence="low", failure="blurry"
        )

    monkeypatch.setattr(gemini, "generate_json", blurry)
    res = client.post(
        "/v1/label-scan", json={"images": [{"mime_type": "image/png", "data_base64": _png_b64()}]}
    )
    assert res.status_code == 200
    assert res.json()["scan"]["failure"] == "blurry" and res.json()["match"] is None
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_incr("u_test", day, "label_scan", 0) == 0
