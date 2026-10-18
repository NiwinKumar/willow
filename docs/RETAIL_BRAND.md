# Proof by Willow: retail brand (owner: Niwin)

Proof by Willow (earlier "Willow Proof") is the retail and brand side of Willow: the dashboard at `/retail/*` that shows which products are linked to a measured, held change for real people (or the labelled synthetic cohort). Descriptor: **Retail intelligence**. It is a sub-brand. It wears Willow's own logo and always reads as Willow, uses Willow's tokens, and never introduces a new data colour. The shopper app and the website stay Willow (favicon included).

Code: `web/src/features/retail/brand/` (`ProofMark`, `ProofWordmark`, `ProofLockup`), static mark `web/public/proof-mark.svg`, tokens at the end of `web/src/styles/tokens.css`, Tailwind mapping in `web/src/index.css` (`--color-proof-*`, `--text-proof-*`).

## Name and voice
- The name is **Proof by Willow** (Oct 19; it was "Willow Proof"). In running text write "Proof by Willow", and just "Proof" once the context is clear. Never "WillowProof" or "PROOF". The logo is Willow's own (the frosted tulip bud, `LogoMark`), not a separate Proof mark. Inside the app the top bar shows that logo with "Proof" (semibold) and "by Willow" (quieter) in Geist; the "by Willow" half hides on phones.
- Page titles: `<Section> · Proof by Willow` (Overview, Products, Customers, Market, Campaigns, Explore).
- Voice: the same as Willow (DESIGN.md "Voice"), tuned for a buyer: lead with the answer in one line, then the evidence. Every rate carries its n; intervals where the api sends them; "Fewer than 10 people" where suppressed. Cosmetic language only; "associated with", never "causes". No "better/worse skin", no lightness ranking.

## The logo
Proof uses Willow's logo unchanged: the frosted tulip bud in its round ground (`components/willow/Logo.tsx`, `LogoMark`). `ProofMark` is that component. The earlier check-and-noise-band mark (Oct 16) is retired, and `public/proof-mark.svg` is removed. Never recolour, outline or animate the logo.

## Lockups
| Lockup | Use | Component |
|---|---|---|
| Logo alone | Collapsed nav, phone top bar | `<ProofMark size />` |
| Logo + "Proof by Willow" | Top bar (26 px), compact headers | `<ProofLockup size />` |
| With descriptor ("Retail intelligence") | Website footer, about panels, decks | `<ProofLockup size descriptor />` |

- **Clear space**: a quarter of the logo size on every side. **Minimum size**: 20 px in any lockup.
- The name follows `text-ink` (and `text-ink-2` for "by Willow"), so it works on both themes; the logo keeps its own ground.

## Look (round 2, Oct 16): Vercel's Geist language, Willow's leaf
Round 1 read as cluttered and "vibe-coded" (serif titles, dot-matrix KPIs, mono labels, eyebrows, a yellow chip on every panel). Round 2 follows Vercel's Geist system: white or near-black canvas, hairline borders, one sans family, hierarchy from size, weight and space, one accent. Willow's flair is the leaf-green accent and the Proof mark.

Proof follows the viewer's theme (system, light or dark, toggle in the top bar, stored in `willow.proof.theme`). The shell sets `html[data-proof]` and `html[data-theme]`; `features/retail/retail.css` redefines Willow's semantic tokens under those selectors, so every kit component works in both themes without per-component colours.

## Colour
| Token | Light | Dark | Role |
|---|---|---|---|
| canvas / surface | `#FFFFFF` | `#0A0A0A` | Page and panels (panels are told apart by a hairline, not a fill) |
| `--pf-bg2` | `#FAFAFA` | `#111111` | Wells: table heads, panel footnotes, the spotlight's pipeline column |
| ink / ink-2 | `#171717` / `#5F5F5F` | `#EDEDED` / `#A1A1A1` | Text |
| `--proof-leaf` | `#1F7F45` | `#4FB866` | **The one accent**: Proven, positive lift, your product's series in charts, done pipeline steps |
| `--proof-leaf-soft` / `-line` | leaf at 10% / 32% | leaf at 14% / 40% | Badge fills, selected rows, accent hairlines |
| `--pf-amber` | `#A35200` | `#F5A524` | Status only: Promising, in progress, warnings |
| `--pf-red` | `#D93036` | `#FF6166` | Status only: errors, risk |
| `--pf-base` | `#B4B4B4` | `#5C5C5C` | Comparison series (non-users, the market) |

Self-reported shares ("How it feels" on the product page) use leaf for "It's working for me" and `--pf-base` at two strengths for "Too soon to tell" and "Not for me", never amber or red; the legend's words and order carry the meaning.

Rules: leaf means "proven / yours / positive", nothing else; amber and red are status, never decoration; colour is never the only signal (tiers carry a dot and a word, suppressed cells carry "n<10"). The data scope (simulated, mixed or real people; period) is stated once, in the top bar's scope control, not on every panel.

## Type
Geist (Google Fonts) for everything; numbers use Geist with tabular figures (`tnum`), never mono. Mono only for IDs and code.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-proof-hero` | 48 / 52, −0.04em | 600 | One hero figure per page (the spotlight outcome) |
| `text-proof-title` | 24 / 32, −0.025em | 600 | Page title (h1) |
| `text-proof-kpi` | 28 / 32 | 600 | KPI and stat values |
| `text-proof-h` | 16 / 24 | 600 | Panel titles |
| `text-proof-answer` | 15 / 22 | 400 | Rare lead lines |
| `text-proof-body` | 14 / 20 | 400 | Default, table cells |
| `text-proof-small` | 13 / 18 | 400 | Secondary text, descriptions, controls |
| `text-proof-label` | 12 / 16 | 500 | Badges, axis labels |

Spacing: page column 1200 px; 32 px between page zones, 24 px between panels, 20 px panel padding; 48 px table rows (`--proof-row`), 56 px top bar, 36 px controls; radius 6 px on controls (`rounded-ctl`), 12 px on panels (`rounded-card`). True minus sign (−) for negatives, `+6 pts` for lift.

## Do / don't
- Do lead each page with its decision: a `PageHeader` whose one-line description carries the key number, then the most important panel above the fold (1280×800).
- Do disclose progressively: optional table columns (Columns menu, remembered per table), side panels, "Show all". Views live in the URL so they can be shared.
- Do show n next to every rate once; intervals go in tooltips; keep "Fewer than 10 people" / "n<10" verbatim.
- Don't use eyebrows, uppercase or letter-spaced labels, per-panel data chips, dotted glossary underlines in running text, or a footnote on every panel. Definitions live in the tier badge and column-header tooltips.
- Don't put cards inside cards, more than four KPIs in a strip, more than six default table columns, or more than one primary button in a view.
- Don't rank people or brands by skin tone or lightness; skin profiles are buckets for "works for whom", never an order.
- Don't stretch, rotate, recolour or animate the mark.

## The Proof pipeline (the hero flow)
`features/retail/pipeline.tsx` draws one product's path as five steps, read like a deployment's build log: **Measured** (people with 8 weeks of readings) → **Proven** (lift over non-users above zero across its interval, n ≥ 30) → **Claims ready** (claim-ready statements) → **Promoted** (a campaign in the Willow app; an ended one stays done and offers "Promote again") → **Lift measured** (adoption against the randomised holdout). Done steps are a leaf check, in-progress ones amber, the rest numbered. Every step is a fact from the api, never a projection. It opens Overview (the spotlight) and the product page, and the Promote step links to the Campaigns create sheet (`/retail/campaigns?new=<product_id>`).

## Components (`web/src/features/retail/ui/`)
- Layout: `PageHeader` (title, one-line description, actions, optional leading image), `Panel` (title, meta, actions, one-line description, footnote, `flush` for tables), `Button` (primary / secondary / ghost; `to` renders a link), `ToolButton`, `Badge` (gray / green / amber / red / outline).
- Data: `DataTable` (sortable, sticky header, 48 px keyboard rows, CSV export of the visible columns, `columnsKey` adds a Columns menu for `optional` / `hidden` columns), `KpiStrip`, `Stat`, `ProofTierChip` / `TierDot`, `EvidenceBar`, `RateCell`, `LiftValue`, `Suppressed`, `ProductCell`, `ShareBar`, `Sparkbars`.
- Charts: `CurveChart` (the product's series in leaf over a soft area, non-users in `--pf-base`, values labelled at the end), `Heatmap`, `PositioningChart` (a four-corner map around the median brand: one sentence on top, corners named in words, names on the plot where they fit).
- Controls: `Tabs` (underline, optional count), `Segmented`, `Select`, `SearchField`, `Combobox`, `SidePanel`; states `EmptyState` / `ErrorState` (one action) and skeletons drawn to the final layout.
- Helpers: `ui/format.ts` (`pct`, `pts`, `int`, `interval`, `MIN_GROUP`, `downloadCsv`, `copyText`), `ui/insight.ts` (`briefHref`, `cardFigure`, `topUnmet`, `strongestWinner`, `brandLeaders`, `wilson`).
- The shopper preview in Campaigns draws the consumer card with `data-theme="light"` (Willow's own light tokens), so it is the real card, never a restyled copy.

## Widgets (`web/src/features/retail/ui/widgets/`)
Data-viz cards for Overview and the product page. They are Proof panels: surface, hairline border, text tokens, leaf accent, so they follow the light and dark themes like every other panel (no fixed palettes, no glow or gradient cards). Colour only carries meaning: leaf = a visible change / the product, blue = a second group, amber = a caution or people still waiting, grey = the rest. Each widget takes the numbers it draws as props and owns its hover, keyboard and screen-reader behaviour (a visually hidden table mirrors every chart); they size by container query, draw in once and respect reduced motion. Real aggregates only: the sections work the numbers out, no widget has sample data.
- `GlowStat` (scrubbable curve, monotone cubic that never overshoots the data), `ProgressTile`, `RankList`, `BrandBars` (bars on a 0-100% track with a tick for the average), `PillStack` (each part coloured by status, with a legend: green settled, amber on the way, grey no effect found, hollow not enough to say), `LineWidget`, `ScrubBars`, `PillColumns` (one fixed measure, no select), `TickGauge` (the callout only shows when there is room), `RingStack`, `DotMatrix`, `RadialTile`.
- `FlowChart`: a Sankey drawn as a tree (each group splits once, so no band crosses another) on one people-per-pixel scale. Hover or focus a group and its path lights; the line above reads it in words. A dashed stub marks a group with a part under 10 people that is left out.
- `StreamChart`: the design's stream ("Users reaching a real change"): nested running-total bands from a hairline at the left to full width at the right, a glow under the outer band, three tick lines with a pill above (the outer total) and below (the day); a hidden table lists every day. Used by the campaign page.
- `BlobRadial`: the design's radial ("Goal demand by month"): one axis per category, soft closed Catmull-Rom shapes per layer from r 100 outwards, guide rings at the peak and half of it, category names around, a dotted number in the hollow centre (Doto). Needs three or more axes. Used by the campaign page.
- Overview board (`sections/overview/Board.tsx`), one screen on a 1440 x 900 window (compact cards, 16 px padding, 12 px gaps, no card taller than it needs): row 1 the spotlight (product, figures, a small curve, the Proof pipeline as a strip along its foot, View proof / Promote) beside the market curve "Visible change by week 8" (8 + 4 columns); row 2 three equal tiles: catalog by proof, still using, no visible change yet (a brand workspace shows its own rate against the market instead); row 3 goals people chose (7) beside the top brands (5); then the brief and top products. Below 1024 px the rows stack.
- Product journey (`sections/ProductJourney.tsx`, product page, measured products only): Started -> Week 8 reading -> Outcome -> Still using? -> How it feels. Non-users with the same goals are one group "from the market" with no outcome of their own (their outcome is the comparison in the figures above; a non-user does not "see a change" from the product). "Not effective" is worded "No visible change". Repeat purchases are not tracked, so the chart stops at "Still using" and says so.
- Product page (`sections/ProductDetail.tsx`), top to bottom: a slim facts strip (visible change, time to change, still using, share of routines, rank, and the non-user baseline the Proven tier is measured against); then the journey chart as the main item (8 columns) beside a rail of the small Proof pipeline and Where it works (4); Next steps as a strip of up to three cards; the evidence (claim-ready statements beside the category comparison and routine context); claim drafts; how it feels. Only the journey chart is large; everything else is sized by how much a retailer needs it, and each row is balanced so no column leaves a gap. The chart fits its column (no scrollbar; it scrolls sideways only on a phone, with a hint).

## Campaign page
`/retail/campaigns/:id` (`sections/CampaignDashboard.tsx`) is a page, not a side panel: breadcrumb and header (packshot, name, status badge, day of the run, actions), a three-cell `KpiStrip` (the only numbers that get a tile), then an 8/4 row (the insight sentence over the `StreamChart`; the 100-dot with-vs-without panel) and a 5/7 row (where it works, the `BlobRadial`; who it reaches). Both charts are ported from the Retail design's own geometry (`design-from-claude-design/Willow Retail.dc.html`: `flow` and `polar`), recoloured to one leaf accent in light and dark; the stream bleeds to the card edges (`-mx-5`). the dot panel uses leaf for the group that could see the card and grey for the holdout. One accent, no per-panel data chips. Insight words come from pure helpers (`campaignInsight`, `ownRecordInsight`, `cumulativeDays`, `boostedAdds`, `runDay`) in `features/retail/promote.ts`, tested in `web/tests/promote.test.ts`.
