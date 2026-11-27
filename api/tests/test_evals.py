"""The eval harness's scoring (evals/metrics.py, evals/report.py): offline, no model calls."""

import json
from types import SimpleNamespace

from app import gemini, numbers
from app.gemini import generate_json as real_generate_json  # before conftest makes it offline
from app.retailer_ask import Answer
from evals import metrics, report
from evals.metrics import CaseResult


def test_wording_rules_catch_claims_but_not_refusals():
    slips = metrics.wording_slips(
        [
            "This serum is safe for you.",
            "It treats breakouts in a week.",
            "Take 20 mg twice a day.",
            "Willow cannot prescribe anything.",  # a refusal, not a claim
            "Rather than claiming any product can cure a condition, Willow tracks change.",
            "You do not have rosacea.",  # a condition name counts even when negated
        ]
    )
    kinds = [s.split(":")[0] for s in slips]
    assert kinds == ["safe", "treat/cure/heal", "dose", "condition name"]
    assert metrics.wording_slips(["No flags for your profile.", "A healthy routine."]) == []


def test_numbers_not_in_the_input_are_reported():
    allowed = numbers.collect({"rate": 0.61, "n": 40}) | numbers.percents({"rate": 0.61})
    assert metrics.unknown_numbers(["61% of 40 people"], allowed) == []
    assert metrics.unknown_numbers(["61% of 40 people, up 12 points"], allowed) == ["12"]


def test_ingredient_checks_allow_ocr_slips_but_not_new_ingredients():
    printed = ["Aqua (Water)", "Niacinamide", "Zinc PCA", "Phenoxyethanol"]
    read = ["Aqua Water", "Niacinamde", "Zinc PCA", "Hydroquinone"]
    assert metrics.invented_ingredients(read, printed) == ["Hydroquinone"]
    assert metrics.recall(read, printed) == 0.75  # phenoxyethanol missed


def test_percentile_is_nearest_rank():
    xs = [1.0, 2.0, 3.0, 4.0, 10.0]
    assert metrics.percentile(xs, 50) == 3.0
    assert metrics.percentile(xs, 95) == 10.0
    assert metrics.percentile([], 50) is None


def test_summary_counts_fallbacks_adversarial_and_skips_apart():
    def row(source, slice_="normal", first=True, ok=True, invented=()):
        return CaseResult(
            "j", "c", slice_, "m", source,
            first_try_pass=first, final_pass=source == "model", behaviour_ok=ok,
            invented_numbers=list(invented), latency_ms=2000,
        )  # fmt: skip

    s = metrics.summarise(
        [
            row("model"),
            row("model", first=False),
            row("fallback", "adversarial", first=False),
            row("model", "adversarial", ok=False, invented=["12"]),
            row("skipped"),
        ]
    )
    assert (s["cases"], s["skipped"], s["adversarial"]) == (4, 1, 2)
    assert (s["first_try_pass"], s["final_pass"], s["fallback"]) == (0.5, 0.75, 0.25)
    assert (s["adversarial_ok"], s["invented_numbers_shown"], s["p50_s"]) == (0.5, 1, 2.0)


def test_a_docs_section_is_replaced_in_place_or_appended():
    text = "# Evals\n\nintro\n"
    once = report.replace_section(text, "eval-table", "| a |")
    assert once.endswith("<!-- eval-table:start -->\n| a |\n<!-- eval-table:end -->\n")
    twice = report.replace_section(once + "\noutro\n", "eval-table", "| b |")
    assert "| a |" not in twice and "| b |" in twice and twice.endswith("outro\n")


def test_every_gemini_call_carries_the_explicit_safety_settings(monkeypatch):
    """gemini.generate_json sets them; config_for adds them to the tool-calling turns' configs."""
    seen = []

    class Models:
        def generate_content(self, **kw):
            seen.append(kw["config"])
            return SimpleNamespace(text=json.dumps({"answer": "ok"}), usage_metadata=None)

    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=Models()))
    real_generate_json("t", ["q"], Answer, instructions="i", attempts=1, hedge_after_s=None)
    tool_cfg = gemini.config_for("any-model", gemini.types.GenerateContentConfig())
    for cfg in (seen[0], tool_cfg):
        assert {(s.category, s.threshold) for s in cfg.safety_settings} == {
            (s.category, gemini.SAFETY_THRESHOLD) for s in gemini.SAFETY_SETTINGS
        }
