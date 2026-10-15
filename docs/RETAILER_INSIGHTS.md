# Retailer insights (owner: Niwin)

Audience: a multi-brand retailer's merchandising/CRM team. Every view shows "Synthetic demo cohort + team data" when synthetic rows are present. Aggregates only; hide any group with fewer than 10 users.

## Questions the dashboard answers
1. **What do customers need next?** Top goals and unmet needs by segment (skin-tone band, region, age band if collected, goal), and how goal demand moves month by month.
2. **Which products actually help which profiles?** Share of users with `real_change` in the target metric within 4/8 weeks, by product x profile (skin-tone band or self-reported skin type) (vs. users with the same goal not using it).
3. **Brand and category performance.** Outcome rate, median time to first real change, continuation rate (still using after 4 weeks and at week 8); per category and goal, how many users reach a real change by week 2, 4 and 8 and how many still use the category's products.
4. **Assortment gaps.** Profiles/goals with low outcome rates or few catalog options in a price tier, with the users per tier.
5. **Routine conflicts.** % of routines with caution-level conflicts, duplicate actives or a missing sunscreen; most common clash pairs (an education + cross-sell opportunity).

## BigQuery (dataset `willow_insights`, us-central1)
Loaded by `api/scripts/export_bq.py` (batch loads, WRITE_TRUNCATE: re-running replaces every table and its schema; creates the dataset if missing; works in sandbox/free tier). `--dry-run` builds and counts without loading, `--today YYYY-MM-DD` fixes the generation date, `--synthetic-only` skips Firestore.
- `sessions_flat`: user_hash, is_synthetic, region, tone_band, skin_type, goals, site, session_ts, weeks_since_baseline, metric_id, delta, mdc95, verdict, improved.
- `users_flat`: one row per person: user_hash, is_synthetic, region, tone_band, skin_type, goals (current), started_at, first_ts, last_ts, last_week.
- `goals_monthly`: one row per person x month with a reading: user_hash, is_synthetic, month (YYYY-MM), last_ts (last reading that month), goals (that month).
- `routine_flat`: user_hash, is_synthetic, product_id, brand, category, concerns, tier, started_week, stopped_week.
- `routine_conflicts`: user_hash, is_synthetic, kind (`retinoid_acid`, `no_spf`, `duplicate_active`, `two_exfoliants`, `bpo_retinoid`, `bpo_vitamin_c`, `other`, or `none`), from the app's rule table (`routine_check.rule_findings`) on the products still in use.
- `products`: catalog copy with goals, target metrics and price tier.

Real rows: people who opted in to aggregate insights (`users/{uid}.consent.aggregate_insights_opt_in`), under a one-way hash, no region. Their goals (the app's 8 ids) and skin type come from `users/{uid}.profile` (opted-in only); only current goals are stored, so every month gets them. Routine start/stop weeks come from `started_at` / `ended_at` against the first reading's baseline.

## Goals
The retailer view groups people by the app's 8 goals (`users/{uid}.profile.goals`, labels as in `web/src/lib/metrics.ts` `GOALS`): Dark spots, Tone evenness, Redness, Blemishes, Pores and texture, Lines, Under-eye, Shine and glow. Catalog concerns map 1:1 (dullness and oiliness both to Shine and glow; dryness has no goal because it is not measured); a test keeps the labels in step with the web. Older rows that hold catalog concerns or the old 7 app ids are mapped on read (`cohort.goals_of`).

## Filters (`GET /v1/retailer/insights?cohort=&range=`)
- `cohort`: `simulated` (synthetic rows only), `real` (opted-in people only), `mixed` (both; default).
- `range`: `30d`, `90d`, `all` (default). A person is in the range when they took a reading in the window; their whole history then counts (an outcome needs the week-8 reading). Month buckets keep only months with a reading in the window. Routine rows have no timestamps, so conflicts follow the people in range.
- Fewer than 10 people in a filter: `empty: true` and only the head count; the page shows "Not enough data in this range" with "Show all time, simulated cohort".
- One BigQuery read is cached 10 min (the last good read is served if BigQuery fails); each filter's aggregates are cached on top of it.

## Synthetic cohort (`api/app/cohort.py`)
- 2,000 recruited people, `is_synthetic=true` on every row; seed fixed for reproducibility. Each takes a baseline on a day in August (45%), September (33%) or October 2026 (22%), then a reading every week up to the export date unless they drop out; people whose first weekly reading is still in the future are not in the data yet (about 1,640 on Oct 15). The random draws do not depend on the date, so a later export only reveals more weeks of the same people.
- Regions mixed (IN, US, UK, KR, SEA, GCC); tone bands spread across all 6 ITA bands; skin type a fixed mix (oily 22%, combination 32%, dry 18%, normal 16%, sensitive 12%); none of them affects outcomes or choices.
- 1-3 goals each, picked with month-dependent weights (an invented shift to demonstrate the month view: oil and blemishes lead in August; dark spots, tone evenness and redness grow into October). About 1 in 4 people with room add a goal (and a product for it) between weeks 3 and 7.
- Routine of 2-5 catalog products matching goals plus a sunscreen for ~60%; about 3 in 10 product uses stop between weeks 2 and 10; 15% drop out between weeks 2 and 7.
- Per-metric weekly change = product effect (only for metrics mapped to the product's concerns; growing over 6 weeks from when the person starts it; effect size drawn per product from 0.2-1.1 x MDC95, ~30% of products ~0) + noise drawn from **our measured MDC/SD**; record verdict by comparing |delta| to MDC.
- The generator's assumptions are on the dashboard's "About this data" panel.

## What the api computes (`api/app/retailer.py`)
Outcome = still improved beyond the noise band at the week-8 reading (a single lucky reading does not count); weeks to change = start of the improved run that holds to week 8. Every group under 10 people is suppressed in the api: cells (`suppressed`), needs-by-month counts (`null`), tier users (`null`), flows and brands (left out, with `brands_hidden` counts), conflicts (left out), median weeks (`null` under 10 changed), tiles (`–`).
- KPIs: users; products with outcomes of the catalog size, with products below 10 people, unused and not measured; per-goal median weeks; continuation at week 8 (people at week 8 with a product for one of their goals still using one).
- Category x goal flow: users at week 8 with the goal using one of the category's products for it; `changed` = how many had a real change (held to week 8) begun by week 2/4/8; `using` = still using one of those products at that week; `base` = people with the goal using none of them (k of n).

## Ask this data (Oct 13; filters and provenance Oct 15)
The retailer view has an "Ask the aggregates" box: Gemini answers from the aggregates on screen (same filters; never rows), with an optional bar chart; numbers and chart labels are validated against the aggregates (GEMINI_SPEC section 6). The api adds `refused` (no numbers: individual-level or unavailable data, or no draft passed the checks), `n` per percent bar (the group the rate is of) and `source` (the aggregate tables used). `product_outcomes` (every product with n >= 10) also feeds the shopper-facing product cards and the advisor, labelled synthetic while the cohort is synthetic: outcomes, not purchases, flow back to shoppers.

## Data Studio (formerly Looker Studio), Oct 14
`api/scripts/publish_looker.py` writes the same suppressed aggregates the app shows (default filter) into small `willow_insights.looker_*` tables (product outcomes, tone coverage, goals, brands, routine conflicts, assortment, about), rates as percents. The report reads only those tables, so it can be shared by link without exposing rows. Re-run after `scripts/export_bq.py`. Report (owned by iamniwin77@gmail.com, shared as unlisted, owner's credentials, so viewers see only these aggregate tables): https://datastudio.google.com/reporting/5147af6b-c268-470a-a420-2277dfcfe7df

## Status (Oct 15)
Live: `GET /v1/retailer/insights` with filters, the retail page (`/retail`) with the design's range and cohort filters, goal demand by month, category flows, skin-profile split, all products with evidence, and Ask with provenance. Until someone opts in and `export_bq.py` runs, the view is synthetic only and says so.
