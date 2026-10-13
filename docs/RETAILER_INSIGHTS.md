# Retailer insights (owner: Niwin)

Audience: a multi-brand retailer's merchandising/CRM team. Every view shows "Synthetic demo cohort + team data" when synthetic rows are present. Aggregates only; hide any group with fewer than 10 users.

## Questions the dashboard answers
1. **What do customers need next?** Top goals and unmet needs by segment (skin-tone band, region, age band if collected, goal).
2. **Which products actually help which profiles?** Share of users with `real_change` in the target metric within 4/8 weeks, by product x profile (vs. users with the same goal not using it).
3. **Brand and category performance.** Outcome rate, median time to first real change, continuation rate (still using after 4 weeks).
4. **Assortment gaps.** Profiles/goals with low outcome rates or few catalog options in a price tier.
5. **Routine conflicts.** % of routines with caution-level conflicts; most common clash pairs (an education + cross-sell opportunity).

## BigQuery (dataset `willow_insights`, us-central1)
- `sessions_flat`: user_hash, is_synthetic, region, tone_band, goals, site, session_ts, weeks_since_baseline, metric_id, value, delta, mdc95, verdict.
- `routine_flat`: user_hash, is_synthetic, product_id, brand, category, concerns, started_at, ended_at.
- `products`: catalog copy.
- View `product_outcomes`: per product x concern x tone_band: n_users, real_change_rate_8w, median_weeks_to_change, continuation_4w.
Loaded by batch jobs (`api/scripts/export_bq.py`), not streaming (works in sandbox/free tier).

## Synthetic cohort (`api/scripts/synthetic_cohort.py`)
- 500 users, `is_synthetic=true` on every row; seed fixed for reproducibility.
- Regions mixed (IN, US, UK, KR, SEA, GCC); tone bands spread across all 6 ITA bands; 1-3 goals each.
- Each user: a routine of 2-5 catalog products matching goals; weekly sessions for 8 weeks; 15% dropout.
- Per-metric weekly change = product effect (only for metrics mapped to the product's concerns; effect size drawn per product from a small positive range, some products ~0) + noise drawn from **our measured MDC/SD**; record verdict by comparing |delta| to MDC.
- Document the generator's assumptions on the dashboard's "About this data" panel.

## Looker Studio
One report, 5 pages matching the questions above; connect to BigQuery views; embed in the web `/retailer` page and link it in the deck. In-app charts come from `GET /v1/retailer/insights` for speed.

## Status (Oct 13)
Live. `api/app/cohort.py` generates the synthetic cohort (assumptions in its docstring and on the "About this data" tab); `api/scripts/export_bq.py` loads `products`, `sessions_flat`, `routine_flat`, `routine_conflicts` (WRITE_TRUNCATE). `GET /v1/retailer/insights` (public, aggregates only) runs four small queries and aggregates in `api/app/retailer.py` (cached 10 min); the BigQuery path and a pure-Python path over the same rows give identical results (checked). Outcome = still improved beyond the noise band at the week-8 reading (a single lucky reading does not count). Real rows join only for people who opted in to aggregate insights (`users/{uid}.consent.aggregate_insights_opt_in`, saved by the web once signed in), under a one-way hash with no region or goals; until someone opts in and `export_bq.py` runs, the view is synthetic only and says so. Looker Studio: not built; the in-app view covers the five questions and exports CSV per section.
