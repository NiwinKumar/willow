"""Catalog gaps filled on Nov 28: concerns from the brand's own claims
(scripts/fill_catalog_concerns.py) and home-region tags (scripts/tag_catalog_regions.py)."""

import importlib.util
from pathlib import Path

import pytest

from app import catalog

API = Path(__file__).resolve().parents[1]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, API / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def fill():
    return _load("fill_catalog_concerns")


@pytest.fixture(scope="module")
def regions_mod():
    return _load("tag_catalog_regions")


def test_catalog_records_say_how_filled_concerns_were_found():
    merge = _load("merge_catalog_shards")
    filled = [p for p in catalog.products() if p.get("concerns_source")]
    assert filled, "fill_catalog_concerns.py has been run"
    assert {p["concerns_source"] for p in filled} <= {"brand_page", "name"}
    assert all(p["concerns"] for p in filled)  # a source is only written with concerns
    # the shard schema takes the field, and only its two values
    record = {
        "product_id": "x-toner",
        "brand": "X",
        "name": "Toner",
        "category": "toner",
        "concerns": ["dullness"],
        "region": ["KR"],
        "source_url": "https://x.example/toner",
        "last_verified": "2026-11-28",
        "detail": "index",
    }
    assert merge.Record.model_validate({**record, "concerns_source": "name"}).concerns_source
    with pytest.raises(ValueError):
        merge.Record.model_validate({**record, "concerns_source": "guess"})


def test_only_quoted_claims_count(fill):
    text = "Calming toner for sensitive skin. Hydrates all day."
    claims = [
        fill.Claim(concern="redness_sensitivity", quote="for Sensitive skin"),
        fill.Claim(concern="dryness_barrier", quote="hydrates all day"),
        fill.Claim(concern="fine_lines", quote="reduces wrinkles"),  # not in the text
    ]
    assert fill.grounded(claims, text) == ["redness_sensitivity", "dryness_barrier"]


def test_name_fallback_takes_explicit_claim_words_only(fill):
    assert fill.name_rules("Clear Pure Glow Rice Toner") == []  # vague words, an ingredient
    assert fill.name_rules("Blemish + Age Defense Serum") == ["acne_blemishes"]
    assert fill.name_rules("Pore Tightening Anti-Wrinkle Cream") == [
        "texture_pores",
        "fine_lines",
    ]


def test_page_text_reads_the_product_description(fill):
    html = """<html><head><title>Snail Essence | Store</title>
    <meta name="description" content="Repairs &amp; hydrates dry skin.">
    <script type="application/ld+json">{"@type": "Product", "description": "Fades dark spots."}
    </script><script>var x = "noise";</script></head>
    <body><div class="product__description rte">Soothes redness.</div></body></html>"""
    text, short = fill.page_text(html)
    for part in ("Snail Essence", "Repairs & hydrates dry skin.", "Fades dark spots.", "redness"):
        assert part in text
    assert "noise" not in text and short == "Repairs & hydrates dry skin."


def _p(brand: str, region: list[str], url: str = "https://example.com/p", stores=()):
    return {
        "brand": brand,
        "region": list(region),
        "source_url": url,
        "stores": [{"store": "s", "url": "https://shop.example/p", "region": r} for r in stores],
    }


def test_region_tags_are_only_ever_added(regions_mod):
    products = [
        _p("COSRX", ["AU", "GLOBAL"]),  # origin South Korea
        _p("Softymo", ["AU"], "https://kokorojapanstore.com/products/x"),  # no origin: its store
        _p("Nivea", ["IN"], "https://kokorojapanstore.com/products/y"),  # origin Germany wins
        _p("Mixed", ["US"], "https://a.co.kr/x"),
        _p("Mixed", ["US"], "https://b.co.jp/y"),  # two home regions: neither
        _p("Plain", ["SEA"], stores=["CN"]),  # a store entry already carries CN
    ]
    known = regions_mod.origins(
        [
            {"brand": "COSRX", "origin": "South Korea"},
            {"brand": "Nivea", "origin": "Germany"},
        ]
    )
    added = regions_mod.tag(products, regions_mod.brand_regions(products, known))
    assert [p["region"] for p in products] == [
        ["AU", "GLOBAL", "KR"],
        ["AU", "JP"],
        ["IN"],
        ["US"],
        ["US"],
        ["SEA", "CN"],
    ]
    assert sum(added.values()) == 3
    # running it again adds nothing
    assert not regions_mod.tag(products, regions_mod.brand_regions(products, known))
