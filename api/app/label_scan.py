"""Label scan (GEMINI_SPEC.md section 3): read a product's pack, then match it to the catalog.

Gemini only transcribes what is printed on the pack. The person confirms or edits the result in
the web before anything is saved to their routine.
"""

import base64
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

from app import catalog, gemini

Category = Literal[
    "cleanser",
    "toner",
    "serum",
    "treatment",
    "exfoliant",
    "moisturizer",
    "sunscreen",
    "eye_care",
    "mask",
    "other",
]

INSTRUCTIONS = """Read the skincare product label in the photo(s) and transcribe it.
- brand and product_name exactly as printed; null if not visible.
- category: the closest of the allowed values; "other" if none fits.
- inci: the full ingredient list in printed order, one ingredient per item, exactly as printed.
  Empty if the ingredient list is not visible. Never guess ingredients.
- key_actives: notable actives (e.g. niacinamide, salicylic acid, retinol, vitamin C, azelaic
  acid, ceramides, SPF filters). pct only when a percentage is printed on the pack, else null.
- claims_on_pack: short claims printed on the pack, verbatim, max 6.
- confidence: high only if brand, name and the ingredient list are all clearly legible."""


class KeyActive(BaseModel):
    name: str
    pct: float | None = None


class LabelScan(BaseModel):
    brand: str | None
    product_name: str | None
    category: Category
    inci: list[str] = Field(default_factory=list)
    key_actives: list[KeyActive] = Field(default_factory=list)
    claims_on_pack: list[str] = Field(default_factory=list, max_length=6)
    confidence: Literal["low", "medium", "high"]


class LabelImage(BaseModel):
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    data_base64: str = Field(max_length=8_000_000)


class LabelScanRequest(BaseModel):
    images: list[LabelImage] = Field(min_length=1, max_length=2)


class CatalogMatch(BaseModel):
    product_id: str
    brand: str
    name: str
    score: float


class LabelScanResponse(BaseModel):
    scan: LabelScan
    match: CatalogMatch | None


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = " ".join(text.split()).strip(" .;,")
    return text or None


def tidy(result: LabelScan) -> LabelScan:
    """Strip the punctuation that printed lists leave behind ("Chlorphenesin.", "Brand.")."""
    return result.model_copy(
        update={
            "brand": _clean(result.brand),
            "product_name": _clean(result.product_name),
            "inci": [c for c in (_clean(i) for i in result.inci) if c],
            "key_actives": [
                KeyActive(name=_clean(a.name).lower(), pct=a.pct)
                for a in result.key_actives
                if _clean(a.name)
            ],
        }
    )


class BadImage(ValueError):
    pass


def decode_image(data: str) -> bytes:
    try:
        return base64.b64decode(data, validate=True)
    except ValueError as exc:  # binascii.Error is a ValueError
        raise BadImage("the photo could not be read") from exc


def scan(images: list[LabelImage]) -> LabelScanResponse:
    parts: list[types.Part | str] = [
        types.Part.from_bytes(data=decode_image(img.data_base64), mime_type=img.mime_type)
        for img in images
    ]
    parts.append("Transcribe this product label.")
    result = gemini.generate_json(
        "label_scan", parts, LabelScan, instructions=INSTRUCTIONS, max_output_tokens=8192
    )
    result = tidy(result)
    found = catalog.match(result.brand, result.product_name)
    match = None
    if found:
        product, score = found
        match = CatalogMatch(
            product_id=product["product_id"],
            brand=product["brand"],
            name=product["name"],
            score=round(score, 2),
        )
    return LabelScanResponse(scan=result, match=match)
