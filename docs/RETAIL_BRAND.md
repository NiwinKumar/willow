# Willow Proof: retail brand (owner: Niwin)

Willow Proof is the retail and brand side of Willow: the dashboard at `/retail/*` that shows which products are linked to a measured, held change for real people (or the labelled synthetic cohort). Descriptor: **Retail intelligence by Willow**. It is a sub-brand. It always reads as Willow, uses Willow's tokens, and never introduces a new data colour. The shopper app and the website stay Willow (favicon included).

Code: `web/src/features/retail/brand/` (`ProofMark`, `ProofWordmark`, `ProofLockup`), static mark `web/public/proof-mark.svg`, tokens at the end of `web/src/styles/tokens.css`, Tailwind mapping in `web/src/index.css` (`--color-proof-*`, `--text-proof-*`).

## Name and voice
- Written "Willow Proof" in running text; the wordmark is lowercase "willow" (Outfit 300, as the consumer logo) + "Proof" (Instrument Serif). Never "WillowProof", "Proof by Willow" or "PROOF".
- Page titles: `Willow Proof · <Section>` (Overview, Products, Categories, Skin profiles, Competitors, Demand, Promote).
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

## Colour
Every value is a Willow token or a tint of one. Proof is drawn on Willow's dark theme (`[data-theme="dark"]`).

| Token | Hex | From | Role |
|---|---|---|---|
| `--proof-ground` | `#0F3B3A` | willow-900 | The mark's ground |
| `--proof-leaf` | `#86C5B0` | willow-leaf | The one Proof accent: active nav bar, tier glyphs, the mark's tick |
| `--proof-leaf-hi` | `#B8E986` | willow-200 | Leaf-tip highlight in the mark only |
| `--proof-leaf-soft` | `rgba(134,197,176,.14)` | leaf tint | Selected nav row, selected table row, accent wells |
| `--proof-leaf-line` | `rgba(134,197,176,.40)` | leaf tint | Accent hairline (pressed toggle, selected chip) |
| `--proof-band` / `--proof-band-edge` | `rgba(255,255,255,.13)` / `.30` | noise band | Inside the mark only |
| canvas / surface | `#07070A` / `#111116` | dark theme | Page / panels |
| ink / ink-2 | `#FFFFFF` / `#A3A3AD` | dark theme | Text (ink-2 on surface is 7.6:1, AA) |
| signal-change | `#FF8A3D` | dark theme | **Real change only** (the ember dot, the real-change curve) |

Rules: ember keeps its single meaning (Real change) and is never a brand colour; leaf is brand/navigation, never data; synthetic data always shows the yellow `SIMULATED` badge and the cohort banner; colour is never the only signal (tiers carry a glyph and a word, suppressed cells carry the words and a hatch).

## Type
| Role | Face | Token | Size / line | Use |
|---|---|---|---|---|
| Section title | Instrument Serif | `text-proof-title` | 26 / 1.1, −0.01em | One per page, the h1 |
| Answer line | Outfit | `text-proof-answer` | 15 / 1.45 | The one-line answer under the title |
| Panel heading | Outfit 500 | `text-proof-h` | 14 / 1.3 | Panel and table titles |
| Body, table cells | Outfit | `text-proof-body` | 13 / 1.45 | Default |
| Secondary, headers | Outfit | `text-proof-small` | 12 / 1.35 | Column headers, notes, controls |
| Eyebrow | Geist Mono caps | `text-proof-label` / `.eyebrow` | 11, +0.08em | Workspace eyebrow only |
| Numbers | Geist Mono, tabular | `font-mono tnum` | inherits | Every number in a table or chart |
| Hero KPIs | Doto | `text-proof-kpi` | 34 / 0.9 | The Overview KPI strip only |

Density: 36 px table rows, 52 px top bar, 216 px nav (60 collapsed), 16 px panel padding, 12-column grid at 1280-1600 px. True minus sign (−) for negatives, `+6 pts` for lift.

## Do / don't
- Do lead each section with the answer, then the chart; show n next to every rate; keep "Fewer than 10 people" verbatim.
- Do use the mark at its own colours on dark or light; give it clear space.
- Don't use leaf for data, or ember for anything but real change; don't put red/green on outcomes.
- Don't rank people or brands by skin tone or lightness; skin profiles are buckets for "works for whom", never an order.
- Don't use Doto outside the Overview KPIs, or the serif outside titles and the wordmark.
- Don't stretch, rotate, recolour or animate the mark; don't put the wordmark without the mark under 20 px.

## Components (`web/src/features/retail/ui/`)
SectionHeader, Panel, ToolButton, KpiStrip, DataTable (sortable, sticky header, CSV export of the visible columns, keyboard rows), ProofTierChip, EvidenceBar, RateCell, LiftValue, Suppressed, CurveChart, Heatmap, SidePanel, Skeletons, EmptyState / ErrorState, Term (glossary tooltips), Tabs, Segmented, Select, SearchField, Combobox, SimBadge. Each has a short doc comment; formatting helpers (`pct`, `pts`, `interval`, `SUPPRESSED`, `downloadCsv`) live in `ui/format.ts`.
