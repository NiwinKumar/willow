import base64
import csv
import importlib.util
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
        "stores": [{"store": "Nykaa", "url": "https://www.nykaa.com/x", "region": "IN"}],
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
        "stores": [{"store": "Brand site", "url": "https://beminimalist.co/x", "region": "IN"}],
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
    assert clean.inci == ["Aqua (Water)", "Chlorphenesin"]
    assert clean.key_actives[0].name == "zinc pca"
