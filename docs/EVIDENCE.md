# Evidence page (`/evidence`, "How we know")

The in-app page that shows the checks behind Willow's claims with their results, failures
included. It is linked from the landing page (the science section and the footer), the judge tour
and `/science`. Code: `web/src/features/evidence/`.

## The rule

Every result figure on the page is read from `web/src/data/evidence.json` or from the live status
check (`GET /v1/demo/status`). Nothing is typed into the page. A section whose key is missing
from the file is left out. The page's own text holds only descriptions, the noise-band formula
(`docs/METRICS.md`) and the four test questions.

## Who writes `web/src/data/evidence.json`

| Key | Written by | From |
|---|---|---|
| `evals` | `api/scripts/evidence_export.py` | the latest `api/evals/results/*.json`, the cases in `api/evals/cases/`, and the production block of `docs/EVALS.md` |
| `armor` | `api/scripts/evidence_export.py` | `infra/api-env.yaml`: is `MODEL_ARMOR_TEMPLATE` set |
| `cost` | `api/scripts/cost_report.py` | Cloud Logging for `willow-api` and `willow-engine`, at the list prices in that script |
| `a11y` | `api/scripts/evidence_export.py --a11y <summary.json>` | an axe-core and Lighthouse run (below) |
| `retest` | `api/scripts/retest_report.py --write` | volunteers' two check-ins within a day with nothing changed (counts only; not written for fewer than 5 people) |

Each script reads the file again right before writing and replaces only its own keys.

```bash
cd api
python scripts/evidence_export.py              # after every eval run (standard library only)
uv run python scripts/cost_report.py           # needs gcloud with log read access
python scripts/evidence_export.py --a11y path/to/summary.json
```

Run `evidence_export.py` again after `python -m evals.run` writes a new results file, then
rebuild the web app: the page shows whatever the latest file holds.

## What `evals` holds

- `headline`: answers, adversarial cases, invented numbers shown, first answers rejected, fixed on
  the next try, replaced by a fixed reply, and answers shown with a slip the eval caught.
- `rows`: one per job and model, the same columns as the table in `docs/EVALS.md`.
- `failures`: up to five cases quoted from the file, one per (job, case), taking turns between
  three kinds (fixed reply, got through, rejected then fixed), adversarial cases first. Each has
  the question from the case file, the check that caught it and what the person saw.
- `production`: answers rejected before a person saw them, parsed from the production block that
  `scripts/gemini_report.py` writes into `docs/EVALS.md`.

Limits, stated on the page:

- The results file keeps a case's verdicts and the first 400 characters of what was shown. It does
  not keep the text of a rejected first answer, so "rejected, then fixed" cases show what was
  shown after the fix.
- A case whose question or answer names a condition is counted but not quoted, because the app
  uses cosmetic language only.

## Sections that are not from the file

- **What each check does** (`web/src/features/evidence/checks.ts`): one line per validator with a
  link to its file. Edit it when a validator changes.
- **Try to break it**: four questions that open Wisp with the question typed
  (`/home?advisor=1&ask=...`). No new api.
- **Measured, with its own error bars**: the noise band in words and the "Not shown yet" list
  (real-skin test and retest across skin tones, a band per skin-tone group, clinical validation).
  When the file has a `retest` key, its counts are shown ("Tested on real skin") and the first
  line leaves the list.
  Mei's same-week retakes are not shown: her journey is read from the api, so there is no
  generated file of those numbers in the web app.
- **Simulated, and labelled**: the simulated and opted-in people counts come from the live status
  check (`bigquery.synthetic`, `bigquery.people`); without it the lines show no number.

## Accessibility audit

The `a11y` key is one run of axe-core and Lighthouse (accessibility category) in headless Chrome,
at 1350 x 940 and at 412 x 823 with touch, over `/`, `/judge`, `/evidence`, `/science`,
`/welcome`, `/home`, `/progress`, `/routine`, `/you` and `/journey`. The run writes a
`summary.json` (`{meta: {audited_at, base, lighthouse, axe}, rows: [{page, mode, lighthouse,
axe: [{id, impact, n}]}]}`) that `evidence_export.py --a11y` turns into the table. The page says
the date and what it ran against. Automated checks find only part of what matters, and the page
says that too.
