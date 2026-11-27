"""scripts/apply_catalog_updates.py: follow-up research upgrades index products in place."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from apply_catalog_updates import apply  # noqa: E402

FULL = {
    "product_id": "brand-a-serum",
    "brand": "brand a",
    "name": "Serum",
    "category": "serum",
    "concerns": [],
    "key_actives": [],
    "inci": ["Aqua", "Glycerin"],
    "price": {"amount": 10, "currency": "USD"},
    "size": "30 ml",
    "region": ["SEA"],
    "stores": [],
    "source_url": "https://example.com/serum",
    "last_verified": "2026-11-28",
    "detail": "full",
    "notes": "From the brand page.",
}


def _catalog():
    index = {
        **FULL,
        "brand": "Brand A",
        "detail": "index",
        "inci": [],
        "price": None,
        "image_url": "https://example.com/a.jpg",
        "image_source": "https://example.com/serum",
    }
    full = {**FULL, "product_id": "brand-a-cream", "name": "Cream", "brand": "Brand A"}
    bare = {
        **FULL,
        "product_id": "brand-a-toner",
        "name": "Toner",
        "brand": "Brand A",
        "detail": "index",
        "inci": [],
        "price": None,
    }
    return [index, full, bare]


def test_facts_upgrade_an_index_product_and_keep_its_photo_and_brand_spelling():
    products = _catalog()
    out = apply(products, [FULL, {**FULL, "product_id": "brand-a-cream"}], [])
    assert out["upgraded"] == ["brand-a-serum"]
    p = products[0]
    assert p["detail"] == "full" and p["inci"] == ["Aqua", "Glycerin"]
    assert p["brand"] == "Brand A" and p["image_url"] == "https://example.com/a.jpg"
    assert out["skipped"] == ["brand-a-cream: already full"]  # a full product is never replaced


def test_images_fill_only_products_without_a_photo_and_need_a_real_link():
    products = _catalog()
    out = apply(
        products,
        [],
        [
            {
                "product_id": "brand-a-toner",
                "image_url": "https://example.com/t.jpg",
                "image_source": "https://example.com/toner",
            },
            {"product_id": "brand-a-serum", "image_url": "https://example.com/other.jpg"},
            {"product_id": "nope", "image_url": "https://example.com/x.jpg"},
            {"product_id": "brand-a-cream", "image_url": "not a link"},
        ],
    )
    assert out["imaged"] == ["brand-a-toner"] and products[2]["image_url"].endswith("t.jpg")
    assert products[0]["image_url"].endswith("a.jpg")
    assert len(out["rejected"]) == 2
