from pathlib import Path

import pytest

from app import contract

ROOT = Path(__file__).resolve().parents[2]
PAIRS = [
    ("schemas/analysis_result.schema.json", "analysis_result.schema.json"),
    ("schemas/analyze_request.schema.json", "analyze_request.schema.json"),
    ("fixtures/analysis_result.sample.json", "analysis_result.sample.json"),
]


@pytest.mark.parametrize(("original", "copy"), PAIRS)
def test_api_copies_match_the_shared_contract(original, copy):
    src = ROOT / original
    if not src.exists():
        pytest.skip("repo root not available")
    assert (contract.HERE / copy).read_text() == src.read_text(), (
        f"api/app/contract/{copy} drifted from {original}; copy it again"
    )


def test_sample_fixture_is_schema_valid():
    assert (
        contract.errors("analysis_result.schema.json", contract.load("analysis_result.sample.json"))
        == []
    )


def test_api_image_ships_the_catalog():
    # The api serves catalog search from seed/products.json; the image must carry it.
    dockerfile = (contract.HERE.parents[1] / "Dockerfile").read_text()
    assert "COPY seed ./seed" in dockerfile
