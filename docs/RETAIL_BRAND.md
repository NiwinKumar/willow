# Willow Proof: retail brand (owner: Niwin)

Willow Proof is the retail and brand side of Willow: the dashboard at `/retail/*` that shows which products are linked to a measured, held change for real people (or the labelled synthetic cohort). Descriptor: **Retail intelligence by Willow**. It is a sub-brand. It always reads as Willow, uses Willow's tokens, and never introduces a new data colour. The shopper app and the website stay Willow (favicon included).

Code: `web/src/features/retail/brand/` (`ProofMark`, `ProofWordmark`, `ProofLockup`), static mark `web/public/proof-mark.svg`, tokens at the end of `web/src/styles/tokens.css`, Tailwind mapping in `web/src/index.css` (`--color-proof-*`, `--text-proof-*`).

## Name and voice
- Written "Willow Proof" in running text; the wordmark is lowercase "willow" (Outfit 300, as the consumer logo) + "Proof" (Instrument Serif). Never "WillowProof", "Proof by Willow" or "PROOF". Inside the app the top bar shows the mark and "Proof" in Geist; the full wordmark stays for the website and decks.
- Page titles: `<Section> · Willow Proof` (Overview, Products, Customers, Market, Campaigns, Explore).
- Voice: the same as Willow (DESIGN.md "Voice"), tuned for a buyer: lead with the answer in one line, then the evidence. Every rate carries its n; intervals where the api sends them; "Fewer than 10 people" where suppressed. Cosmetic language only; "associated with", never "causes". No "better/worse skin", no lightness ranking.

## The mark
A willow-900 squircle (32-unit grid, corner 9) holding three things from the product itself:
1. **The noise band**: a pale horizontal band (y 17-23), the same band Willow draws under every metric. Dashed edges at 24 px and up.
2. **A short tick arm** starting inside the band, in willow-leaf.
3. **The long arm as a willow leaf** leaving the band upward, filled leaf to leaf-hi, with a midrib at 24 px and up.

Read together: a check mark whose rising stroke is a willow leaf that clears the noise band. That is the claim of the product: a change only counts when it leaves your own noise band. The mark is never animated, recoloured, outlined, or set on a busy image.

## Lockups
| Lockup | Use | Component |
|---|---|---|
| Mark alone | Collapsed nav, mobile sheet footer, app icon contexts | `<ProofMark size />` |
| Horizontal (mark + wordmark) | Top bar (22 px), compact headers | `<ProofLockup size />` |
| With descriptor ("Retail intelligence by Willow") | Website footer, about panels, decks | `<ProofLockup size descriptor />` |

- **Clear space**: a quarter of the mark size on every side; nothing (text, rules, controls) inside it.
- **Minimum sizes**: mark 16 px alone (band edges and midrib drop out below 24 px automatically); 20 px mark in any lockup (the component clamps to 20).
- On light surfaces (the website) the wordmark follows `text-ink` and the mark keeps its own dark ground, so the same component works on both themes.

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
`features/retail/pipeline.tsx` draws one product's path as five steps, read like a deployment's build log: **Measured** (people with 8 weeks of readings) → **Proven** (lift over non-users above zero across its interval, n ≥ 30) → **Claims ready** (claim-ready statements) → **Promoted** (a campaign in the Willow app) → **Lift measured** (adoption against the randomised holdout). Done steps are a leaf check, in-progress ones amber, the rest numbered. Every step is a fact from the api, never a projection. It opens Overview (the spotlight) and the product page, and the Promote step links to the Campaigns create sheet (`/retail/campaigns?new=<product_id>`).

## Components (`web/src/features/retail/ui/`)
- Layout: `PageHeader` (title, one-line description, actions, optional leading image), `Panel` (title, meta, actions, one-line description, footnote, `flush` for tables), `Button` (primary / secondary / ghost; `to` renders a link), `ToolButton`, `Badge` (gray / green / amber / red / outline).
- Data: `DataTable` (sortable, sticky header, 48 px keyboard rows, CSV export of the visible columns, `columnsKey` adds a Columns menu for `optional` / `hidden` columns), `KpiStrip`, `Stat`, `ProofTierChip` / `TierDot`, `EvidenceBar`, `RateCell`, `LiftValue`, `Suppressed`, `ProductCell`, `ShareBar`, `Sparkbars`.
- Charts: `CurveChart` (the product's series in leaf over a soft area, non-users in `--pf-base`, values labelled at the end), `Heatmap`, `PositioningChart`.
- Controls: `Tabs` (underline, optional count), `Segmented`, `Select`, `SearchField`, `Combobox`, `SidePanel`; states `EmptyState` / `ErrorState` (one action) and skeletons drawn to the final layout.
- Helpers: `ui/format.ts` (`pct`, `pts`, `int`, `interval`, `MIN_GROUP`, `downloadCsv`, `copyText`), `ui/insight.ts` (`briefHref`, `cardFigure`, `topUnmet`, `strongestWinner`, `brandLeaders`, `wilson`).
- The shopper preview in Campaigns draws the consumer card with `data-theme="light"` (Willow's own light tokens), so it is the real card, never a restyled copy.
