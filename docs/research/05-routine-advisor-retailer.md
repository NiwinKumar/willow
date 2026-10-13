# Research 05: Routine screen, Advisor chat, Retailer dashboard — best-in-class UX

Date: 2026-10-13. For Willow (docs/UX_SPEC.md screens 8-10, docs/GEMINI_SPEC.md features 3-5, docs/RETAILER_INSIGHTS.md, docs/CATALOG_SPEC.md).

How to read this: every pattern below is tagged with where it comes from. "Observed" = taken from the product's own docs/pages or a hands-on teardown. "Secondary" = from press, vendor blogs or app-store copy (treat as directional). "Proposal" = my synthesis for Willow, written to fit the existing contract (`conflicts[].severity` enum `info | caution | avoid_same_routine`, `duplicates`, `gaps`, `stores[]` with `store/url/region`, the five retailer questions, the "<10 users hidden" rule and the `Synthetic demo cohort + team data` banner). Nothing here proposes a schema change; where a UI needs a field the contract lacks, it is called out as "derive in web".

Caveat on evidence quality: there is no published head-to-head UX study of INCIDecoder / SkinSort / Skincarisma / Picky, no public screenshots of how Skin Bliss renders a clash, and no public account of how Sephora/Nykaa/Ulta merchandisers consume efficacy or outcome data. Those gaps are stated explicitly rather than papered over.

---

## 1. Routine screen

### 1.1 What the reference tools do (observed / secondary)

| Tool | Ingredient presentation | Routine / conflicts | Takeaway for Willow |
|---|---|---|---|
| INCIDecoder (observed on a product page) | Top: claim tags ("Alcohol Free", "Fragrance and Essential Oil Free"); "Key Ingredients" grouped by function ("Anti-acne", "Skin brightening"); "Other Ingredients" by function; a "Skim through" table with columns `Ingredient name / what-it-does / irr., com. / ID-Rating`; ratings are playful words ("superstar", "goodie", "icky") not numbers; long write-ups collapsed behind "Expand to read more". | None. | Function-first grouping ("what this product is for") beats a raw INCI dump. Collapsed detail keeps the page scannable. Word labels are friendlier than scores, but Willow must not rate ingredients (facts only). |
| Skincarisma (observed) | Summary "Excellent (84/100)" + "Summarised from our ingredient analysis - not brand marketing copy"; "At a glance" block (type, ingredient count, low-risk count, fragrance); claim tags ("Paraben-Free", "Fungal Acne Safe"); explicit empty state "No Notable Effects & Ingredients"; table with EWG + CIR columns and hazard filter chips; per-ingredient one-line notes ("Potentially comedogenic - can block pores"); hedge copy right next to scores ("EWG flags hazard, not real-world risk... Treat these as things to research, not verdicts"). | No routine creator (per SkinSort's comparison). | Explicit empty states and hedges placed next to the number, not in a footer. Two safety systems side by side is confusing; Willow shows one thing per row. |
| SkinSort (secondary: its own pages; routine pages 403 to fetch) | Compatibility score vs the user's skin profile; 60+ filters. | "Routine Creator analyzes the products you've added to your routine and gives you a warning if they might be incompatible." Only one of the three with a conflict check. | Conflict check is table stakes; SkinSort does not expose severity tiers or fixes publicly. Willow's severity + suggestion is a differentiator. |
| Skin Bliss (secondary: App Store copy) | Scan by photo; Pro tier gates "routine timelines" and "photo comparisons". | "Check for clashes, duplication, or irritation risks between products in your routine." Routine Evaluator: "what goals it supports, what's missing, and how long to expect results." Routine Builder: "Schedule products with ingredient-smart logic, daily or on rotation." | The three-bucket model (clash / duplication / gap) is exactly Willow's `conflicts / duplicates / gaps`. Skin Bliss does not say how it reaches conclusions; Willow shows `source: rule` vs `source: model`. "Rotation" scheduling is the right shape for an "alternate nights" fix. |
| Picky (secondary, 2021 press) | 30k products, "risky ingredients" listed; Routine tab is a tracker, not a checker. | Tracking only. | Community/education angle; not relevant for MVP. |
| Yuka (observed: help center) | Four ingredient risk levels with coloured dots: Risk-free (green), Low (yellow), Moderate (orange), High (red); product score is capped by the single riskiest ingredient (red -> <25/100, orange -> <50/100); "risks for each ingredient appear on the product sheet, along with their scientific sources"; centre tab is the camera. | None. | "Worst item caps the whole" is a clear mental model: Willow's routine header should be capped by the most severe open conflict. Colour + dot + word, never colour alone. Camera as the primary affordance. |
| Think Dirty (secondary) | 1-10 "Dirty Meter", lower = better. | None. | Inverted scales confuse; avoid. |
| Paula's Choice dictionary (observed: dictionary pages) | Five word tiers BEST / GOOD / AVERAGE / BAD / WORST plus two non-rating states "Unknown" (not in dictionary, logged for review) and "Not rated" (not yet reviewed). Filter by rating + search. | Beautypedia checker offers alternatives when BAD/WORST present. | Design the "unknown ingredient" state explicitly; do not render unknown as "safe". |
| Sephora Routine Builder / Nykaa Skin Scan / Olive Young Skin Scan (secondary) | Quiz-first (Sephora), selfie + questionnaire -> categorized results -> routine "from cleansing to skincare and sun care" -> products (Olive Young); re-scan reminders tied to loyalty points; Olive Young plans a "skin change report" showing trends. | Routine is a recommendation output, not an editable checked list. | Retailers end at "here is a routine". Willow's loop (routine -> measured outcome -> adjust) is the thing none of them show; the Routine screen must make that loop visible. |
| Curology (secondary) | Single custom formula; label lists actives and concentrations; provider messaging adjusts formula; strict 3-angle progress photos; before/after described as "motivating". | n/a | Show active + % on the product row when the label scan captured it (`key_actives[].pct`). |

### 1.2 Ingredient label scan flow (proposal, grounded in the OCR findings)

Evidence: scanner apps converge on "find the list, fit the whole list in the frame, confirm focus, shoot"; a Gemini competition project inserted a user check between OCR and analysis; a write-up notes Gemini "prioritizes interpretation over strict verbatim reproduction", which is the reason for the confirm step; one app sends only extracted text, not the photo, to the cloud (privacy selling point).

Flow (6 steps, each a single screen or sheet on iPhone Safari):

1. Entry. On the Routine screen, one primary button "Add product" opens a sheet with two equal options: "Scan the label" (camera icon) and "Search the catalog". Below: "Tip: the ingredient list is usually on the back or the box."
2. Capture. Full-screen camera with a rounded-rectangle guide and copy "Fit the whole ingredient list inside the frame". Live hints (reuse the capture-guide component): "Move closer", "Hold still", "Too dark". Secondary actions: "Choose photo", "Add another side" (front for brand/name, back for INCI; GEMINI_SPEC accepts front and/or back). Accept up to 2 images.
3. Reading. Progress stages mirror the report screen: "Reading the label -> Finding the product -> Checking your routine". Typical 5-10 s. Show the thumbnail being read.
4. Confirm (the step most apps skip and the one that matters). Card with: brand + product name (editable text fields), category chip (from the enum), "Key actives" chips with % when present ("Niacinamide 10%"), and a collapsed "Ingredients (24)" section showing the INCI list as text with low-confidence tokens underlined and tappable. Copy: "Check the name and actives. You can edit anything that was misread." If `confidence` is below a threshold, surface it: "Some of this was hard to read. Please check the ingredients." Primary: "Looks right". Secondary: "Retake".
5. Match. If the catalog fuzzy match hit: "Found in catalog: The Ordinary Niacinamide 10% + Zinc 1%" with "Use this" / "Not this product". If no match: "Not in our catalog yet. We'll keep it as your own entry." (custom routine entry; no store links, no retailer insights row).
6. Place. Sheet: "When do you use it?" with AM / PM / Both toggles and an optional "Started on" date (defaults to today; the date is what powers the outcome link in 1.5 and the timeline marker). Then "Add to routine". Immediately run the compatibility check and show any new flag inline with a subtle slide-in, not a modal.

States to design: camera permission denied (offer "Choose photo"), blur/glare fail ("We couldn't read this. Try less glare."), list cut off ("Looks like the list continues. Add another photo?"), Gemini timeout (keep the photo, offer "Try again" or "Search instead"), unknown ingredient tokens (keep them as text; never drop them silently).

Privacy copy on the capture screen footer: "Label photos are used only to read the ingredients and are not kept." (Confirm against the actual storage behaviour before shipping the sentence.)

### 1.3 Routine list layout (proposal)

- Header: "Your routine" + a single status line that is capped by the worst open item (Yuka's cap rule applied to routines): "1 thing to look at" / "Looks compatible" / "Add products to check compatibility". Never a numeric routine score.
- Two sections, AM and PM, each an ordered list. Default order within a section follows the common cleanse -> treat -> moisturise -> SPF sequence (cleanser, toner/essence, serum/treatment, moisturiser, sunscreen (AM) / night cream (PM)); derive the order in web from `category`. Allow drag to reorder; order is not a contract field, so it is local.
- Product row anatomy (one line on phones, two on desktop):
  - Left: neutral category icon (CATALOG_SPEC: no product images).
  - Title: brand + product name; subtitle: key actives chips ("Retinol 0.5%", "Niacinamide").
  - Right: outcome chip (see 1.5) and a flag dot+icon when the product is part of an open conflict/duplicate.
  - Overflow menu: "Move to AM/PM", "Change start date", "Stopped using" (sets `ended_at`, keeps history for the timeline), "Remove".
- A product used AM and PM appears in both sections with a small "AM + PM" chip rather than being duplicated as two entries.
- Below the lists: "Compatibility" panel (1.4), then "Missing steps" (gaps).
- Empty state: illustration + "Add your first product by scanning its label." + the two buttons. Demo/read-only journey shows the notice bar used elsewhere ("You're viewing a sample journey").

### 1.4 Conflict, duplicate and gap presentation (proposal)

Severity mapping to the contract enum and the visual language (never colour only; icon + word + colour, WCAG AA):

| Contract | Label on screen | Icon / colour | Meaning (from the rule table) | Default suggestion shape |
|---|---|---|---|---|
| `avoid_same_routine` | "Keep these apart" | Octagon icon, accent-warm (not alarm red) | Same-routine use is not advised | AM/PM split or alternate nights, given as a one-tap change |
| `caution` | "Use with care" | Triangle icon, amber | Likely irritation or reduced effect | Frequency or timing change |
| `info` | "Good to know" | Circle-i icon, grey/green | Minor; separate if convenient | Optional |
| `duplicates[]` | "Same active twice" | Two-squares icon, neutral | Two products share an active | "Keep one" with both products listed |
| `gaps[]` | "Missing step" | Plus-in-circle, willow green | Something the routine needs | "Add daily SPF" -> opens catalog search pre-filtered to sunscreen |

Lesson from the ingredient-pair literature: irritation risk and efficacy loss are different axes (vitamin C + benzoyl peroxide is "safe but pointless"; retinoid + AHA is "effective but irritating"). The contract has one `severity`, so encode the axis in `issue` wording: "may irritate" vs "may cancel each other out". Do not invent a second scale in the UI.

Card anatomy (one card per item, stacked, most severe first):

```
[icon] Use with care                              rule-based
Retinol serum (PM) + Glycolic toner (PM)
These can irritate when used the same night.
Suggested change: alternate nights.
[ Apply: alternate nights ]   [ Tell me more ]   [ Dismiss ]
```

- Top-right provenance tag reflects `source`: "rule-based" vs "AI-suggested" (the same "AI-suggested" wording GEMINI_SPEC already uses for labels). Rule-based items cannot be dismissed permanently; AI-suggested ones can.
- Product names are tappable and scroll to the row; the row shows the matching flag dot so the user sees both ends.
- "Apply" performs the change when it maps to a schedule (move to AM, alternate nights = set a rotation flag on the entry; local state only). "Tell me more" opens the Advisor with the conflict pre-filled ("Why should I keep retinol and glycolic apart?"), which keeps all explanations inside the validated-JSON path.
- Wording constraints (UX_SPEC principle 2): the heading says "Suggested change", not "Fix"; never "bad for your skin"; never disease names.
- Severity summary at the top of the panel: "1 to keep apart, 2 to use with care, 1 missing step". Clicking a count filters.
- Duplicates list the shared active first: "Niacinamide appears in 2 products: X, Y. One is usually enough." Do not say which to keep unless the Advisor is asked (facts only).
- Gaps are phrased as the need, then the why: "No sunscreen in your AM routine. Retinoids make skin more sun-sensitive. Add a daily SPF." with a "Find a sunscreen" button into catalog search (concern filter + category=sunscreen).
- Re-check timing: run on every add/remove/move; show a tiny "Checked just now" timestamp; if Gemini fails, show "Couldn't check compatibility. Try again." and keep the last good result greyed with "from earlier".

### 1.5 Link from each product to its measured outcome (proposal; this is Willow's unique thing)

Data available: routine entry `started_at`/`ended_at`, product `concerns` -> CATALOG_SPEC concern->metric map, sessions with `delta`, `mdc95`, `verdict` per metric.

- Outcome chip on the product row, computed in web from the target metrics for that product's concerns, using only sessions after `started_at`:
  - "Real change in dark spots" (accent colour, the same "real change" treatment as the report) when at least one target metric has `real_change` in the expected direction after the start date.
  - "No clear change yet (3 wks)" (grey) when all target metrics are `within_noise`.
  - "Too early to tell" when fewer than N sessions or < 2 weeks since start.
  - "Not measured" when the product's concerns map to no measured metric (e.g. a cleanser).
- Tapping the chip opens the Timeline pre-filtered to that metric with the product's start marker highlighted and a sentence that quotes numbers from the engine only: "Since you started X (3 weeks ago): dark spots -1.9, noise threshold 1.2 -> real change." Causation stays hedged per GEMINI_SPEC ("may be linked to").
- When two products target the same metric, the chip says "Shared with Y" and the timeline shows both markers; do not attribute the change to one of them.
- This same component feeds the Advisor ("Is my niacinamide doing anything?") so the answer and the Routine chip never disagree.

---

## 2. Advisor chat

### 2.1 What the reference assistants do (observed / secondary)

| Assistant | Product presentation | Trust / disclosure | Citation | Takeaway |
|---|---|---|---|---|
| ChatGPT shopping (observed: OpenAI help article) | Carousel of product cards; click a product -> list of sellers "ordered by availability, price, quality, and whether they are the maker or primary seller"; one seller may be tagged "Best price"; "Instant Checkout" tag when eligible. | "selected independently by ChatGPT and are not ads, nor influenced by any OpenAI partnerships"; admits "there may be some delay before [pricing] is reflected". | n/a | Seller list per product with explicit ordering rule + a freshness disclaimer. Willow should state its ordering rule (region first, then alphabetical) and the price-as-of date. |
| Perplexity Shopping (observed: blog; secondary: press) | Cards with image, price, pros/cons ("long battery" / "limited features"), review summary; one retailer link per card; "Buy with Pro". | "These cards aren't sponsored - they're unbiased recommendations". | Inline publisher chips "domain +3" at the end of claims; popover with favicon, domain, headline, excerpt, 1/N nav; sources row with favicon stack and count; "Wrong sources" feedback chip. Teardown: "Trust starts with showing retrieval happened." | Willow's "sources" are the user's own metrics and the catalog: use the same chip pattern but the chip reads "Your dark spots" / "Catalog". Show retrieval ("Checked your results. Searched catalog.") before the answer. |
| Google AI Mode shopping (observed: Google blog) | Browsable side panel that refreshes as the query narrows; listings show reviews, prices, colour options, availability; "track price"; agentic checkout ends in an explicit "buy for me" confirmation. | Merchant eligibility rules rather than a trust score. | n/a | A panel that updates as the conversation narrows is a good desktop layout for Willow (chat left, cards right). |
| Amazon Rufus (secondary: alby teardown) | Products inside the answer; predicted starter questions on PDP; swipe-down to dismiss. | - | - | Teardown found <0.1% of shoppers type long questions into a search bar; suggested-question chips and an embedded entry point drive usage. Willow should seed the Advisor from context (a conflict card, an outcome chip), not only from a blank chat. |
| Klarna assistant (secondary) | Single chat surface for search, compare (price, features, reviews), buy. | - | - | Keep everything in one surface; no modal detours. |
| Shopify Sidekick (secondary) | Sidebar beside the dashboard; diagnostic questions ("My sales dropped last month - what caused that?"). | - | - | Pattern for a future retailer-side assistant; out of MVP scope. |
| Citations and trust (AAAI 2025 study) | - | - | Trust rose when citations were present (even random ones) and fell when users checked them and found them wrong. | Citations are a liability if wrong: every number chip must deep-link to the exact metric it quotes, and the digit validator must reject new numbers. |
| Medical-disclaimer research (secondary, 2025 study) | - | Disclaimers in LLM health answers fell from 26% (2022) to 1% (2025); generic "see a doctor" did not count; lawsuits allege the boundary was dropped in later turns. | - | Put the scope line next to the first answer and repeat it when the topic shifts to diagnosis/medication; do not rely on a footer. |

### 2.2 Message layout (proposal)

- Mobile: single column; user bubbles right, Willow messages full-width without a bubble (document style reads better for cards). Desktop: chat column max 680px left; a sticky right rail shows the last turn's product cards and a "Your numbers used in this chat" list (AI Mode's refreshing panel, Sidekick's rail).
- Each Willow turn, in order:
  1. Retrieval line (small, grey, collapsible): "Checked your results (Oct 10) · Searched catalog: dark spots, under ₹1,500 · Checked your routine". Built from the tool calls actually made; if no tools were called, say "No lookups needed."
  2. Message text. Numbers appear as chips (2.4).
  3. Product cards (2.3), max 4 visible, "Show 4 more" if the tool returned 8.
  4. Follow-up chips from `follow_up_suggestions` (max 3).
- Streaming: stream the text; render cards only after the final schema-validated message (GEMINI_SPEC: tool loop in text, then one `response_schema` call). Show a "Writing..." skeleton, not a spinner.
- Failure/validation: if the validator rejects the output after retry, show the template answer with "I could only share the numbers I have:" and the raw metric list. Never show a half-answer with unverifiable digits.
- Rate limit (20 turns/day): show remaining at 5 ("5 questions left today"), and a friendly stop state.

### 2.3 Product card anatomy (proposal; facts only, no images, no ratings)

```
[category icon]  Minimalist 2% Salicylic Acid Serum        ₹599 · as of 12 Oct
                 For: blemishes, oiliness · Serum · mid-range
                 Key actives: Salicylic acid 2%
                 In your routine: no          Measured outcome: (hidden if none)
                 [ Nykaa ]  [ Amazon ]  [ Brand site ]        [ Add to routine ]  [ Ingredients ]
```

- Title, price with currency and "as of <date>" (from the catalog record; ChatGPT's freshness disclaimer made explicit).
- "For:" lists catalog `concerns` using the user-facing goal names; bold the concern the user asked about.
- Key actives chips; "Ingredients" expands the INCI inline (same component as the Routine confirm step).
- "In your routine: yes/no". If yes, show the outcome chip from 1.5 so the Advisor and Routine agree.
- No pros/cons, no review summaries, no "best pick" badge: CATALOG_SPEC forbids marketing copy and scraped ratings. The card is deliberately plainer than Perplexity's; say why once in the Advisor intro ("We show ingredients, price and where to buy. No reviews, no sponsorship.").
- "Add to routine" opens the AM/PM/start-date sheet from 1.2 step 6 and then runs `check_routine`; the Advisor's next message should acknowledge the resulting flags.
- Tap target minimum 44px; cards swipe horizontally on phones only if 3+; otherwise stack.

### 2.4 Multi-store buttons (proposal)

- Render every entry of `stores[]` as a secondary button labelled with the store name only; sort by the user's region first (IN -> Nykaa, Amazon.in; US -> Sephora, Amazon.com), then "Brand site", then others. State the rule once in a tooltip/info: "Stores are listed by your region, then alphabetically. Willow earns nothing from these links."
- Buttons open in a new tab (`rel="noopener"`); show an external-link icon. Do not pre-select or highlight any store; the user picks (product decision: no sponsored ranking).
- Prices per store are not in the catalog; show one catalog price and the date; do not fabricate per-store prices. If the price currency differs from the user's region, show it as-is with the currency code.
- Dead links: run a weekly HEAD check script; mark failures "link may be out of date" rather than removing the store.

### 2.5 Citing the user's own numbers (proposal)

- Every number in the message that comes from the metrics input is wrapped as a chip: "dark spots −1.9 [Your results]". The chip is built client-side by matching `quoted_numbers` against the metrics payload (same matching the validator uses), so any number without a match fails validation rather than rendering unlinked.
- Chip tap/hover: popover with metric label, value, delta, noise threshold (mdc95), verdict badge and date, plus "Open in timeline". This is Perplexity's chip -> popover -> deeper surface ladder, with the user's data as the source.
- Verdict wording in prose must match UX_SPEC: `within_noise` -> "no clear change yet"; indicative metrics -> "trend". The Advisor must never say "improved" for `tone_ita`.
- When the user has no sessions: the Advisor says so plainly ("You don't have measurements yet, so this is based only on your goals and routine.") and suggested prompts shift to capture ("How do I take a baseline?").

### 2.6 Suggested prompts (proposal; Google conversation-design guidance: popular answers, one per category, don't duplicate the prompt text)

Starter chips (show 4, one per category):
- Outcome: "Is my niacinamide doing anything?"
- Shopping: "What should I add for dark spots under ₹1,500?"
- Routine: "Can I use retinol and glycolic acid together?"
- Capture: "When should I take my next photos?"

Context-seeded chips (replace the starters when arriving from another screen):
- From a conflict card: "Why keep retinol and glycolic apart?"
- From an outcome chip: "Should I keep using X?" (the answer must hedge causation)
- From a gap: "Find me a sunscreen that works with retinol"

Rules: max 3-4 chips, under ~40 characters, sentence case, specific to the user's goals (fill the goal and currency from profile), never a chip that invites diagnosis ("Is this mole...").

### 2.7 Guardrails copy (proposal)

- Intro line pinned above the first message (not a footer): "I can explain your measurements, check your routine and find products from a facts-only catalog. I can't diagnose skin conditions or replace a dermatologist."
- Repeat on topic shift (detected in web by keywords or by a `notes` flag from the tool loop): "This sounds medical. For a changing mole, a rash or pain, please see a dermatologist."
- Mole mention anywhere -> the GEMINI_SPEC dermatologist note verbatim.
- Shopping transparency, shown once per session under the first product cards: "Products come from our catalog of ingredients, prices and store links. No reviews, no ads, no commissions."
- Out-of-scope requests (lightening/whitening, prescription dosing): "Willow doesn't rank skin by lightness and doesn't advise on prescriptions. I can help with evenness of tone and your measured results."

---

## 3. Retailer dashboard

### 3.1 What the reference dashboards do (observed / secondary)

| Reference | Pattern | Use in Willow |
|---|---|---|
| Stripe Dashboard (secondary roundups; Stripe docs for test mode) | Dense but orderly: right-aligned money, monospace numerals, sticky table headers, icon + colour for status; the page answers one lead question at the top ("did revenue grow this week?"). Test mode: full-width orange banner + always-visible "Test mode" toggle; docs tell users to assume live impact unless they "see a test data banner". | Each tab opens with one lead question and one headline number. Synthetic data gets a persistent full-width banner, not a badge. |
| Linear Insights (observed docs) | A side panel over the current view; measure + slice + optional segment; bars for counts, scatter for durations with percentile markers (25/50/75/95); table under the chart that cross-highlights; CSV export; full-screen expand. | "Measure x slice" is the right mental model for "outcome rate by product x tone band". Use scatter/strip for time-to-change with a median marker. Always pair chart with a table. |
| Shopify Analytics (observed blog) | Real-time dashboard of "most important metrics at a glance", customizable; period-over-period comparison on by default; configurable metric/dimension in a side panel. | Comparison is less relevant for an 8-week synthetic cohort; keep a "weeks since baseline" selector (4 / 8) instead of date compare. |
| Google Analytics thresholding (observed) | Data-quality indicator at the top of the report: "Google Analytics has applied thresholding to one or more cards in this report"; cards show data only above minimum aggregation; advice is to widen the range. | Same two-level pattern: a report-level indicator plus a per-card placeholder. |
| Viva Insights minimum group size (observed docs) | Default 5, admin-configurable, hard floor; applied to HR-attribute slices; bars under threshold render as grey/white "no data" columns, the group stays visible; histograms exempt because bins are not HR groups. | Keep suppressed groups visible as grey placeholders so the axis does not silently change; enforce in the query (BigQuery view), not in the chart. |
| CultureMonkey / Domo / Metabase threads (secondary) | Apply the rule "once to the whole report, and again to every individual demographic group"; apply at calculation time, not display; table views and drill-downs leak what charts hide; hiding widgets leaves confusing gaps. | Suppress in `product_outcomes` view and in `/v1/retailer/insights`; return `n_users` and a `suppressed: true` flag per cell; never hide the widget. |
| Demo-mode pattern (observed blog) | "DEMO" badge + yellow banner; realistic (not lorem ipsum) data; same code paths as production; bundled deterministic fixtures reused as tests; review generated data adversarially. | Matches RETAILER_INSIGHTS (seeded generator, `is_synthetic` on every row). Add the "About this data" panel the doc already asks for. |
| Looker Studio embed (observed docs / forum) | File > Embed, iframe; filter via URL params; mobile embeds often degrade to a static title. | Embed only on desktop; on narrow widths show the native charts and a "Open full report" link. |
| Amplitude Experiment (observed docs) | CI relative to zero is the signal; "needs more data to be conclusive" without showing the required N frustrated users. | Show "n of N needed" wherever a cell is inconclusive; show the MDC band, not a p-value. |
| Retail media / seller portals (secondary) | Nykaa seller panel reports "sell-through, stock cover, ageing and SKU-level performance"; UB Media gives "closed-loop campaign level reporting"; category managers list VIQ/Numerator/Nielsen; NIQ 2026: "clinical brands captured over one-third of dollar sales". | Merchandisers already speak in sell-through and rate-of-sale; translate outcome metrics into that vocabulary ("outcome rate" next to "continuation rate", the retention analogue). No public evidence that any retailer consumes efficacy data today; this is the pitch, and the dashboard should say so. |

### 3.2 Information architecture for the five questions (proposal)

Global frame (desktop-first, 1280px grid, 12 columns; collapses to a single column with native charts under 900px):

- Top bar: Willow Retailer · banner (3.3) · controls: Cohort (Synthetic + team / Team only), Region (All, IN, US, UK, KR, SEA, GCC), Tone band (All, 6 ITA bands), Window (4 wks / 8 wks), Price tier (All, budget, mid, premium). Filters are global and persist across tabs.
- Left nav or top tabs in this order (matches RETAILER_INSIGHTS numbering): 1 Needs next · 2 Product outcomes · 3 Brand & category · 4 Assortment gaps · 5 Routine conflicts · About this data.
- Every tab: lead question as the H1 (verbatim from the doc), one headline KPI row (3-4 stat tiles with n), the primary chart, a table under it with CSV export, and a one-line "How this is computed" link to the About panel.

Tab 1 — What do customers need next?
- Headline tiles: Active users (n), Top goal (share), Share with an unmet goal (no real change in target metric by week 8), Median weeks to first real change.
- Primary: horizontal stacked bars, goals on the y-axis, segments = "real change / no clear change / too early", sorted by unmet share. Secondary: small multiples by tone band (6 panels) using the same bars; a panel with n<10 renders grey with "Hidden: under 10 users".
- Table: goal x segment with n, unmet %, top 3 products used.

Tab 2 — Which products actually help which profiles?
- Headline: products with evidence (n_users >= 10 in at least one profile), best outcome rate (with n), median time to change.
- Primary: heatmap, products (rows, grouped by concern) x tone band (columns); cell = real_change_rate_8w, cell label shows "62% (n=41)"; suppressed cells hatched grey "n<10". A toggle "vs same goal, not using" shows the lift as a diverging colour scale (the doc's control comparison).
- Click a product row -> drawer: strip/dot plot of weeks-to-first-change per user (Linear-style, median marker), continuation at 4 weeks, concerns, price tier, store availability by region.
- Table: product, concern, tone band, n, outcome rate, lift vs non-users, median weeks, continuation.

Tab 3 — Brand and category performance
- Headline: brands with evidence, category with highest outcome rate, overall continuation 4w.
- Primary: dot plot, brands on y, x = outcome rate, dot size = n, error bar = Wilson 95% interval; a vertical reference line for the cohort average. Secondary: category bars with continuation overlaid as a dot.
- Guard: a brand with fewer than 10 users is listed at the bottom under "Not enough data yet" with its n, not omitted.

Tab 4 — Assortment gaps
- Headline: profile x goal combos with no catalog option in a tier; combos with low outcome rate; the single largest gap.
- Primary: matrix, goals (rows) x price tier (columns), cell shows "catalog options / outcome rate" with a gap badge when options < 2 or outcome rate below the cohort median; filter by region (store availability from `stores[].region`).
- Table: goal, tier, region, options, outcome rate, n, suggested action ("Add a mid-tier option for dark spots in KR").

Tab 5 — Routine conflicts
- Headline: % routines with any `caution`+ conflict, % with a missing SPF, most common pair.
- Primary: ranked bar list of clash pairs ("Retinoid + AHA/BHA, same night": 18% of routines) with the suggested change text beside each; second chart: gaps by type (no SPF, no moisturiser) by region.
- Framed as the doc says: an education and cross-sell opportunity, so each row has "Products that resolve it" (e.g., sunscreen SKUs in the catalog by tier).

About this data
- The synthetic generator's assumptions in plain language (500 users, 8 weekly sessions, 15% dropout, effect sizes drawn per product, noise from measured MDC/SD, seed), the suppression rule, the definition of "real change" (|delta| > MDC95 in the target direction), and a sentence on what team data is (count of real users). Link to docs/METRICS.md for judges.

### 3.3 Synthetic-data banner and labelling (proposal)

- Persistent full-width banner at the top of every retailer page (Stripe test-mode treatment, warm amber, not red): "Synthetic demo cohort + team data · 500 simulated users and 4 real users · Simulated outcomes follow Willow's measured noise model · [About this data]". Height ~40px, cannot be dismissed, repeats as a small chip on exported CSVs ("includes synthetic rows") and in chart footers ("n includes synthetic users").
- Cohort toggle (Synthetic + team / Team only). Switching to "Team only" will suppress almost every cell under the <10 rule; show the expected message rather than an empty page: "With real users only, most groups are under 10 and hidden. Switch back to include the synthetic cohort."
- Chart-level legend entry "simulated" when a series mixes both; never visually distinguish synthetic vs real users inside a chart (it invites reading real users individually, which the suppression rule exists to prevent).
- Demo-mode hygiene from the pattern write-up: realistic brand/product names (the real catalog), deterministic seed, same render code path for synthetic and real rows, adversarial review of generated numbers (no product should show a 100% outcome rate).

### 3.4 Small-group suppression (proposal)

- Enforce in two places: the BigQuery view (`HAVING n_users >= 10`) and the API (`/v1/retailer/insights` returns `{value: null, n: 7, suppressed: true}` for small cells). The web never computes a suppressed value.
- Apply per cell and per filter combination (CultureMonkey's "twice" rule): a filter that makes the whole page's n < 10 shows a page-level notice "This filter leaves fewer than 10 users. Widen the filter to see data." (GA's "expand the date range" advice, adapted.)
- Visual: keep the row/column/bar, render a hatched grey placeholder with the label "Hidden (under 10 users)"; tooltip explains why. Do not drop the category from the axis.
- Tables show "—" with the same tooltip; CSV export writes `suppressed`.
- Differencing guard: when a parent total is shown alongside children and exactly one child is suppressed, suppress the second-smallest child too (complementary suppression), or omit the parent total in that view. This is cheap to implement for the heatmap and bars.
- Always show n next to any rate ("62% · n=41"); never show a rate without n.

### 3.5 What a merchandiser wants to see first (proposal, evidence is thin)

Public evidence about buyer behaviour is limited to seller-panel feature lists (sell-through, stock cover, ageing, SKU-level performance), retail-media reporting (closed-loop campaign metrics), and category-manager job specs (Nielsen/Numerator/VIQ). No public source shows a retailer using efficacy or outcome data in range reviews. Design accordingly:

- Open on Tab 2 (product outcomes) by default, not Tab 1: it is the slide that is new to them. The first screen should answer "which of my SKUs have evidence they work, for whom" in one heatmap with n in every cell.
- Translate vocabulary: "Outcome rate (8 wks)" = share of users with a real change in the target metric; "Continuation (4 wks)" = still using at week 4 (their repeat-purchase analogue); "Time to first change" (median weeks) = the number that sets expectations for returns and reviews.
- Always pair an outcome number with a commercial lever: a gap -> a tier/region to add; a conflict pair -> an SPF cross-sell; a low continuation product -> an education opportunity.
- Give them the caveat up front and then stop repeating it: one "About this data" panel, one banner, n on every number.
- Export: CSV per table and a "Copy chart as PNG" for decks; merchandisers live in slides.

### 3.6 Looker Studio embed vs native charts (proposal)

- Native charts (from `/v1/retailer/insights`) are the primary, fast, mobile-safe path and carry the suppression flags and banner. Use one charting library with a shared palette (dataviz skill palette; one accent for "real change", grey for suppressed/no change, hatched for hidden).
- Looker Studio: embed one page per tab in a collapsed "Full report" section on desktop only (iframe, `width=100%`, fixed height), filtered by URL parameters to the same region/tone band when possible; on narrow screens show the "Open full report" link instead (embeds degrade on phones).
- Both sources must apply suppression in the BigQuery view, so Looker cannot show what the app hides.

---

## 4. Anti-patterns to avoid

Routine
- Numeric product or routine safety scores (Yuka/Skincarisma 0-100) and word ratings of ingredients (INCIDecoder "icky", Paula's Choice "WORST"): Willow is facts-only and never rates ingredients; show functions and actives.
- Inverted scales (Think Dirty: lower = better).
- Colour-only severity; a single "danger" colour for everything.
- Silent OCR: sending unconfirmed OCR text to analysis (Gemini interprets rather than transcribes).
- Dropping unknown ingredients or rendering "unknown" as "fine".
- Flagging the niacinamide + vitamin C myth (explicitly "do not flag" in GEMINI_SPEC).
- "Fix your skin" / "bad for your skin" / disease names; use "Suggested change" and cosmetic wording.
- Removing a stopped product from history (breaks the timeline markers).

Advisor
- Pros/cons, review summaries or "best pick" badges on cards (no scraped reviews, no sponsorship); numbers not present in the metrics payload (validator must reject); "improved" for `tone_ita`.
- Highlighting one store or defaulting a "Buy" button; per-store prices Willow does not have; hidden freshness of prices.
- Disclaimer only in the footer or only on turn 1; generic "see a doctor" without stating what the tool cannot do.
- Blank-chat entry only (Rufus lesson: people do not type long questions unprompted); the Advisor must be reachable from conflict cards and outcome chips with the question pre-filled.
- Rendering product cards from streamed, unvalidated text.

Retailer
- A dismissible or badge-only synthetic label; mixing synthetic and real users as distinguishable series in one chart.
- Suppression in the chart layer only (tables, drill-downs, CSV and Looker leak); hiding the whole widget (gaps confuse; GA/Viva keep a placeholder).
- Rates without n; p-values instead of the MDC band; "needs more data" without saying how much.
- Ranking by skin tone band in any way that reads as "lighter = better"; tone bands are a slice, never a sort order by value.
- Period-over-period comparisons on an 8-week synthetic cohort (meaningless); date-range pickers instead of a weeks-since-baseline selector.
- Embedding Looker on phones.

---

## 5. Sources

Ingredient and routine tools
- SkinSort vs Skincarisma comparison (routine creator, incompatibility warnings): https://skinsort.com/alternative/skincarisma
- SkinSort vs CosDNA: https://skinsort.com/alternative/cosdna
- Best cosmetic ingredient checker, 7 tools compared (2026): https://glowlens.org/guides/best-cosmetic-ingredient-checker
- Apps like INCIDecoder compared: https://www.hadabuddy.com/blog/apps-like-incidecoder
- Healthline, 11 ingredient checkers: https://www.healthline.com/health/skin/skincare-ingredient-checker
- INCIDecoder product page layout (redirected domain): https://inkeedecoder.com/products/the-ordinary-niacinamide-10-zinc-1
- Skincarisma methodology: https://www.skincarisma.com/methodology
- Skincarisma product page example: https://www.skincarisma.com/products/tvala-tvaga/skina
- Skin Bliss App Store listing (compatibility checker, routine evaluator): https://apps.apple.com/app/1385561364
- Picky app coverage (2021): https://hypebae.com/2021/2/picky-skincare-mobile-app-product-ingredient-analyzer-compatibility-community-forum-download
- Yuka, how cosmetics are evaluated: https://help.yuka.io/l/en/article/2t20ixn5y5-evualuation-cosmetic-products
- Yuka UX showcase: https://screensdesign.com/showcase/yuka-food-cosmetic-scanner
- Yuka critique (Skin Rocks): https://skinrocks.com/blogs/caroline-hirons/debunked-everything-thats-wrong-with-the-yuka-app
- Paula's Choice ingredient dictionary: https://www.paulaschoice.com.au/ingredient-dictionary
- Paula's Choice ingredient checker launch: https://cosmeticsbusiness.com/news/article_page/Paulas_Choice_launches_ingredient_checker_to_address_skin_care_misinformation/209097
- Sephora Routine Builder (PopSugar): https://view.ceros.com/popsugar/ps20-sephora-routinebuilder-47868-editors-1
- Curology, uploading photos: https://support.curology.com/en_us/uploading-photos-B1pwm2d2d
- Curology, how it works: https://curology.com/how-it-works
- CJ Olive Young Skin Scan mobile: https://www.digitaltoday.co.kr/en/view/103466/cj-olive-young-expands-skin-scan-service-to-mobile-offers-self-skin-diagnosis
- Olive Young Skin Scan routines (Herald): https://biz.heraldcorp.com/article/10873591
- Olive Young US stores performance: https://cosmeticsbusiness.com/how-olive-young-debut-us-stores-have-performed
- Nykaa Skin Scan launch (Nov 2025): https://www.mediainfoline.com/tag/skin-scan
- Neutrogena Skin360 preview: https://reviewed.com/beauty/features/a-preview-of-the-new-neutrogena-skin360-app
- British Skin Foundation, which actives not to mix: https://www.britishskinfoundation.org.uk/which-pharmaceutical-skincare-you-shouldnt-mix-and-why
- Cult Beauty, ingredients you shouldn't mix: https://www.cultbeauty.com/blog/skincare-ingredients-that-you-shouldnt-mix

Label scanning / OCR with Gemini
- Gemini competition project with OCR-then-verify step: https://ai.google.dev/competition/projects/simplify
- Gemini image-to-text interprets rather than transcribes: https://workalizer.com/insights/gemini/geminis-image-to-text-why-ai-alters-your-output-and-how-to-get-verbatim-results-for-google-workspace
- Ingredient analysis app build with AI Studio: https://dev.to/hossainfoysalt/build-apps-with-google-ai-studio-ai-powered-ingredient-analysis-for-smarter-shopping-47mg
- Acne Safe ingredient scanner (capture guidance): https://apps.apple.com/us/app/id6747936538
- Beat the Microbead scan flow: https://beatthemicrobead.org/btmb-app/how-it-works

Conversational shopping
- OpenAI help, shopping in ChatGPT (sellers ordering, "Best price", "Instant checkout", not ads): https://help.openai.com/en/articles/11128490-shopping-with-chatgpt-search
- Perplexity, Shop like a Pro: https://www.perplexity.ai/hub/blog/shop-like-a-pro
- Perplexity shopping cards (Website Builder Expert): https://www.websitebuilderexpert.com/news/perplexity-shopping-assistant/
- Perplexity shopping (Fortune): https://fortune.com/2024/11/18/perplexity-ai-ceo-shopping-product-recommendation-search-tools
- Perplexity citations teardown: https://aiuxplayground.com/teardowns/perplexity/citations
- Shopify on Perplexity Shopping (2026): https://www.shopify.com/blog/perplexity-shopping
- Google AI Mode shopping update: https://blog.google/products/shopping/google-shopping-ai-mode-virtual-try-on-update/
- Google AI shopping tools (Retail Dive): https://www.retaildive.com/news/google-delivers-new-ai-shopping-tools-in-time-for-the-holidays/805683/
- Amazon Rufus UX review (alby): https://alby.com/blog/amazons-new-ai-shopping-assistant-rufus-ux-review
- Rufus shows 5 products not 50 (PPC Land): https://ppc.land/rufus-shows-5-products-not-50-what-brands-must-know-about-amazons-ai-filter/
- Klarna AI assistant upgrade: https://www.retail-insight-network.com/news/klarna-upgrades-ai-assistant/
- Shopify Sidekick: https://tech.co/news/shopify-sidekick-ai-assistant-merchants
- Shopify Sidekick voice (Google showcase): https://ai.google.dev/showcase/shopify
- Citations and Trust in LLM Generated Responses (AAAI 2025): https://ojs.aaai.org/index.php/AAAI/article/view/34550
- Telerik citation component (chip + popover): https://www.telerik.com/design-system/docs/components/citation/
- Google conversation design, suggestions/chips: https://developers.google.com/assistant/conversation-design/suggestions
- Chatbots scale back medical warnings (eMarketer): https://www.emarketer.com/content/chatbots-scale-back-their-medical-advice-warnings
- ChatGPT medical advice lawsuit and disclaimers: https://www.emarketer.com/content/new-chatgpt-medical-advice-lawsuit-tests-limits-of-ai-health-disclaimers

B2B dashboards, demo data, suppression
- Stripe testing / test-data banner guidance: https://docs.stripe.com/test-mode
- Stripe sandboxes: https://docs.stripe.com/sandboxes
- Stripe test mode toggle (third party): https://www.temperstack.com/learn/stripe/switch-test-live-mode/
- Dashboard design examples incl. Stripe density notes: https://adminlte.io/blog/25-best-dashboard-design-examples-for-2026-real-products-principles/
- Dashboard design principles (setproduct): https://www.setproduct.com/blog/effective-dashboard-design-principles
- Linear Insights docs: https://linear.app/docs/insights
- Shopify, reimagined analytics: https://www.shopify.com/blog/new-analytics
- Google Analytics data thresholds: https://support.google.com/analytics/answer/9383630
- Viva Insights minimum group size: https://learn.microsoft.com/en-us/viva/insights/privacy/privacy-considerations
- Viva Copilot Dashboard threshold update: https://mc.merill.net/message/MC788977
- CultureMonkey, how anonymity works (threshold applied twice, at calculation): https://www.culturemonkey.io/kb/how-anonymity-works/
- Immuta, SQL-based k-anonymization: https://www.immuta.com/blog/sql-based-enforcement-of-k-anonymization/
- IAPP, aggregating over anonymized data (slicing pitfall): https://iapp.org/news/a/aggregating-over-anonymized-data
- Loyola small-cell suppression policy: https://www.luc.edu/oira/datagovernance/smallcellsuppression/
- Domo thread, hide results when user numbers are small: https://community-forums.domo.com/main/discussion/comment/46728
- Metabase, hiding cards without data: https://discourse.metabase.com/t/hiding-cards-without-data/30321
- Demo mode as a pattern for software: https://rajiv.com/blog/2026/04/14/demo-mode-as-a-pattern-for-software/
- Cleeng, sample data in dashboard: https://publisher.support.cleeng.com/hc/en-us/articles/21963930801820-Understanding-sample-data-in-your-dashboard-and-when-real-data-appears
- Kasava demo mode (read-only sample project): https://www.kasava.dev/docs/demo-mode
- Whatfix demo mode datasets: https://support.whatfix.com/product-analytics/docs/introduction-to-demo-mode
- Amplitude experiment analysis view (CI vs zero): https://amplitude.com/docs/experiment/analysis-view
- Amplitude "needs more data" thread: https://community.amplitude.com/discussion/8808/data-insufficient-prompt-in-t-test-analysis-experiment
- Looker Studio embed docs: https://developers.google.com/looker-studio/integrate/embed
- Looker Studio embed on mobile issue: https://discuss.google.dev/t/looker-studio-embedded-dashboard-issue-wordpress/263562
- Plausible compare stats (comparison options): https://ingest.plausible.io/docs/compare-stats

Retailer merchandising and data
- Nykaa seller portal guide (reports: sell-through, stock cover, ageing): https://swcybernetics.in/guides/nykaa-seller-portal
- Ulta UB Media launch (closed-loop reporting): https://www.ulta.com/investor/news-events/press-releases/detail/150/ulta-beauty-launches-retail-media-network-ub-media
- Sephora and NIQ data partnership: https://consumergoods.com/sephora-partnership-strengthen-data-strategy-brand-partners
- NIQ State of Beauty 2026 (clinical brands share): https://ecrm.marketgate.com/MarketingFiles/Media/20260122/NIQ_State_of_Beauty_2026_ECRM.pdf
- Circana US beauty Q1 2026: https://www.circana.com/post/us-beauty-market-delivers-steady-first-quarter-growth-circana-reports
- L'Oreal category manager job spec (VIQ, Numerator, Nielsen): https://careers.loreal.com/zh_CN/jobs/JobDetail/Manager-Category-Target/243510
- YipitData beauty recap (retailer sell-through data vendors): https://www.yipitdata.com/resources/blog/corporate-february-beauty-monthly-recap
- Clean at Sephora criteria and lawsuit (claims scrutiny): https://businessoffashion.com/news/beauty/judge-throws-out-sephora-clean-beauty-false-advertising-lawsuit/
- Cosmetic retail KPIs: https://analyticsmart.com/key-performance-indicators-for-cosmetic-retail-the-metrics-that-matter/
