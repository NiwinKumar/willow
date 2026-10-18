"""AutoCampaign's agent (app/autopilot_agent.py): Gemini decides through tools; the tools only say
no. The model is scripted (autopilot_agent.model_round); the evidence is the stub from
test_autopilot."""

from datetime import timedelta

import pytest
from test_autopilot import (
    SERUM,
    SERUM_2,
    SERUM_3,
    _members,
    _rule,
    _run,
    sig,  # noqa: F401  (the evidence stub, reached as `ev` below)
)

from app import autopilot_agent, campaigns, gemini


class Script:
    """Plays the model: each round returns the next list of (tool, args); records every answer."""

    def __init__(self, rounds):
        self.rounds = list(rounds)
        self.answers: list[tuple[str, dict]] = []

    def __call__(self, contents, config):
        last = contents[-1]
        for part in last.parts or []:
            fr = getattr(part, "function_response", None)
            if fr is not None:
                self.answers.append((fr.name, dict(fr.response)))
        if not self.rounds:
            return [], "Done.", None
        step = self.rounds.pop(0)
        if isinstance(step, Exception):
            raise step
        return step, None, None

    def answer(self, tool):
        return [a for n, a in self.answers if n == tool]


@pytest.fixture
def ev(request):
    """test_autopilot's evidence stub (products, rising demand, under-served groups)."""
    return request.getfixturevalue("sig")


@pytest.fixture
def model(monkeypatch):
    def use(*rounds):
        s = Script(rounds)
        monkeypatch.setattr(autopilot_agent, "model_round", s)
        return s

    return use


READ = [("get_rule", {}), ("list_products", {}), ("get_limits", {})]


def test_the_agent_starts_what_it_chooses_and_explains_with_the_tools_numbers(
    client, fake, ev, model
):
    _rule(client, level="auto", action={"days": 14, "holdout_pct": 0.2, "max_running": 2})
    s = model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM_2,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots with a lift of at least 10% over "
                    "non-users (n=46); it fits oily and combination skin.",
                },
            )
        ],
        [("finish", {"summary": "Started one serum; the other can wait for a slot."})],
    )
    out = _run(client)
    assert out["result"]["source"] == "gemini" and out["result"]["started"] == 1
    (c,) = fake.store.campaigns.values()
    assert c["product_id"] == SERUM_2 and c["rule_id"]  # its choice, not the strongest lift
    started = next(a for a in out["activity"] if a["kind"] == "started")
    assert started["by"] == "gemini" and "at least 10% over non-users (n=46)" in started["text"]
    reviewed = next(a for a in out["activity"] if a["kind"] == "reviewed")
    assert "Started one serum" in reviewed["text"]
    assert s.answer("list_products")[0]["products"]  # it saw the evidence


def test_suggest_turns_a_start_into_a_proposal(client, fake, ev, model):
    _rule(client)  # suggest
    model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "The strongest lift in scope (n=46).",
                },
            )
        ],
        [("finish", {"summary": "Proposed the strongest serum."})],
    )
    out = _run(client)
    assert not fake.store.campaigns and out["result"]["proposed"] == 1
    assert next(a for a in out["activity"] if a["kind"] == "proposed")["by"] == "gemini"


def test_the_tools_refuse_and_the_agent_corrects_itself(client, fake, ev, model):
    _rule(client, level="auto", action={"max_running": 1})
    s = model(
        READ,
        # Promising: refused; an invented number: refused; outside the evidence goals: refused
        [
            (
                "start_campaign",
                {"product_id": SERUM_3, "goals": ["dark_spots"], "reason": "Looks good."},
            ),
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "92% of users saw a change.",
                },
            ),
            (
                "start_campaign",
                {"product_id": SERUM, "goals": ["redness"], "reason": "Worth a try now."},
            ),
        ],
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            ),
            (
                "start_campaign",
                {"product_id": SERUM_2, "goals": ["dark_spots"], "reason": "Also Proven (n=46)."},
            ),
        ],
        [
            ("hold", {"product_id": SERUM_2, "reason": "The rule runs 1 at a time."}),
            ("finish", {"summary": "Started the stronger serum and held the other."}),
        ],
    )
    out = _run(client)
    errors = [a["error"] for a in s.answer("start_campaign") if not a["ok"]]
    assert "Only products rated Proven can be promoted." in errors
    assert any("number no tool returned" in e for e in errors)
    assert any("Goals must be among" in e for e in errors)
    assert any("No slot left" in e for e in errors)  # the limit of 1, after the first start
    assert out["result"]["started"] == 1 and out["result"]["held"] == 1
    assert [d["product_id"] for d in fake.store.campaigns.values()] == [SERUM]


def test_managing_needs_full_autopilot_otherwise_it_is_proposed(client, fake, ev, model):
    _rule(client, level="auto", action={"max_running": 1})
    model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            )
        ],
    )
    _run(client)
    (cid,) = fake.store.campaigns
    model(
        [("list_campaigns", {})],
        [("end_campaign", {"campaign_id": cid, "reason": "Adoption is level so far."})],
    )
    out = _run(client)
    assert campaigns.status_of(fake.store.campaigns[cid]) == "active"
    prop = next(a for a in out["activity"] if a["kind"] == "proposed")
    assert prop["proposal"]["action"] == "end"


def test_on_autopilot_it_extends_a_working_campaign_and_ends_one_with_no_lift(
    client, fake, ev, model
):
    _rule(client, level="autopilot", action={"days": 7, "holdout_pct": 0.1, "max_running": 2})
    model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            ),
            (
                "start_campaign",
                {
                    "product_id": SERUM_2,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            ),
        ],
    )
    _run(client)
    ids = {d["product_id"]: c for c, d in fake.store.campaigns.items()}
    fake.store.campaigns[ids[SERUM]]["ends_at"] = campaigns.now() + timedelta(days=1)
    _members(fake.store, ids[SERUM], exposed_added=9, holdout_added=1)
    _members(fake.store, ids[SERUM_2], exposed_added=0, holdout_added=5)
    model(
        [("list_campaigns", {})],
        [
            (
                "extend_campaign",
                {
                    "campaign_id": ids[SERUM],
                    "days": 14,
                    "reason": "Adoption is 0.8 above the holdout.",
                },
            ),
            (
                "end_campaign",
                {
                    "campaign_id": ids[SERUM_2],
                    "reason": "Adoption is below the holdout (n=10 each).",
                },
            ),
        ],
    )
    out = _run(client)
    assert out["result"]["extended"] == 1 and out["result"]["ended"] == 1
    assert fake.store.campaigns[ids[SERUM]]["days"] == 21
    assert campaigns.status_of(fake.store.campaigns[ids[SERUM_2]]) == "ended"


def test_code_pauses_a_slipped_product_before_the_agent_runs(client, fake, ev, model):
    _rule(client, level="autopilot")
    model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            )
        ],
    )
    _run(client)
    ev["by_id"](SERUM).update(tier="promising", eligible=False)
    s = model([("list_campaigns", {})], [("finish", {"summary": "Nothing else to change."})])
    out = _run(client)
    (c,) = fake.store.campaigns.values()
    assert c["status"] == "paused" and out["result"]["paused"] == 1
    assert s.answer("list_campaigns")[0]["campaigns"][0]["status"] == "paused"


def test_without_gemini_the_rule_runs_on_the_fixed_logic(client, fake, ev, model):
    _rule(client, level="auto")
    model(gemini.GeminiError("down"))
    out = _run(client)
    assert out["result"]["source"] == "rules" and out["result"]["started"] == 2
    assert all(a["by"] is None for a in out["activity"])


def test_a_failure_part_way_keeps_what_it_did_and_never_runs_twice(client, fake, ev, model):
    _rule(client, level="auto")
    model(
        READ,
        [
            (
                "start_campaign",
                {
                    "product_id": SERUM,
                    "goals": ["dark_spots"],
                    "reason": "Proven for dark spots (n=46).",
                },
            )
        ],
        RuntimeError("timeout"),
    )
    out = _run(client)
    assert out["result"]["source"] == "gemini" and len(fake.store.campaigns) == 1


def test_gemini_reads_a_typed_rule_and_the_form_checks_it(client, fake, ev, monkeypatch):
    from app.routes import autopilot_routes as r

    def draft(prompt_id, contents, schema, **kw):
        return schema(
            rule=r.DraftRule(
                name="Calm budget skin",
                level="auto",
                category="moisturizer",
                trigger=r.DraftTrigger(kind="unmet_need", goals=["redness"], unmet_min=0.6),
                action=r.DraftAction(days=30, holdout_pct=0.25, max_running=1),
            ),
            missed=["dates: none given"],
        )

    monkeypatch.setattr(gemini, "generate_json", draft)
    res = client.post(
        "/v1/retailer/autopilot/parse",
        json={"text": "when most dry-skin people get no calm, push a cream", "workspace": "CeraVe"},
    ).json()
    assert res["source"] == "gemini" and res["rule"]["trigger"]["kind"] == "unmet_need"
    assert res["rule"]["workspace"] == "CeraVe" and res["rule"]["action"]["max_running"] == 1

    def bad(prompt_id, contents, schema, **kw):  # out of range: the form refuses, patterns read it
        return schema(
            rule=r.DraftRule(
                name="x",
                trigger=r.DraftTrigger(kind="proven"),
                action=r.DraftAction(holdout_pct=0.9),
            )
        )

    monkeypatch.setattr(gemini, "generate_json", bad)
    res = client.post(
        "/v1/retailer/autopilot/parse",
        json={"text": "When serums become Proven for redness, max 2", "workspace": "retailer"},
    ).json()
    assert res["source"] == "rules" and res["rule"]["trigger"]["goals"] == ["redness"]


def test_the_parse_schema_is_one_gemini_accepts():
    """Vertex's response schema takes string enums only: an int Literal broke parsing (Oct 18)."""
    from google.genai import _transformers

    from app.routes.autopilot_routes import ParseOut

    assert _transformers.t_schema(None, ParseOut)  # raises on a schema Vertex can't take
