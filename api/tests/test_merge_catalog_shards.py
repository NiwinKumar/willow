"""scripts/merge_catalog_shards.py: shards of new products into seed/products.json."""

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[1]
SHARDS = Path(__file__).parent / "fixtures" / "catalog_shards"
EXISTING = [
    {
        "product_id": "the-ordinary-niacinamide-10-zinc-1",
        "brand": "The Ordinary",
        "name": "Niacinamide 10% + Zinc 1%",
        "category": "serum",
        "concerns": [],
        "key_actives": [],
        "inci": ["Aqua", "Niacinamide"],
        "price": {"amount": 6.0, "currency": "USD"},
        "size": "30 ml",
        "region": ["GLOBAL"],
        "stores": [],
        "source_url": "https://theordinary.com/x",
        "last_verified": "2026-10-13",
    }
]


@pytest.fixture(scope="module")
def merge_mod():
    spec = importlib.util.spec_from_file_location(
        "merge_catalog_shards", API / "scripts" / "merge_catalog_shards.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_shards_are_validated_normalised_and_deduplicated(merge_mod):
    accepted, report = merge_mod.merge(EXISTING, merge_mod.read_shards(SHARDS))
    assert [p["product_id"] for p in accepted] == [
        "hada-labo-gokujyun-premium-lotion",
        "cosrx-snail-96-mucin-power-essence",
    ]
    hada = accepted[0]
    assert hada["region"] == ["SEA", "GLOBAL"]  # SG and MY are SEA, once
    assert hada["stores"][0]["region"] == "SEA"
    assert hada["detail"] == "index" and hada["price"] is None and hada["notes"]
    a, b, c = report
    assert (a["accepted"], a["full"], a["index"]) == (2, 1, 1)
    reasons = {r["record"]: r["reason"] for r in a["rejected"]}
    assert "inci" in reasons["cosrx-no-label"]  # a full record needs its ingredient list
    bad = reasons["Bad ID"]
    for field in ("product_id", "category", "region", "price.currency", "source_url"):
        assert field in bad
    assert reasons["the-ordinary-niacinamide-10-zinc-1"] == "duplicate product_id"
    again = {r["record"]: r["reason"] for r in b["rejected"]}
    # the same product under another id, in another shard (case aside)
    assert again["hadalabo-gokujyun-premium-lotion-2"] == (
        "same brand and name as hada-labo-gokujyun-premium-lotion"
    )
    assert "barcode" in again["dr-jart-cicapair-cream"]  # unknown fields are not let through
    assert c["error"] == "not a JSON array"


def test_dry_run_writes_nothing_and_write_appends_without_overwriting(merge_mod, tmp_path, capsys):
    catalog = tmp_path / "products.json"
    catalog.write_text(json.dumps(EXISTING, indent=2) + "\n")
    sheet = tmp_path / "catalog.csv"
    shards = tmp_path / "shards"
    shutil.copytree(SHARDS, shards)
    args = [str(shards), "--catalog", str(catalog), "--csv", str(sheet)]

    assert merge_mod.main(args) == 0
    assert json.loads(catalog.read_text()) == EXISTING and not sheet.exists()
    out = capsys.readouterr().out
    assert "a.json: 2 accepted (1 full, 1 index), 3 rejected" in out and "dry run" in out

    assert merge_mod.main([*args, "--write"]) == 0
    merged = json.loads(catalog.read_text())
    assert merged[0] == EXISTING[0]  # never overwritten
    assert [p["product_id"] for p in merged[1:]] == [
        "hada-labo-gokujyun-premium-lotion",
        "cosrx-snail-96-mucin-power-essence",
    ]
    rows = sheet.read_text().splitlines()
    assert len(rows) == 1 + len(merged) and rows[0].endswith(",detail,notes,concerns_source")
    # a second run finds nothing new
    assert merge_mod.main([*args, "--write"]) == 0
    assert len(json.loads(catalog.read_text())) == len(merged)
