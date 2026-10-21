# Validation survey

A short survey to check, with real skincare users, that the problem Willow solves is real, that people would do the weekly photo, and who would join a pilot. It lives at **https://meetwillow.web.app/survey** and is built in the Willow design system, not Google Forms, so it feels like Willow and we control the wording, the flow and the data.

## Where things are

| Piece | Where |
|---|---|
| Questions, options, logic (one source for page and api) | `api/seed/survey_v1.json` |
| Page (its own small bundle and link-preview tags) | `web/survey/index.html`, `web/src/survey/` (`Survey.tsx` screens, `flow.ts` logic, `survey.css` motion) |
| Link preview card (1200×630, 277 KB) | `web/public/og/survey-v1.jpg` (rendered from the landing's tulip field) |
| Endpoint | `POST /v1/survey` (`api/app/routes/survey_routes.py`, `api/app/survey.py`), see docs/CONTRACT.md |
| Firestore | `survey_responses/{id}` (answers as option ids), `survey_contacts/{id}` (emails, kept apart) |
| Google Sheet copy | `api/app/survey_sheet.py`, tabs `Responses` and `Contacts`, readable labels |
| Counts, CSV, catch-up copy | `uv run python scripts/survey_sync.py count|csv|sheet` |

## The flow

1. **Intro:** who is asking (Niwin and Harshini), why, about 4 minutes, no photos or account, anonymous unless you leave an email, we'll share the results. 18+.
2. **Part 1, Your routine:** age (under 18 ends politely and nothing is kept), products used yesterday (none ends politely, kept as `screened_out: no_routine`), goals (any number; "nothing in particular" goes alone), products bought in 3 months, where (skipped if none).
3. **Part 2, Did it work?** how sure the last product made a visible difference (every point labelled, plus "too soon" and "none recently"), how they judged it, weeks until they can tell, half-used products on the shelf, one optional story.
4. **Part 3, An idea:** a plain description of Willow (with the noise band drawn as the app draws it), then usefulness, what they'd try first, what they'd do if Willow said "no clear change", hesitations, whether they've paid for skin help before, sharing results with a store.
5. **Part 4, Stay in touch:** join the free 4-week pilot on **7 November**, a 15-minute call, an email (only if either is yes, with its own unticked consent box), country.
6. **Thank you:** with a share button.

One question per screen; single choices move on by themselves after a moment on a tap (never on keyboard or reduced motion); Back is always there; progress is saved on the device so a refresh carries on; options in unordered lists are shuffled per person ("none"/"other" stay last).

## Why it's worded this way

Research summary (sources in `research/validation-survey/RESEARCH.md`, kept local):

- **Ask about the past, not the future.** "Would you use it" over-predicts; the pilot signup is a real commitment instead.
- **No agree/disagree grids.** People tend to agree, and grids get straight-lined on phones. Every scale names what it measures and labels every point.
- **Problem before pitch.** The idea is shown only after the questions about how people judge skincare today, so the answers aren't primed.
- **No "question 7 of 20" bar.** It lowers completion; a quiet "Part 2 of 4" label instead.
- **Their words, not ours:** "half-used on your shelf", "can't tell", "routine", "dark spots", "breakouts". Never: flaws, bad skin, normal skin, fair/brighten for tone, skin score, disease names.
- **Trust:** names, purpose, time and data use up front; email optional, separate, never pre-ticked (GDPR, India DPDP Rules 2025).

## Sharing links

Each channel gets its own `?src=` so friends and strangers can be told apart:

| Channel | Link |
|---|---|
| WhatsApp | `https://meetwillow.web.app/survey?src=wa` |
| LinkedIn | `https://meetwillow.web.app/survey?src=li` |
| X | `https://meetwillow.web.app/survey?src=x` |
| Reddit | `https://meetwillow.web.app/survey?src=rd` |
| Instagram | `https://meetwillow.web.app/survey?src=ig` |
| Shared from the thank-you screen | `?src=share` (automatic) |

Preview checks after a deploy: LinkedIn Post Inspector; paste into an X draft; WhatsApp caches previews, so add `&v=2` to see a new card.

## What counts as a good result

Decided before reading the answers. Judge on people with a routine, and on strangers (not `wa`).

| Signal | Promising if |
|---|---|
| Problem is real | ≥50% answer not at all / slightly / moderately sure (or too soon) on the last product |
| People can't tell | ≥30% say "I usually can't tell" or more than 8 weeks |
| Waste is real | ≥40% have 3+ half-used products |
| Solution pull | ≥40% very or extremely useful, ≥20% extremely |
| They'd act on an honest answer | "stop" + "check again later" ≥50% on the no-change question |
| Real intent | ≥15% join the pilot with an email, ≥5% agree to a call |
| Retailer angle | ≥50% buy on multi-brand, marketplace or quick-delivery apps; ≥40% yes or "depends" to sharing with a store |

The top hesitation says what to fix first (for example privacy, or skin-tone accuracy).

## Setting up the Google Sheet

1. Create a blank Google Sheet. The api makes the `Responses` and `Contacts` tabs (the empty `Sheet1` becomes `Responses`) and their bold, frozen header rows on the first response.
2. Share it with `sa-api@willow-511508.iam.gserviceaccount.com` as an editor.
3. Enable the Sheets API in `willow-511508`: `gcloud services enable sheets.googleapis.com --project willow-511508`.
4. Set `SURVEY_SHEET_ID` on the api (`gcloud run services update willow-api --region us-central1 --update-env-vars SURVEY_SHEET_ID=<id>`).
5. Copy anything that came in before: `SURVEY_SHEET_ID=<id> uv run python scripts/survey_sync.py sheet`.

Until then every response is safe in Firestore, and `survey_sync.py csv` exports them.

## Anti-spam

A hidden honeypot field (filled = quietly dropped), a full response under 30 s is kept but marked `suspect: fast`, and 6 responses per network address per day per api instance. App Check can come later if spam appears; in-app browsers (Instagram, LinkedIn) can score real people badly, so log before enforcing.
