"""Label scan (GEMINI_SPEC.md section 3): read a product's pack, then match it to the catalog.

Gemini only transcribes what is printed on the pack. The person confirms or edits the result in
the web before anything is saved to their routine.
"""

import base64
from typing import Any, Literal

from google.genai import types
from pydantic import BaseModel, Field, field_validator, model_validator

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
- inci: the full ingredient list in printed order, one item per ingredient: name exactly as
  printed, confidence "high" when every letter is clearly legible, "low" when part of it is hard
  to read (glare, blur, a fold, cut off). Empty if the ingredient list is not visible. Never guess
  ingredients.
- key_actives: notable actives (e.g. niacinamide, salicylic acid, retinol, vitamin C, azelaic
  acid, ceramides, SPF filters). pct only when a percentage is printed on the pack, else null.
- claims_on_pack: short claims printed on the pack, verbatim, max 6.
- confidence: high only if brand, name and the ingredient list are all clearly legible.
- failure: why the label could not be read fully, else null. "glare" (reflections over the text),
  "blurry" (out of focus or motion), "no_label" (no product label in the photo), "cut_off" (part
  of the ingredient list is outside the photo)."""


class KeyActive(BaseModel):
    name: str
    pct: float | None = None


Failure = Literal["glare", "blurry", "no_label", "cut_off"]


class InciItem(BaseModel):
    name: str
    confidence: Literal["high", "low"] = "high"


class LabelScan(BaseModel):
    brand: str | None
    product_name: str | None
    category: Category
    # One item per ingredient with how legible it was. A plain string (the shape before Oct 15)
    # is still accepted and read as a legible ingredient.
    inci: list[InciItem] = Field(default_factory=list)
    key_actives: list[KeyActive] = Field(default_factory=list)
    claims_on_pack: list[str] = Field(default_factory=list, max_length=6)
    confidence: Literal["low", "medium", "high"]
    failure: Failure | None = None

    @field_validator("inci", mode="before")
    @classmethod
    def _plain_strings(cls, v: Any) -> Any:
        if isinstance(v, list):
            return [{"name": i} if isinstance(i, str) else i for i in v]
        return v

    @model_validator(mode="after")
    def _consistent(self) -> "LabelScan":
        """A reading that reports a problem is never "high" confidence, and a photo with no label
        has nothing to transcribe (anything read from it would be a guess)."""
        if self.failure == "no_label":
            self.inci, self.key_actives, self.claims_on_pack = [], [], []
            self.brand = self.product_name = None
        if self.failure and self.confidence == "high":
            self.confidence = "low"
        if any(i.confidence == "low" for i in self.inci) and self.confidence == "high":
            self.confidence = "medium"
        return self

    @property
    def unreadable(self) -> bool:
        """Nothing usable came back: the person should retake the photo (the scan is refunded)."""
        return bool(self.failure) and not (self.inci or self.brand or self.product_name)


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
            "inci": [
                InciItem(name=c, confidence=i.confidence)
                for i in result.inci
                if (c := _clean(i.name))
            ],
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
