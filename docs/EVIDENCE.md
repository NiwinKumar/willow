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
| `instrument_retest` | `engine/scripts/instrument_retest.py --evidence` | real face photos (MST-E) retaken in simulation and measured by the local engine: an instrument test, not people (below) |

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

## Same photo, retaken (`instrument_retest`)

An instrument test, labelled as one on the page ("Same photo, retaken: how often Willow cries
wolf"; `web/src/features/evidence/InstrumentRetest.tsx`). It does not replace the `retest` key,
which stays for real people's repeat check-ins.

- **Photos.** MST-E (Monk Skin Tone Examples, Google with TONL): 19 consenting adults across all
  ten Monk skin tones, expert MST labels per image. `mste_fetch.py` takes up to eight well-lit,
  front-facing photos per person without a mask (`pose` `frontal` or `facing_camera`, `lighting`
  `well_lit`, `mask` 0 in `mst-e_image_details.csv`): 148 photos. Each is first measured as it
  is; only photos the app would accept as taken are retaken (many are refused for a head bent
  down: that tests the pose check, not the noise band), up to four per person
  (`--per-person`), and the refusals are counted on the page. Terms: research or
  human-annotator training only, not for training ML models; images by TONL, all rights
  reserved. The photos stay out of the repo and out of the app; only counts are published.
- **Retakes.** Each photo is resized to 2400 px on its long edge (the size of the app's own sample
  photos), then retaken in simulation. Each check-in gets one room (exposure within half a stop,
  red and blue gains within 6%); each photo in it adds its own small wobble (0.1 stop, 1%), a
  tilt within 3°, scale within 8%, a shift within 3%, blur up to 0.6 px, noise up to 2 levels and
  a JPEG at quality 80-95 (`ROOM`, `PHOTO` in the script).
- **As the app does.** A baseline check-in of 5 retakes (a band needs 3 usable), then 2 later
  check-ins of 3 retakes each, compared with it by the engine (`aggregate.summarize`) with the
  api's rules mirrored (`baselines.build`, `guard_counts`). Every "real_change" is a false alarm.
- **Counted, not dropped.** Retakes the quality checks refuse (with their reason), photos that
  never got a baseline, check-ins with no usable photo, and readings with no verdict.
- **Tone group.** The engine's own ITA group of each baseline; the MST range in each group is
  shown next to it.

Run it again (from `engine/`; the photos go to a folder outside the repo; `mste_fetch.py` reads
only the 148 photos, about 440 MB, out of the 5.6 GB MST-E zip with HTTP range requests):

```bash
cd engine
D=/path/outside/the/repo/mste
uv run python -m scripts.mste_fetch $D --per-person 8
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 uv run python -m scripts.instrument_retest $D/img \
  --meta $D/mst-e_image_details.csv --json $D/instrument_retest.json --workers 2 \
  --evidence ../web/src/data/evidence.json \
  --source "MST-E (Monk Skin Tone Examples), Google and TONL: 19 consenting adults across all 10 Monk skin tones, well-lit front-facing photos without masks" \
  --licence "TONL permission for research or human-annotator-training use only; not for training ML models. Images by TONL, Copyright TONL.CO 2022, all rights reserved. Photos are not in the repo or the app."
```

**The between-room floor (`floor_check`, Nov 29).** The run above found colour and light readings
calling a change far more than 5% (their band comes from one room's light). The floors in
`engine/app/config.py` `ROOM_LIGHT_FLOOR` are learned from the saved run, without measuring again:

```bash
uv run python -m scripts.instrument_retest $D/img --json $D/instrument_retest.json \
  --summary-only --learn-floors --evidence ../web/src/data/evidence.json
```

It splits the people in half (seed 7, within each Monk group), takes each light reading's 95th
percentile of |change| on one half as its floor, and reports false "changed" calls on the other
half before (the within-session band) and after (`max(band, floor)`), per reading and per Monk
group, with each floor as a share of the usual band before (the cost). The page's headline
figures from the whole run are labelled "before the fix" (engine 0.4.2); the held-out
comparison is the before/after. A run on engine 0.4.3 records each baseline's within-session band
(`within_band`) so the "before" stays computable.

The same seed (`--seed 7`, the default) gives the same retakes. `minutes` in the file is how long
the run took (2 workers on a laptop). Keep the workers low on a shared machine: every worker is a
full engine.
