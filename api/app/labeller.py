"""Candidate labeller (GEMINI_SPEC.md section 1).

The engine finds small regions (blemishes, spots) and writes a tight crop and a 3x context crop of
each. Gemini names what each one looks like from a fixed list. It never counts, measures or
diagnoses: the engine's numbers stay the engine's.

Agreement rule: every batch is asked twice (temperature 0, candidates in reverse order the second
time). A label is kept only when both runs give the same label and neither says "low" confidence;
otherwise the candidate is "uncertain". Up to 10 candidates per request; batches run in parallel.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

from google.genai import types
from pydantic import BaseModel, Field

from app import gemini, storage
from app.explain import BANNED

log = logging.getLogger("willow.labeller")

BATCH = 10
MAX_CANDIDATES = 40

Label = Literal[
    "papule_pustule",
    "open_comedone",
    "closed_comedone",
    "post_blemish_mark",
    "freckle",
    "mole",
    "scar",
    "pore",
    "hair_or_artifact",
    "uncertain",
]
Confidence = Literal["low", "medium", "high"]

INSTRUCTIONS = """You look at small cropped photos of skin found by a measurement engine. For each
candidate you get a tight crop and a wider context crop of the same spot. Say what it most looks
like, using only the allowed labels:
papule_pustule (raised, red or with a white top), open_comedone (dark open pore, blackhead),
closed_comedone (small skin-coloured or white bump, whitehead), post_blemish_mark (flat pink,
red or brown mark left after a blemish), freckle (small flat even brown spot), mole (distinct,
often darker, round spot), scar (texture change, indented or raised), pore (an ordinary visible
pore), hair_or_artifact (hair, fibre, reflection, blur, compression), uncertain.
- Cosmetic description only. Never diagnose and never name a disease or condition.
- If the crop is unclear, too small or ambiguous, say uncertain with low confidence.
- visible_features: up to 4 short plain phrases about what you can see (colour, shape, raised or
  flat). No numbers.
- Answer for every candidate id you were given, and only those ids."""


class CandidateLabel(BaseModel):
    id: str
    label: Label
    confidence: Confidence
    visible_features: list[str] = Field(default_factory=list, max_length=4)


class BatchLabels(BaseModel):
    labels: list[CandidateLabel] = Field(default_factory=list, max_length=BATCH)


def _crops(candidate: dict[str, Any]) -> tuple[bytes, bytes] | None:
    names = [
        storage.name_from_uri(candidate.get(k) or "") for k in ("crop_uri", "context_crop_uri")
    ]
    if not all(names):
        return None
    try:
        return storage.read_bytes(names[0]), storage.read_bytes(names[1])
    except Exception as exc:  # crop not written (engine version without crops) or unreadable
        log.info("no crops for %s: %s", candidate.get("id"), exc)
        return None


def _ask_or_none(job: tuple[list, str]) -> dict[str, CandidateLabel] | None:
    try:
        return _ask(*job)
    except gemini.GeminiError:
        return None


def _ask(batch: list[tuple[dict, tuple[bytes, bytes]]], site: str) -> dict[str, CandidateLabel]:
    parts: list[types.Part | str] = []
    for cand, (crop, ctx) in batch:
        parts += [
            f"Candidate {cand['id']} (engine kind: {cand.get('kind', 'unknown')}, site: {site}). "
            "Tight crop, then context crop:",
            types.Part.from_bytes(data=crop, mime_type="image/jpeg"),
            types.Part.from_bytes(data=ctx, mime_type="image/jpeg"),
        ]
    parts.append("Label every candidate above.")
    reply = gemini.generate_json(
        "candidate_labels",
        parts,
        BatchLabels,
        instructions=INSTRUCTIONS,
        temperature=0.0,
        max_output_tokens=4096,
        attempts=2,  # one retry: image calls occasionally pass the 25 s deadline
    )
    ids = {c["id"] for c, _ in batch}
    return {lab.id: lab for lab in reply.labels if lab.id in ids}


def _agree(a: CandidateLabel | None, b: CandidateLabel | None) -> dict[str, Any]:
    if a and b and a.label == b.label and "low" not in (a.confidence, b.confidence):
        confidence = "high" if a.confidence == b.confidence == "high" else "medium"
        features = [f for f in a.visible_features if not BANNED.search(f) and f.strip()][:4]
        return {"label": a.label, "confidence": confidence, "visible_features": features}
    return {"label": "uncertain", "confidence": "low", "visible_features": []}


def label_candidates(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """{candidate_id: {label, confidence, visible_features}} for every candidate with crops.

    Returns {} when the engine produced no candidates or no crops; spots whose batch could not be
    asked twice are left out (unlabelled), never guessed.
    """
    candidates = (result.get("candidates") or [])[:MAX_CANDIDATES]
    with ThreadPoolExecutor(max_workers=8) as pool:
        crops = list(pool.map(_crops, candidates))
    ready = [(c, cr) for c, cr in zip(candidates, crops, strict=True) if cr]
    if not ready:
        return {}
    batches = [ready[i : i + BATCH] for i in range(0, len(ready), BATCH)]
    site = result.get("site", "")
    jobs = [(b, site) for b in batches] + [(list(reversed(b)), site) for b in batches]
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        runs = list(pool.map(_ask_or_none, jobs))
    first, second = runs[: len(batches)], runs[len(batches) :]
    out: dict[str, dict[str, Any]] = {}
    for a_run, b_run, batch in zip(first, second, batches, strict=True):
        if a_run is None or b_run is None:
            # Agreement cannot be checked without both runs: leave these spots unlabelled.
            log.warning("candidate labels: a batch of %d had no second opinion", len(batch))
            continue
        for cand, _ in batch:
            out[cand["id"]] = _agree(a_run.get(cand["id"]), b_run.get(cand["id"]))
    return out
