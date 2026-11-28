"""Brand spellings and pack-size tails cleaned at catalog load (app/catalog.py BRAND_ALIASES,
display_name): the juror saw "DEAR KLAIRS DEAR KLAIRS" beside "Dear, Klairs" in Proof's brand
picker and "... Boosting Essence 150ml (22AD)" as a product name."""

import json

from app import catalog, retail_intel


def test_one_brand_written_several_ways_reads_and_groups_as_one():
    brands = set(retail_intel.brands())
    for alias, main in catalog.BRAND_ALIASES.items():
        assert alias not in brands and main in brands
    # a real doubled name is left alone
    assert catalog.brand_name("Holika Holika") == "Holika Holika"
    # every product is still there, under its own id: only the brand's spelling changed
    raw = json.loads(catalog.CATALOG_PATH.read_text())
    assert [p["product_id"] for p in catalog.products()] == [p["product_id"] for p in raw]


def test_a_pack_size_and_batch_code_at_the_end_of_a_name_are_dropped():
    clean = catalog.display_name
    assert clean("Fermented Complex 94 Boosting Essence 150ml (22AD)") == (
        "Fermented Complex 94 Boosting Essence"
    )
    assert (
        clean("Tran-Zelaic Serum with Azelaic Acid - 30ml") == "Tran-Zelaic Serum with Azelaic Acid"
    )
    assert clean("Lait Crème Sensitive 15ml (Worth £6.00)") == "Lait Crème Sensitive"
    # what tells products apart, or is part of the name, stays
    assert clean("Lightweight Daily Moisturizer 100ml (2-Pack)") == (
        "Lightweight Daily Moisturizer 100ml (2-Pack)"
    )
    assert clean("Sun Serum 50ml SPF50+ PA++++") == "Sun Serum 50ml SPF50+ PA++++"
    assert clean("Niacinamide 10% + Zinc 1%") == "Niacinamide 10% + Zinc 1%"
    # no two products of a brand end up with the same name
    seen = [(p["brand"], p["name"]) for p in catalog.products()]
    raw = json.loads(catalog.CATALOG_PATH.read_text())
    before = [(catalog.brand_name(p["brand"]), p["name"]) for p in raw]
    assert len(seen) - len(set(seen)) == len(before) - len(set(before))
