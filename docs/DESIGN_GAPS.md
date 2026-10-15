# Design ↔ backend gaps (Claude Design rebuild, Oct 15)

The web app was rebuilt from the Claude Design build (`design-from-claude-design/`: `Willow App`, `Willow App Routine`,
`Willow Capture`, `Willow`, `Willow Retail`; design system in `docs/DESIGN.md` v3). Every number on screen now comes from
the api. Where the design draws something the backend cannot supply, the app leaves it out (or shows an honest empty
state) instead of faking it; where the design's copy was untrue against the backend, the app says the true thing.
This file lists both directions so they can be planned. Line-level notes per area were kept during the build.

## 1. Needs a decision or an action from the owner

| # | Item | Why it matters | What to do |
|---|---|---|---|
| D1 | **Email/password sign-in** | The website's email sign-up, sign-in and reset are built (Firebase SDK, guests are linked so data is kept) but the provider is off: only Google and Anonymous are enabled. The form says so plainly until then. | Firebase console → Authentication → Sign-in method → enable Email/Password; add it to `infra/setup.sh` step 2. Free. |
| D2 | **Demo journey is empty** | `/v1/demo/journey` returns no sessions in production (the demo account was never seeded). There is no illustrative fallback any more, so "Explore a real journey" and judge stop 2 show "Not available right now". | Capture the team's real sessions into the demo account (`demo_user_id`): a face baseline + several check-ins over days, a treated/control forearm pair. |
| D3 | **The only sample run is rejected** | The hosted sample `forearm_single_raw` has no pen dots, so the live engine rejects it ("No usable photos"). Judge stop 1 shows that honestly, but it's a bad first impression. | Host a sample that passes: consented face photos (5 JPEGs) and/or a forearm photo with the four pen dots and white paper. |
| D4 | **Terms / privacy notice page** | The design's sign-up has "I agree to the terms and privacy notice"; there is no such page, so the checkbox was removed. | Write the page (or decide the consent screen is enough). |
| D5 | **Product photos** | DESIGN.md rule 9 says no product photos; the catalog has licensed-link packshots (Oct 13 decision). The app follows the design: category colour orbs and icons. | Confirm, or allow packshots in the product sheet only. |
| D6 | **Goal list** | Design shows 6 goals (incl. "Self-tanner test"); the app keeps the 7 goal ids that drive report ordering and the retailer's goal grouping, drawn in the design's style. | Confirm, or redesign the list (the retail mapping must change with it). |
| D7 | **Retail colour** | Heat cells and brand bars use ember (the value *is* the real-change rate); DESIGN.md's "ink alpha" fails contrast on dark. | Confirm in the design system. |

## 2. Design without backend (left out or reduced in the app)

### Cadence, reminders and plans (none exist in the api)
- "Next check-in Sat", "Cheek close-up · Sat", "photos due", "Set a reminder", the weekly check-in day, "Same time tomorrow? · Remind me". **Built instead:** the "This week" card shows on the weekday of the face baseline; "back after a gap" = 14+ days since the last face check-in (client rules). **Needs:** a cadence/reminder model (stored day, push or email) — a product decision first.
- Alternate-night schedule: "TONIGHT", "RESTS ☾", "Tonight is a glycolic night", the "Alternate nights" suggestion. **Needs:** a schedule field per routine entry (the routine check already says *what* to alternate).

### Baselines
- **Topping up a baseline** ("3 of 5 photos · Add 2 photos"): a baseline is one session. **Built instead:** "N usable photos; a normal range needs 3 — take a check-in with 3+ and make it your baseline." **Needs:** resumable sessions (frame count changeable before analyze) or an api rule that replaces a band-less baseline with the next good session.
- "Original deleted · preview only": the 30-day bucket lifecycle deletes previews and spot crops too (`infra/setup.sh`), so after 30 days there is no photo at all; the app says so. **Needs:** keep `preview.jpg` and crops out of the lifecycle (and update consent) if the state is wanted.

### Capture and processing
- **Live processing stages** (quality → colour → measure → explain): analyze is one synchronous call, so stages land together when it answers (never on a timer). **Needs:** a `session.stage` field written by `analysis.run` and polled.
- "Looks soft · consider retaking" before upload (no pre-check), duplicates across past sessions (no hashes), editing the photo list after the session exists (frame count fixed at create; the app offers "Start over"), body regions in rejection reasons ("overexposed forehead"; engine reasons are per photo), the Lightroom setup *date* (only a yes/no is stored).

### Results
- **Redness overlay**: the engine emits no overlays (`overlays: []`); the photo toggle is Spots / None. **Needs:** an engine redness map + signed `overlay_urls`.
- Per-photo thumbnails for rejected sessions (only the reference preview is signed), spot crops on the Result's "Detected spots" card (the diary has them; the session view doesn't sign `candidates[].crop_uri`).
- Product test details: product name, "of 28 days", "verdict after day 14". **Built instead:** "Day N since the treated baseline", treated vs control standing. **Needs:** a product-test object (product, length, start) or routine `applied_sites` read back.

### Routine and advisor
- Per-store prices (catalog has one price per product), "last changed" date on the routine, per-ingredient scan confidence and a "glare" failure reason, staged progress for the routine check and label scan (single calls).
- Advisor: photo attachments in chat (api is text-only; label photos go through Routine → Scan label), usage count before the first question (no read endpoint), advisor history (not stored), true streaming (one JSON reply; the app reveals it word by word), "AI unavailable · standard explanation" mode.

### Account and service status
- Goals and photo time follow the device, not the account (no endpoint writes `users.goal`). Name from email sign-up lives on the Firebase profile only.
- Live checks for Gemini, storage and BigQuery latency (`/v1/demo/status` returns config, plus engine latency only). "Nothing kept after 24 hours" for judge guests: no guest clean-up job exists.

### Retail (`/v1/retailer/insights` has no data for these)
- Date-range and cohort filters (a `range`/`cohort` param is a CONTRACT change; synthetic data ends Sep 30).
- Goal demand **by month** (fixed goals per synthetic user, no October, real goals exported empty) — **built:** a one-snapshot radial of real counts.
- Category × goal flow bands and per-category brands; the "Skin profile" split (skin type is never collected); per-goal median KPI; continuation at week 8 (backend has "after week 4"); catalog "of 60" denominator and hidden-product count; suppressed-brand rows; users per gap tier (bubbles are one size); conflict denominator and "Duplicate active"; an Ask `refused` flag, per-bar n and a source field (the app derives n per bar from the insights).

## 3. Backend without design (and where the app put it)

- **Today's check-in failed / rejected / not measured / stalled**: new grey-aura variants of Home's lead card and Result status cards, with "Check in again" / "Try again" (re-runs analyze via `/check-in?session=`).
- **Former baseline, baseline with <3 photos, no normal range**: Result heroes in the design's language; "Make this my baseline" works for Quick and RAW.
- **Everything the check-in protects** (consent and sign-in gates, iOS file checks, Lightroom setup values, auto-capture rules, retries, URL renewal, wake lock, offline pause, every error code): kept and drawn in the design's style.
- **Routine**: recent use ("used X of Y days"), Stop vs Remove (Stop keeps outcomes and dates; Remove deletes ticks), a Stopped list, slot editing, manual products with a concerns picker, routine-check notes, model-sourced findings tagged as AI.
- **Advisor**: products in replies, follow-ups, "How this answer was made" (retrieval and checks), busy vs daily-limit.
- **Result**: explanation `next_steps` and disclaimer, spot agreement "seen in n of N photos", up to 40 spots with "Show all", note editing on the day detail, nose close-up pill, pore size line, every spot-diary field (there from start, came back, unconfirmed, not mapped).
- **You**: consent on the account (`GET /v1/me`), sharing synced to the account, Firebase account removal after data deletion, the true Save-with-Google outcome (same account vs switched to an existing one).
- **Retail**: Wilson intervals, lift vs non-users, gap actions, conflict fixes and resolving products, CSV exports with cohort header and disclaimer.
- Not placed (no room in the design): the old hold-to-flicker comparison, ROI outlines, scrubber, coach marks, forearm redness comparison; the full `product_outcomes` list (43 products) in retail.

## 4. Design copy that was untrue (fix in the design file)

- Close-ups are **measured** (cheek: tone, spots, redness, blemishes, pores, texture; nose: blemishes, pores) — not "saved, not measured". Capture them at ~10 cm with one eye in view (no spacer cone, no flash).
- Forearm capture uses **four pen dots on a 4 cm square and white paper**, not a tape outline and a colour card.
- Quick photos get real verdicts against a Quick baseline (not "trend only"); spots and the spot diary work for Quick too.
- The face measures **9** things (tone, dark spots, evenness, redness, blemishes, lines, under-eye, shine, glow); the "not measured: pores, texture, lines, under-eye, shine, glow" lists are wrong.
- Previews and spot crops are deleted at 30 days with the photos; measurements stay.
- A normal range needs **3** usable photos (not 5); 5 are asked for a first session.
- The advisor doesn't stream; the daily cap resets at UTC midnight; the catalog has 48 products, priced in their own currency.
- "21-day replay", "20 seconds", "6 stops", consent "v1.3", "spot diary starts on day 3 / two good photos in a row" (it counts check-ins: 3 over 2+ days), "No absolute lightness threshold anywhere" (ITA bands exist for description).
- Retail: pores/texture *is* measured (dryness isn't); "Quick-photo readings are excluded" isn't enforced; "Still using wk 8" is "after week 4".
- Verdict words: the app uses APP_PLAN's set everywhere — ◆ Changed · ○ Within normal range · · Baseline · ◌ Not enough data yet · — Could not compare.

## 5. Decisions made during the build (revisit if wanted)

- One app shell with a real URL per destination (`/home /progress /progress/:day /result/:id /test /routine /you`, check-in at `/check-in` over the current page); old URLs redirect.
- Demo mode shows only the team's real journey (no illustrative data anywhere); judge tour keeps 5 stops.
- Routine ✕ = "Stop using" with Undo; deleting is a separate confirmed action.
- Retail tone bands: the backend's 6 named bands, never degree labels or a lightness order.
- No committed images: the hero flowers are CSS.
