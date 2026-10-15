import { useState, type ReactNode } from 'react'

import {
  cohortKind,
  exportCsv,
  gapTier,
  MIN_GROUP,
  nonUserRate,
  numerator,
  pct,
  signedPts,
  TIER_LABEL,
  TIERS,
  totalUsers,
  weeksLabel,
  type Cell,
  type Insights,
  type Tier,
} from './data'

/* ───────────────────────────── shared bits ───────────────────────────── */

/** "SIMULATED" badge on every chart while the cohort is not real-only (docs/DESIGN.md "Retail charts"). */
export function SimBadge({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  if (kind === 'real') return null
  return (
    <span className="retail-synthetic inline-flex min-h-6 items-center rounded-pill px-2.5 font-mono text-[11px] tracking-[.08em]">
      {kind === 'mixed' ? 'MIXED · MOSTLY SIMULATED' : 'SIMULATED'}
    </span>
  )
}

function CsvButton({ onClick, label, light }: { onClick: () => void; label: string; light?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Download ${label} as CSV`}
      className={`min-h-11 rounded-pill px-4 text-[13px] ${light ? 'border border-line bg-white text-ink hover:bg-muted' : 'border border-line-strong bg-transparent text-ink hover:bg-glass'}`}
    >
      CSV ↓
    </button>
  )
}

function Head({ d, id, eyebrow, title, light, children, big }: { d: Insights; id: string; eyebrow: string; title: string; light?: boolean; children?: ReactNode; big?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] text-ink-2">■ {eyebrow}</span>
          <SimBadge d={d} />
        </span>
        <h2 id={id} className={`m-0 tracking-[-0.02em] ${big ? 'text-[clamp(26px,3vw,36px)] font-light' : `text-[28px] ${light ? 'font-normal' : 'font-light'}`}`}>{title}</h2>
      </div>
      {children ? <div className="flex flex-wrap gap-1.5">{children}</div> : null}
    </div>
  )
}

/** How a retailer goal maps to the goals people pick in the app (the retailer view is finer). */
function AppGoal({ goal, appGoal }: { goal: string; appGoal?: string | null }) {
  if (appGoal === undefined || appGoal === goal) return null
  return <span className="block text-[12px] text-ink-2">{appGoal ? `Part of “${appGoal}” in the app` : 'Not a goal in the app yet (not measured)'}</span>
}

/* ───────────────────────────── needs: radial + table ───────────────────────────── */

const C = 260 // radial centre (viewBox units)
const R0 = 100
const SCALE = 120

/** Closed Catmull-Rom curve through one value per goal (the design's `polar`), radius R0 + v × SCALE. */
function polar(vals: number[]): string {
  const n = vals.length
  const pts = vals.map((v, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    const r = R0 + v * SCALE
    return [C + r * Math.cos(a), C + r * Math.sin(a)]
  })
  const f = (x: number) => x.toFixed(1)
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`
  }
  return `${d}Z`
}

/** Long goal names go on two lines so the labels stay inside the drawing. */
function splitLabel(s: string): string[] {
  if (s.length <= 14) return [s]
  const spaces = [...s.matchAll(/ /g)].map((m) => m.index!)
  if (!spaces.length) return [s]
  const cut = spaces.reduce((a, b) => (Math.abs(b - s.length / 2) < Math.abs(a - s.length / 2) ? b : a))
  return [s.slice(0, cut), s.slice(cut + 1)]
}

function Radial({ d }: { d: Insights }) {
  const needs = d.needs
  const peak = Math.max(...needs.map((r) => r.n))
  const demand = needs.map((r) => r.n / peak)
  // People with a real change, on the same scale (share of the most-chosen goal's people).
  const reached = needs.map((r) => (r.n * r.real) / 100 / peak)
  const alt = `Goal demand, one snapshot of the whole cohort. ${needs.map((r) => `${r.goal}: ${r.n} people (${Math.round((r.n / peak) * 100)}% of the most-chosen goal), ${r.real}% reached a real change`).join('; ')}.`
  return (
    <>
      <div role="img" aria-label={alt} className="w-full max-w-[500px] self-center">
        <svg viewBox="-70 0 660 530" aria-hidden className="block h-auto w-full overflow-visible">
          <circle cx={C} cy={C} r={R0 + SCALE} fill="none" stroke="currentColor" strokeOpacity={0.1} />
          <circle cx={C} cy={C} r={R0 + SCALE / 2} fill="none" stroke="currentColor" strokeOpacity={0.1} />
          <path d={polar(demand)} fill="var(--aura-pink)" fillOpacity={0.5} stroke="var(--aura-pink)" strokeOpacity={0.8} style={{ mixBlendMode: 'multiply' }} />
          <path d={polar(reached)} fill="var(--signal-change)" fillOpacity={0.55} stroke="var(--signal-change)" strokeOpacity={0.8} style={{ mixBlendMode: 'multiply' }} />
          <circle cx={C} cy={C} r={92} fill="var(--bg-sunken)" />
          <text x={C + 6} y={C - R0 - SCALE + 14} fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-secondary)">100% OF PEAK</text>
          <text x={C + 6} y={C - R0 - SCALE / 2 + 14} fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-secondary)">50%</text>
          {needs.map((r, i) => {
            const a = -Math.PI / 2 + (i / needs.length) * Math.PI * 2
            const cos = Math.cos(a)
            const lines = splitLabel(r.goal)
            const x = C + 240 * cos
            const y = C + 5 + 240 * Math.sin(a) - (lines.length - 1) * 8
            return (
              <text key={r.goal} x={x} y={y} textAnchor={cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'} fontSize={16} fill="var(--text-secondary)">
                {lines.map((l, j) => (
                  <tspan key={j} x={x} dy={j ? 19 : 0}>{l}</tspan>
                ))}
              </text>
            )
          })}
          <text x={C} y={C - 6} textAnchor="middle" fontSize={40} fontFamily="var(--font-dot)" fontWeight={800} fill="var(--text-primary)" style={{ fontVariationSettings: "'ROND' 100" }}>
            {totalUsers(d.cohort)}
          </text>
          <text x={C} y={C + 22} textAnchor="middle" fontSize={13} fill="var(--text-secondary)">people · up to 3 goals</text>
        </svg>
      </div>
      <div className="flex flex-wrap justify-center gap-3.5 text-[13px]">
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-full bg-pink" />Chose the goal</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-full bg-signal" />Real change by week {d.cohort.weeks}</span>
      </div>
    </>
  )
}

export function NeedsCard({ d }: { d: Insights }) {
  // The radial needs three goals or more to draw a shape; fewer start as the table.
  const [table, setTable] = useState(d.needs.length < 3)
  const csv = () =>
    exportCsv(
      'needs',
      d,
      ['goal', 'goal_in_app', 'people_n', 'real_change_pct', 'no_clear_change_pct', 'too_early_pct'],
      d.needs.map((r) => [r.goal, r.app_goal ?? '', r.n, r.real, r.none, r.early]),
    )
  return (
    <section id="needs" aria-labelledby="needs-h" className="retail-light retail-anchor flex flex-col gap-3 rounded-[44px] p-[clamp(20px,3vw,32px)] shadow-[0_40px_80px_-50px_rgba(0,0,0,.9)]" style={{ background: 'linear-gradient(180deg, #F4F3F1, #E2E1DE)' }}>
      <Head d={d} id="needs-h" eyebrow="CUSTOMER NEEDS · GOALS CHOSEN" title="Goal demand" light>
          <button type="button" onClick={() => setTable((t) => !t)} aria-pressed={table} disabled={d.needs.length < 3} className={`min-h-11 rounded-pill border border-line px-3.5 text-[13px] ${table ? 'bg-selected text-inverse' : 'bg-white text-ink'}`}>
            Table
          </button>
          <CsvButton onClick={csv} label="goal demand" light />
      </Head>
      {d.needs.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No goal has {MIN_GROUP} or more people yet, so nothing is shown.</p>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-ink-2">
                {['Goal', 'People', 'Real change', 'No clear change', 'Too early'].map((h) => (
                  <th key={h} scope="col" className="p-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.needs.map((r) => (
                <tr key={r.goal} className="border-t border-line">
                  <th scope="row" className="px-2 py-2.5 text-left font-normal">
                    {r.goal}
                    <AppGoal goal={r.goal} appGoal={r.app_goal} />
                  </th>
                  <td className="px-2 py-2.5 font-mono">{r.n}</td>
                  <td className="px-2 py-2.5 font-mono">{r.real}%</td>
                  <td className="px-2 py-2.5 font-mono">{r.none}%</td>
                  <td className="px-2 py-2.5 font-mono">{r.early}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Radial d={d} />
      )}
      <span className="text-[12px] text-ink-2">
        People choosing each goal, as a share of the most-chosen goal, with those who reached a real change in a goal metric by week {d.cohort.weeks}. One snapshot of the whole cohort: the data has no month-by-month split. Goals Willow can’t measure yet (dryness) and goals under {MIN_GROUP} people are left out.
      </span>
    </section>
  )
}

/* ───────────────────────────── brands ───────────────────────────── */

export function BrandsCard({ d }: { d: Insights }) {
  const brands = d.brands
  const csv = () =>
    exportCsv(
      'brands',
      d,
      ['brand', 'people_n', 'real_change_pct', 'interval_low_pct', 'interval_high_pct', 'still_using_after_wk4_pct'],
      brands.map((b) => [b.brand, b.n, Math.round(b.rate * 100), Math.round(b.lo * 100), Math.round(b.hi * 100), Math.round(b.cont * 100)]),
    )
  const top = brands[0]
  const widest = brands.length ? brands.reduce((a, b) => (b.n > a.n ? b : a)) : null
  const kept = brands.length ? brands.reduce((a, b) => (b.cont > a.cont ? b : a)) : null
  const stats = [
    top ? { k: 'Highest real-change rate', v: pct(top.rate), n: `${top.brand} · n=${top.n}` } : null,
    widest ? { k: 'Most people', v: String(widest.n), n: widest.brand } : null,
    kept ? { k: 'Still using after wk 4', v: pct(kept.cont), n: kept.brand } : null,
  ].filter((s): s is { k: string; v: string; n: string } => s !== null)
  return (
    <section id="brands" aria-labelledby="brands-h" className="retail-light retail-anchor flex flex-col gap-3.5 overflow-hidden rounded-[44px] bg-surface p-[clamp(20px,3vw,32px)] shadow-[0_40px_80px_-50px_rgba(0,0,0,.9)]">
      <Head d={d} id="brands-h" eyebrow="BRANDS · ALL CATEGORIES AND GOALS" title="Brands reaching a real change" light>
          <CsvButton onClick={csv} label="brands" light />
      </Head>
      {brands.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No brand has {MIN_GROUP} or more people yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
            {stats.map((s) => (
              <div key={s.k} className="flex flex-col gap-1">
                <span className="text-[13px] text-ink-2">{s.k}</span>
                <span className="font-mono text-[24px]">{s.v}</span>
                <span className="text-[12px] text-ink-2">{s.n}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <span className="text-[13px] text-ink-2">Real-change rate by week {d.cohort.weeks}, with its 95% interval</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {brands.map((b, i) => (
                <li key={b.brand} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-[14px]">
                  <span className="min-w-0 truncate" title={b.brand}>{b.brand}</span>
                  <span className="relative block h-3.5 overflow-hidden rounded-pill bg-muted" role="img" aria-label={`${b.brand}: ${pct(b.rate)} reached a real change, 95% interval ${pct(b.lo)} to ${pct(b.hi)}, ${b.n} people`}>
                    <span className="block h-full origin-left rounded-pill bg-signal animate-[wGrowX_.8s_cubic-bezier(.2,.7,.2,1)_both]" style={{ width: `${b.rate * 100}%`, animationDelay: `${i * 80}ms` }} />
                    {/* The interval: where the true rate likely sits with this many people. */}
                    <span aria-hidden className="absolute inset-y-[5px] rounded-pill bg-ink/35" style={{ left: `${b.lo * 100}%`, width: `${Math.max(1, (b.hi - b.lo) * 100)}%` }} />
                  </span>
                  <span className="whitespace-nowrap font-mono text-[13px]">{pct(b.rate)} · n={b.n}</span>
                </li>
              ))}
            </ul>
            <span className="text-[12px] text-ink-2">The {brands.length} brands with the highest rates. Brands with fewer than {MIN_GROUP} people are not in the data, so they are not listed. Dark line: 95% interval.</span>
          </div>
        </>
      )}
    </section>
  )
}

/* ───────────────────────────── product outcomes heat table ───────────────────────────── */

function HeatCell({ c }: { c: Cell }) {
  if (c.suppressed || c.value === null)
    return (
      <td className="retail-hatch rounded-[18px] px-3 py-2.5 text-ink-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[17px]">—</span>
          <span className="text-[12px]">n&lt;{MIN_GROUP}</span>
        </span>
      </td>
    )
  // Ember is the "real change" colour; its strength is the share with one (docs/DESIGN.md heat table: alpha = rate × 0.6).
  return (
    <td className="rounded-[18px] px-3 py-2.5 text-ink" style={{ background: `color-mix(in srgb, var(--signal-change) ${Math.round(c.value * 60)}%, var(--bg-sunken))` }}>
      <span className="flex flex-col gap-0.5">
        <span className="font-mono text-[17px]">{pct(c.value)}</span>
        <span className="text-[12px] opacity-85">{numerator(c)} / {c.n}</span>
      </span>
    </td>
  )
}

export function OutcomesCard({ d }: { d: Insights }) {
  const csv = () =>
    exportCsv(
      'outcomes',
      d,
      ['product', 'brand', 'concern', 'people_n', 'real_change_pct', ...d.tone_bands.map((b) => `${b} (people with change / n)`), 'median_weeks_to_change', 'still_using_after_wk4_pct', 'same_goal_not_using_pct', 'lift_pts'],
      d.products.map((p) => [
        p.product,
        p.brand,
        p.concern,
        p.n,
        Math.round(p.rate * 100),
        ...p.cells.map((c) => (c.suppressed || c.value === null ? 'suppressed' : `${numerator(c)}/${c.n}`)),
        p.weeks,
        Math.round(p.cont * 100),
        nonUserRate(p) === null ? 'suppressed' : Math.round(nonUserRate(p)! * 100),
        p.lift === null ? 'suppressed' : Math.round(p.lift * 100),
      ]),
    )
  return (
    <section id="outcomes" aria-labelledby="outcomes-h" className="retail-anchor flex flex-col gap-4 rounded-[44px] border border-line bg-surface p-[clamp(20px,3vw,32px)]">
      <Head d={d} id="outcomes-h" eyebrow="PRODUCT OUTCOMES · BY TONE BAND" title="Who sees a real change in their goal" big>
          <CsvButton onClick={csv} label="product outcomes" />
      </Head>
      <p className="m-0 max-w-[760px] text-[14px] leading-normal text-ink-2">
        Each person is compared with their own baseline. Tone bands describe who is in the cohort; they are not ranked. The {d.products.length} products with the most people are shown.
      </p>
      {d.products.length === 0 ? (
        <p className="py-8 text-center text-[15px] text-ink-2">No product has {MIN_GROUP} or more people at week {d.cohort.weeks} yet.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[1080px] border-separate border-spacing-x-2 border-spacing-y-1.5 text-[14px]">
            <thead>
              <tr className="text-left text-ink-2">
                <th scope="col" className="px-2.5 py-1.5 font-normal">Product</th>
                {d.tone_bands.map((b) => (
                  <th key={b} scope="col" className="w-[92px] px-2.5 py-1.5 font-normal first-letter:uppercase">{b}</th>
                ))}
                <th scope="col" className="px-2.5 py-1.5 font-normal">Time to change</th>
                <th scope="col" className="px-2.5 py-1.5 font-normal">Still using after wk 4</th>
                <th scope="col" className="px-2.5 py-1.5 font-normal">Same goal, not using</th>
              </tr>
            </thead>
            <tbody>
              {d.products.map((p) => {
                const base = nonUserRate(p)
                return (
                  <tr key={`${p.brand} ${p.product}`}>
                    <th scope="row" className="max-w-[260px] px-2.5 py-3 text-left font-normal">
                      <span className="flex flex-col gap-0.5">
                        <span>{p.product}</span>
                        <span className="text-[12px] text-ink-2">{p.brand} · {p.concern} · n={p.n}</span>
                      </span>
                    </th>
                    {p.cells.map((c, i) => (
                      <HeatCell key={i} c={c} />
                    ))}
                    <td className="px-3 py-2.5 font-mono">{weeksLabel(p.weeks)}</td>
                    <td className="px-3 py-2.5 font-mono">{pct(p.cont)}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">
                      {base === null ? (
                        <span className="flex flex-col gap-0.5"><span>—</span><span className="text-[12px]">n&lt;{MIN_GROUP}</span></span>
                      ) : (
                        <span className="flex flex-col gap-0.5"><span>{pct(base)}</span><span className="text-[12px]">lift {signedPts(p.lift!)}</span></span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[18px] text-[12px] text-ink-2">
        <span className="flex items-center gap-2">
          Real-change rate
          <span aria-hidden className="h-2.5 w-[120px] rounded-pill" style={{ background: 'linear-gradient(90deg, var(--bg-sunken), color-mix(in srgb, var(--signal-change) 60%, var(--bg-sunken)))' }} />
          0% → 100%
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="retail-hatch h-3.5 w-[22px] rounded-[6px]" />— , n&lt;{MIN_GROUP}: fewer than {MIN_GROUP} people, hidden
        </span>
        <span>Same goal, not using = people with the product’s goal who don’t use it. Lift = the product’s rate minus theirs.</span>
      </div>
    </section>
  )
}

/* ───────────────────────────── assortment gaps ───────────────────────────── */

const TIER_X: Record<Tier, number> = { budget: 24, mid: 56, premium: 86 }
const GAP_COLOURS = ['var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-4)', 'var(--aura-coral)', 'var(--aura-sky)', 'var(--chart-6)', 'var(--aura-violet)', 'var(--aura-pink)']
const REASON: Record<'missing' | 'low' | 'thin', string> = { missing: 'no option at this tier', low: 'low in every tier', thin: 'one option at this tier' }

export function GapsCard({ d }: { d: Insights }) {
  const flagged = d.gaps.flatMap((g) => {
    const t = gapTier(g)
    return t ? [{ g, ...t }] : []
  })
  // Plotted: the flagged tiers that have a rate (a missing tier, or one under 10 people, has none to place).
  const raw = flagged.filter((f) => f.g[f.tier].rate !== null).map((f, i) => ({ ...f, unmet: 1 - f.g[f.tier].rate!, colour: GAP_COLOURS[i % GAP_COLOURS.length] }))
  // y: more people without a real change sits higher. Labels in one tier column are pushed apart so they never overlap.
  const placed = raw.map((p) => ({ ...p, x: TIER_X[p.tier], y: 6 + (1 - p.unmet) * 78, ly: 6 + (1 - p.unmet) * 78 }))
  for (const tier of TIERS) {
    const col = placed.filter((p) => p.tier === tier).sort((a, b) => a.ly - b.ly)
    for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + 7)
  }
  const largest = raw.length ? raw.reduce((a, b) => (b.unmet > a.unmet ? b : a)) : null
  const csv = () =>
    exportCsv(
      'gaps',
      d,
      ['goal', 'goal_in_app', ...TIERS.flatMap((t) => [`${t}_options`, `${t}_real_change_pct`]), 'flagged_tier', 'suggested_action'],
      d.gaps.map((g) => {
        const t = gapTier(g)
        return [g.goal, g.app_goal ?? '', ...TIERS.flatMap((tier) => [g[tier].options, g[tier].rate === null ? (g[tier].options ? 'suppressed' : '') : Math.round(g[tier].rate! * 100)]), t ? t.tier : '', g.action]
      }),
    )
  const alt = raw.length
    ? `Assortment gaps by goal and price tier: ${raw.map((p) => `${p.g.goal}, ${p.tier}: ${pct(p.unmet)} without a real change, ${p.g[p.tier].options} ${p.g[p.tier].options === 1 ? 'option' : 'options'}`).join('; ')}.`
    : 'No goal has a gap by this rule.'
  return (
    <section id="gaps" aria-labelledby="gaps-h" className="retail-light retail-anchor flex flex-col gap-3 rounded-[44px] p-[clamp(20px,3vw,32px)]" style={{ background: '#E7E4DF' }}>
      <Head d={d} id="gaps-h" eyebrow="ASSORTMENT GAPS · GOAL × PRICE TIER" title="Demand without a measured winner" light>
          <CsvButton onClick={csv} label="assortment gaps" light />
      </Head>
      <div role="img" aria-label={alt} className="relative aspect-[4/3] overflow-hidden rounded-[24px]" style={{ backgroundImage: 'radial-gradient(circle, rgba(18,18,18,.28) 1.2px, transparent 1.6px)', backgroundSize: '22px 22px' }}>
        <span aria-hidden className="absolute bottom-[12%] left-[12%] right-[4%] h-px bg-ink/50" />
        <span aria-hidden className="absolute bottom-[12%] left-[12%] top-[6%] w-px bg-ink/50" />
        {placed.map((p) => (
          <span key={`b-${p.g.goal}`} aria-hidden className="absolute aspect-square w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[16px] mix-blend-multiply" style={{ left: `${p.x}%`, top: `${p.y}%`, background: `radial-gradient(circle, ${p.colour}, transparent 68%)` }} />
        ))}
        {placed.map((p) => (
          // Premium sits near the right edge: its labels end there instead of centring on the bubble.
          <span key={`l-${p.g.goal}`} aria-hidden className={`absolute -translate-y-1/2 whitespace-nowrap rounded-pill bg-white px-2.5 py-1.5 text-[12px] shadow-[0_6px_14px_-8px_rgba(0,0,0,.3)] ${p.tier === 'premium' ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${p.tier === 'premium' ? 96 : p.x}%`, top: `${p.ly}%` }}>
            {p.g.goal} · {pct(p.unmet)}
          </span>
        ))}
        {TIERS.map((t) => (
          <span key={t} aria-hidden className="absolute bottom-[4%] -translate-x-1/2 text-[12px] text-ink-2" style={{ left: `${TIER_X[t]}%` }}>{TIER_LABEL[t]}</span>
        ))}
        <span aria-hidden className="absolute bottom-[13.5%] right-[4%] font-mono text-[11px] text-ink-2">PRICE TIER →</span>
        <span aria-hidden className="absolute left-[2%] top-[6%] rotate-180 font-mono text-[11px] text-ink-2 [writing-mode:vertical-rl]">MORE WITHOUT A REAL CHANGE ↑</span>
      </div>
      <p className="m-0 text-[14px] leading-normal text-ink-2">
        Bubble = a goal’s weakest price tier, where the share of product users without a real change by week {d.cohort.weeks} is shown. A goal is flagged when a tier has no option, every tier is under 35%, or a tier has a single option. The data has no user count per tier, so bubbles are one size.
        {largest ? ` Largest gap: ${largest.g.goal.toLowerCase()}, ${largest.tier} tier.` : ''}
      </p>
      {flagged.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3">
          {flagged.map((f) => {
            const dot = raw.find((r) => r.g.goal === f.g.goal)?.colour
            const t = f.g[f.tier]
            return (
              <li key={f.g.goal} className="grid grid-cols-[12px_1fr] gap-2.5 text-[13px]">
                <span aria-hidden className="mt-1 size-3 rounded-full" style={{ background: dot ?? 'var(--text-disabled)' }} />
                <span>
                  <span className="font-medium">{f.g.goal}</span> · {TIER_LABEL[f.tier]} · {REASON[f.reason]} ·{' '}
                  <span className="font-mono">{t.options === 0 ? 'no product' : t.rate === null ? `—, n<${MIN_GROUP}` : `${pct(t.rate)} real change`}</span>
                  <span className="block text-ink-2">{f.g.action}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">Every goal has two or more options in each tier, and at least one tier at 35% or more.</p>
      )}
    </section>
  )
}

/* ───────────────────────────── routine conflicts ───────────────────────────── */

const CONFLICT_COLOURS = ['var(--aura-lilac)', 'var(--aura-coral)', 'var(--willow-400)', 'var(--aura-sky)', 'var(--aura-pink)']

export function ConflictsCard({ d }: { d: Insights }) {
  const rows = d.conflicts
  const max = Math.max(0.01, ...rows.map((c) => c.share))
  const csv = () =>
    exportCsv(
      'conflicts',
      d,
      ['finding', 'share_of_routines_pct', 'suggested_change', 'products_that_resolve_it'],
      rows.map((c) => [c.pair, Math.round(c.share * 100), c.fix, c.resolves.join('; ')]),
    )
  return (
    <section id="conflicts" aria-labelledby="conflicts-h" className="retail-anchor flex flex-col gap-4 rounded-[44px] border border-line bg-black p-[clamp(20px,3vw,32px)]">
      <Head d={d} id="conflicts-h" eyebrow="ROUTINE CONFLICTS · RULE TABLE" title="Most common findings">
          <CsvButton onClick={csv} label="routine conflicts" />
      </Head>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No finding appears in {MIN_GROUP} or more routines.</p>
      ) : (
        <div role="img" aria-label={rows.map((c) => `${c.pair}: ${pct(c.share)} of routines`).join('; ')} className="flex h-[280px] items-end gap-3">
          {rows.map((c, i) => (
            <div key={c.pair} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <span className="font-mono text-[20px]">{pct(c.share)}</span>
              <span className="block w-full max-w-[96px] origin-bottom rounded-pill animate-[wGrow_.9s_cubic-bezier(.2,.7,.2,1)_both]" style={{ height: `${Math.round((c.share / max) * 180)}px`, background: CONFLICT_COLOURS[i % CONFLICT_COLOURS.length], animationDelay: `${i * 90}ms` }} />
              <span className="min-h-[46px] text-center text-[12px] leading-tight text-ink-2">{c.pair}</span>
            </div>
          ))}
        </div>
      )}
      <span className="text-[13px] leading-snug text-ink-2">
        Share of the {d.cohort.synthetic} simulated routines checked with each finding. Fixed-rule findings only (the same rule table as the app); AI suggestions are excluded. Findings in fewer than {MIN_GROUP} routines are hidden.
      </span>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3 text-[13px]">
          {rows.map((c) => (
            <li key={c.pair}>
              <span className="text-ink">{c.pair}:</span> <span className="text-ink-2">{c.fix}.{c.resolves.length ? ` Resolved by ${c.resolves.join(', ')}.` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
