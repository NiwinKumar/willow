"""Candidate labeller (GEMINI_SPEC.md section 1).

The engine finds small regions (blemishes, spots) and writes a tight crop and a 3x context crop of
each. Gemini names what each one looks like from a fixed list. It never counts, measures or
diagnoses: the engine's numbers stay the engine's.

Agreement rule: every batch is asked twice (temperature 0, candidates in reverse order the second
time). A label is kept only when both runs give the same label and neither says "low" confidence;
otherwise the candidate is "uncertain". Up to 5 candidates per request; every call runs at once
(a batch's two runs side by side), within LABEL_BUDGET_S: a batch still unanswered then is left
unlabelled, so a slow Gemini never holds up a check-in's result.
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Literal

from google.genai import types
from pydantic import BaseModel, Field

from app import gemini, storage
from app.explain import BANNED

log = logging.getLogger("willow.labeller")

# 20 images per call (10 candidates) took about 50 s and often hit Vertex's deadline (Oct 18);
# 5 per call answer in about 10 s.
BATCH = 5
MAX_CANDIDATES = 40
# Every call at once: 40 candidates are 8 batches asked twice, 16 calls. With 8 workers the
# second runs queued behind the first ones and agreement waited for a second wave (20-30 s).
WORKERS = 16
# The check-in waits for the labels: past this, unanswered batches stay unlabelled. Each call's
# own deadline is the same, so a slow call is not left running long after nobody waits for it.
LABEL_BUDGET_S = 15.0
DIGIT = re.compile(r"\d")

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
candidate you get a tight crop and a wider context crop of the same spot. The candidate is the
small mark at the exact centre of both crops; judge only that mark, not other marks, features or
objects elsewhere in the crop. Say what it most looks like, using only the allowed labels:
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


def _ask_or_none(job: tuple[list, str, float]) -> dict[str, CandidateLabel] | None:
    try:
        return _ask(*job)
    except gemini.GeminiError:
        return None


def _ask(
    batch: list[tuple[dict, tuple[bytes, bytes]]], site: str, timeout_s: float = LABEL_BUDGET_S
) -> dict[str, CandidateLabel]:
    parts: list[types.Part | str] = []
    for cand, (crop, ctx) in batch:
        parts += [
            f"Candidate {cand['id']} (engine kind: {cand.get('kind', 'unknown')}, site: {site}). "
            "Tight crop, then context crop, the candidate at the centre of each:",
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
        # no second try: the budget has no room for one (a transient 429/503 that comes back
        # quickly is still retried once by generate_json)
        attempts=1,
        # 10 small images per call answer in about 10 s; past the budget nobody waits for it
        timeout_ms=max(1_000, round(timeout_s * 1000)),
    )
    ids = {c["id"] for c, _ in batch}
    return {lab.id: lab for lab in reply.labels if lab.id in ids}


def _agree(a: CandidateLabel | None, b: CandidateLabel | None) -> dict[str, Any]:
    if a and b and a.label == b.label and "low" not in (a.confidence, b.confidence):
        confidence = "high" if a.confidence == b.confidence == "high" else "medium"
        # words only: a digit ("2 mm", "3 spots") would be Gemini measuring or counting
        features = [
            f
            for f in a.visible_features
            if f.strip() and not BANNED.search(f) and not DIGIT.search(f)
        ][:4]
        return {"label": a.label, "confidence": confidence, "visible_features": features}
    return {"label": "uncertain", "confidence": "low", "visible_features": []}


def label_candidates(
    result: dict[str, Any], budget_s: float | None = None
) -> dict[str, dict[str, Any]]:
    """{candidate_id: {label, confidence, visible_features}} for every candidate with crops.

    Returns {} when the engine produced no candidates or no crops; spots whose batch could not be
    asked twice within the budget (LABEL_BUDGET_S, or `budget_s` when smaller) are left out
    (unlabelled), never guessed.
    """
    budget = LABEL_BUDGET_S if budget_s is None else min(LABEL_BUDGET_S, budget_s)
    if budget <= 0:
        return {}
    deadline = time.monotonic() + budget
    candidates = (result.get("candidates") or [])[:MAX_CANDIDATES]
    if not candidates:
        return {}
    with ThreadPoolExecutor(max_workers=min(WORKERS, len(candidates))) as pool:
        crops = list(pool.map(_crops, candidates))
    ready = [(c, cr) for c, cr in zip(candidates, crops, strict=True) if cr]
    left = deadline - time.monotonic()
    if not ready or left <= 0:
        return {}
    batches = [ready[i : i + BATCH] for i in range(0, len(ready), BATCH)]
    site = result.get("site", "")
    # Each batch's two runs next to each other, all at once: a pair finishes together.
    jobs = [job for b in batches for job in ((b, site, left), (list(reversed(b)), site, left))]
    pool = ThreadPoolExecutor(max_workers=min(WORKERS, len(jobs)))
    futures = [pool.submit(_ask_or_none, job) for job in jobs]
    done, late = wait(futures, timeout=left)
    # Don't wait for the late ones: their spots stay unlabelled (the threads finish on their own).
    pool.shutdown(wait=False, cancel_futures=True)
    if late:
        log.warning(
            "candidate labels: %d of %d calls missed the %.0f s budget",
            len(late),
            len(jobs),
            budget,
        )
    runs = [f.result() if f in done else None for f in futures]
    first, second = runs[0::2], runs[1::2]
    out: dict[str, dict[str, Any]] = {}
    for a_run, b_run, batch in zip(first, second, batches, strict=True):
        if a_run is None or b_run is None:
            # Agreement cannot be checked without both runs: leave these spots unlabelled.
            log.warning("candidate labels: a batch of %d had no second opinion", len(batch))
            continue
        for cand, _ in batch:
            out[cand["id"]] = _agree(a_run.get(cand["id"]), b_run.get(cand["id"]))
    return out
