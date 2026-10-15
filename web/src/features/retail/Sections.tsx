import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import {
  cohortKind,
  exportCsv,
  gapTier,
  MIN_GROUP,
  monthLabel,
  nonUsers,
  numerator,
  outcomes,
  pct,
  signedPts,
  TIER_LABEL,
  TIERS,
  totalUsers,
  weeksLabel,
  type Category,
  type Cell,
  type Flow,
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
      {kind === 'mixed' ? (d.cohort.synthetic > d.cohort.real ? 'MIXED · MOSTLY SIMULATED' : 'MIXED · PART SIMULATED') : 'SIMULATED'}
    </span>
  )
}

/**
 * The design's pill radiogroup (range, cohort, category, split): the chosen option is filled, arrow keys move.
 * `light` draws it for the light cards (ink fill on a sand track); otherwise white fill on a dark track.
 */
export function SegRadio<T extends string>({ label, options, value, onChange, light, className = '' }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; light?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // A long group scrolls sideways: keep the chosen option in view (horizontally only, never the page).
  useLayoutEffect(() => {
    const box = ref.current
    const el = box?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!box || !el) return
    if (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft - 4
  }, [value])
  const move = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    onChange(options[(i + d + options.length) % options.length].value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={move}
      className={`no-scrollbar relative flex max-w-full gap-[3px] overflow-x-auto rounded-pill p-1 ${light ? 'bg-[#ECEBE7]' : 'border border-muted bg-sunken/90 [backdrop-filter:blur(14px)]'} ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`min-h-10 whitespace-nowrap rounded-pill px-3.5 text-[13px] transition-[background] duration-200 ${on ? (light ? 'bg-[#121212] text-white' : 'bg-white text-[#121212]') : light ? 'text-[#121212] hover:bg-black/5' : 'text-white hover:bg-white/10'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function CsvButton({ onClick, label, light, text = 'CSV ↓' }: { onClick: () => void; label: string; light?: boolean; text?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Download ${label} as CSV`}
      className={`min-h-11 rounded-pill px-4 text-[13px] ${light ? 'border border-line bg-white text-ink hover:bg-muted' : 'border border-line-strong bg-transparent text-ink hover:bg-glass'}`}
    >
      {text}
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

const Suppressed = () => (
  <span className="flex flex-col gap-0.5">
    <span>—</span>
    <span className="text-[12px]">n&lt;{MIN_GROUP}</span>
  </span>
)

/* ───────────────────────────── needs: radial by month + table ───────────────────────────── */

const C = 260 // radial centre (viewBox units)
const R0 = 100
const SCALE = 120
const MONTH_COLOURS = ['var(--aura-pink)', 'var(--aura-coral)', 'var(--aura-violet)']

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

type MonthView = { months: string[]; goals: { goal: string; goal_id: string; counts: (number | null)[]; share: (number | null)[] }[] }

/** The latest three months (the design's three series), goals that have at least one shown month. */
function monthView(d: Insights): MonthView {
  const nbm = d.needs_by_month
  if (!nbm || !nbm.months.length) return { months: [], goals: [] }
  const from = Math.max(0, nbm.months.length - 3)
  const goals = nbm.goals
    .map((g) => ({ goal: g.goal, goal_id: g.goal_id, counts: g.counts.slice(from), share: g.share_of_peak.slice(from) }))
    .filter((g) => g.counts.some((c) => c !== null))
  return { months: nbm.months.slice(from), goals }
}

function Radial({ d, v }: { d: Insights; v: MonthView }) {
  const alt = `Goal demand as a share of each month's most-chosen goal, ${v.months.map((m) => monthLabel(m)).join(', ')}. ${v.goals
    .map((g) => `${g.goal}: ${g.share.map((s, i) => `${monthLabel(v.months[i])} ${s === null ? `fewer than ${MIN_GROUP} people` : `${Math.round(s * 100)}% (${g.counts[i]} people)`}`).join(', ')}`)
    .join('; ')}.`
  return (
    <>
      <div role="img" aria-label={alt} className="w-full max-w-[500px] self-center">
        <svg viewBox="-70 0 660 530" aria-hidden className="block h-auto w-full overflow-visible">
          <circle cx={C} cy={C} r={R0 + SCALE} fill="none" stroke="currentColor" strokeOpacity={0.1} />
          <circle cx={C} cy={C} r={R0 + SCALE / 2} fill="none" stroke="currentColor" strokeOpacity={0.1} />
          {v.months.map((m, i) => (
            <path
              key={m}
              d={polar(v.goals.map((g) => g.share[i] ?? 0))}
              fill={MONTH_COLOURS[(i + 3 - v.months.length) % 3]}
              fillOpacity={0.5}
              stroke={MONTH_COLOURS[(i + 3 - v.months.length) % 3]}
              strokeOpacity={0.8}
              style={{ mixBlendMode: 'multiply' }}
            />
          ))}
          <circle cx={C} cy={C} r={92} fill="var(--bg-sunken)" />
          <text x={C + 6} y={C - R0 - SCALE + 14} fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-secondary)">100% OF PEAK</text>
          <text x={C + 6} y={C - R0 - SCALE / 2 + 14} fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-secondary)">50%</text>
          {v.goals.map((g, i) => {
            const a = -Math.PI / 2 + (i / v.goals.length) * Math.PI * 2
            const cos = Math.cos(a)
            const lines = splitLabel(g.goal)
            const x = C + 240 * cos
            const y = C + 5 + 240 * Math.sin(a) - (lines.length - 1) * 8
            return (
              <text key={g.goal_id} x={x} y={y} textAnchor={cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'} fontSize={16} fill="var(--text-secondary)">
                {lines.map((l, j) => (
                  <tspan key={j} x={x} dy={j ? 19 : 0}>{l}</tspan>
                ))}
              </text>
            )
          })}
          <text x={C} y={C - 6} textAnchor="middle" fontSize={40} fontFamily="var(--font-dot)" fontWeight={800} fill="var(--text-primary)" style={{ fontVariationSettings: "'ROND' 100" }}>
            {totalUsers(d.cohort)}
          </text>
          <text x={C} y={C + 22} textAnchor="middle" fontSize={13} fill="var(--text-secondary)">users · up to 3 goals</text>
        </svg>
      </div>
      <div className="flex flex-wrap justify-center gap-3.5 text-[13px]">
        {v.months.map((m, i) => (
          <span key={m} className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full" style={{ background: MONTH_COLOURS[(i + 3 - v.months.length) % 3] }} />
            {monthLabel(m)}
          </span>
        ))}
      </div>
    </>
  )
}

export function NeedsCard({ d }: { d: Insights }) {
  const v = monthView(d)
  // The radial needs three goals or more to draw a shape; fewer start as the table.
  const [table, setTable] = useState(v.goals.length < 3)
  const nbm = d.needs_by_month
  const csv = () =>
    exportCsv(
      'needs',
      d,
      ['goal', ...(nbm?.months ?? []).flatMap((m) => [`${m}_people`, `${m}_pct_of_peak`]), 'people_n', 'real_change_pct', 'no_clear_change_pct', 'too_early_pct', 'median_weeks_to_change'],
      d.needs.map((r) => {
        const g = nbm?.goals.find((x) => x.goal_id === r.goal_id)
        return [
          r.goal,
          ...(nbm?.months ?? []).flatMap((_, i) => [g?.counts[i] ?? 'suppressed', g?.share_of_peak[i] === null || !g ? 'suppressed' : Math.round(g.share_of_peak[i]! * 100)]),
          r.n,
          r.real,
          r.none,
          r.early,
          r.weeks ?? 'suppressed',
        ]
      }),
    )
  const needOf = (id: string) => d.needs.find((n) => n.goal_id === id)
  return (
    <section id="needs" aria-labelledby="needs-h" className="retail-light retail-anchor flex flex-col gap-3 rounded-[44px] p-[clamp(20px,3vw,32px)] shadow-[0_40px_80px_-50px_rgba(0,0,0,.9)]" style={{ background: 'linear-gradient(180deg, #F4F3F1, #E2E1DE)' }}>
      <Head d={d} id="needs-h" eyebrow="CUSTOMER NEEDS · GOALS CHOSEN" title="Goal demand by month" light>
        <button type="button" onClick={() => setTable((t) => !t)} aria-pressed={table} disabled={v.goals.length < 3} className={`min-h-11 rounded-pill border border-line px-3.5 text-[13px] ${table ? 'bg-selected text-inverse' : 'bg-white text-ink'}`}>
          Table
        </button>
        <CsvButton onClick={csv} label="goal demand" light />
      </Head>
      {v.goals.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No goal has {MIN_GROUP} or more people in a month yet, so nothing is shown.</p>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-ink-2">
                <th scope="col" className="p-2 font-normal">Goal</th>
                {v.months.map((m) => (
                  <th key={m} scope="col" className="p-2 font-normal">{monthLabel(m, true)}</th>
                ))}
                <th scope="col" className="p-2 font-normal">Real change</th>
                <th scope="col" className="p-2 font-normal">Median time</th>
              </tr>
            </thead>
            <tbody>
              {v.goals.map((g) => {
                const need = needOf(g.goal_id)
                return (
                  <tr key={g.goal_id} className="border-t border-line">
                    <th scope="row" className="px-2 py-2.5 text-left font-normal">{g.goal}</th>
                    {g.share.map((s, i) => (
                      <td key={i} className="px-2 py-2.5 font-mono">
                        {s === null ? (
                          <span className="text-ink-2">n&lt;{MIN_GROUP}</span>
                        ) : (
                          <span className="flex flex-col">
                            <span>{Math.round(s * 100)}%</span>
                            <span className="text-[12px] text-ink-2">{g.counts[i]} people</span>
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 font-mono">{need ? `${need.real}% of ${need.n}` : '—'}</td>
                    <td className="px-2 py-2.5 font-mono">{need?.weeks != null ? `${need.weeks} wk` : <span className="text-ink-2">n&lt;{MIN_GROUP}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Radial d={d} v={v} />
      )}
      <span className="text-[12px] text-ink-2">
        People choosing each goal among those with a reading that month, as a share of the month’s most-chosen goal; “Real change” is by week {d.cohort.weeks}, over everyone with the goal. Dryness can’t be measured, so it isn’t a goal. Groups under {MIN_GROUP} people are hidden.
      </span>
    </section>
  )
}

/* ───────────────────────────── category × goal flow + brands ───────────────────────────── */

const FLOW_X = [0, 120, 260, 400, 560]
const FLOW_CY = 150
const FLOW_MAX = 200 // px for the whole group (n)

/** One band through the 5 x-stops, horizontal-tangent S-curves between them (the design's `flow`). */
function band(w: number[]): string {
  const top = FLOW_X.map((x, i) => [x, FLOW_CY - w[i] / 2])
  const bot = FLOW_X.map((x, i) => [x, FLOW_CY + w[i] / 2]).reverse()
  const seg = (a: number[][]) => a.map((p, i) => (i === 0 ? `${p[0]},${p[1].toFixed(1)}` : `C${(a[i - 1][0] + p[0]) / 2},${a[i - 1][1].toFixed(1)} ${(a[i - 1][0] + p[0]) / 2},${p[1].toFixed(1)} ${p[0]},${p[1].toFixed(1)}`)).join(' ')
  return `M${seg(top)} L${seg(bot)}Z`
}

function FlowChart({ f, cat }: { f: Flow; cat: string }) {
  // Widths are shares of the group (n), so 100% = FLOW_MAX px. The ends repeat weeks 2 and 8.
  const px = (v: number) => Math.max(2, (v / f.n) * FLOW_MAX)
  const at = (arr: number[]) => [arr[0], arr[0], arr[1], arr[2], arr[2]].map(px)
  const alt = `${cat}, ${f.goal} goal, ${f.n} users: still using a ${cat.toLowerCase()} product for it at weeks ${f.weeks.join(', ')}: ${f.using.join(', ')}; with a real change by then: ${f.changed.join(', ')}.`
  return (
    <div role="img" aria-label={alt} className="-mx-[clamp(20px,3vw,32px)]">
      <svg viewBox="0 0 560 300" aria-hidden className="block h-auto w-full">
        <defs>
          <filter id="flow-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
        </defs>
        <path d={band(at(f.using))} fill="var(--aura-apricot)" opacity={0.35} filter="url(#flow-glow)" />
        <path d={band(at(f.using))} fill="var(--aura-apricot)" opacity={0.6} />
        <path d={band(at(f.changed))} fill="var(--signal-change)" />
        {f.weeks.map((wk, i) => {
          const x = FLOW_X[i + 1]
          return (
            <g key={wk}>
              <line x1={x} x2={x} y1={52} y2={250} stroke="#fff" strokeWidth={2} />
              <rect x={x - 42} y={20} width={84} height={32} rx={16} fill="#fff" />
              <text x={x} y={41} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill="#121212">{f.changed[i]}</text>
              <rect x={x - 42} y={250} width={84} height={32} rx={16} fill="#fff" />
              <text x={x} y={271} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill="#121212">WK {wk}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function BrandRows({ brands, hidden }: { brands: Category['brands']; hidden: number }) {
  const max = Math.max(0.01, ...brands.map((b) => b.hi))
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {brands.map((b, i) => (
        <li key={b.brand} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-[14px]">
          <span className="min-w-0 truncate" title={b.brand}>{b.brand}</span>
          <span className="relative block h-3.5 overflow-hidden rounded-pill bg-[#ECEBE7]" role="img" aria-label={`${b.brand}: ${pct(b.rate)} reached a real change, 95% interval ${pct(b.lo)} to ${pct(b.hi)}, ${b.n} people`}>
            <span className="block h-full origin-left rounded-pill bg-signal animate-[wGrowX_.8s_cubic-bezier(.2,.7,.2,1)_both]" style={{ width: `${(b.rate / max) * 100}%`, animationDelay: `${i * 80}ms` }} />
            {/* The interval: where the true rate likely sits with this many people. */}
            <span aria-hidden className="absolute inset-y-[5px] rounded-pill bg-ink/35" style={{ left: `${(b.lo / max) * 100}%`, width: `${Math.max(1, ((b.hi - b.lo) / max) * 100)}%` }} />
          </span>
          <span className="whitespace-nowrap font-mono text-[13px]">{pct(b.rate)} · n={b.n}</span>
        </li>
      ))}
      {hidden ? (
        <li className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-[14px] text-ink-2">
          <span>{hidden} more {hidden === 1 ? 'brand' : 'brands'}</span>
          <span aria-hidden className="block h-3.5 rounded-pill" style={{ background: 'repeating-linear-gradient(135deg, #DCDAD5 0 5px, #ECEBE7 5px 10px)' }} />
          <span className="whitespace-nowrap font-mono text-[13px]">suppressed · n&lt;{MIN_GROUP}</span>
        </li>
      ) : null}
    </ul>
  )
}

export function CategoryCard({ d }: { d: Insights }) {
  const cats = (d.categories ?? []).filter((c) => c.flows.length)
  const [catId, setCatId] = useState(() => (cats.find((c) => c.category === 'serum') ?? cats[0])?.category ?? '')
  const cat = cats.find((c) => c.category === catId) ?? cats[0]
  const [goalPick, setGoalPick] = useState('dark_spots')
  const flow = cat ? (cat.flows.find((f) => f.goal_id === goalPick) ?? cat.flows[0]) : undefined
  const csv = () =>
    exportCsv(
      'category-flows',
      d,
      ['category', 'goal', 'users_n', ...[2, 4, 8].map((w) => `real_change_by_wk${w}`), ...[2, 4, 8].map((w) => `still_using_wk${w}`), 'real_change_pct', 'median_weeks', 'non_users_with_change', 'non_users_n'],
      cats.flatMap((c) => c.flows.map((f) => [c.label, f.goal, f.n, ...f.changed, ...f.using, Math.round(f.rate * 100), f.median_weeks ?? 'suppressed', f.base ? f.base.k : 'suppressed', f.base ? f.base.n : 'suppressed'])),
    )
  const brandCsv = () =>
    exportCsv(
      'brands-by-category',
      d,
      ['category', 'brand', 'people_n', 'real_change_pct', 'interval_low_pct', 'interval_high_pct', 'still_using_after_wk4_pct'],
      cats.flatMap((c) => [...c.brands.map((b) => [c.label, b.brand, b.n, Math.round(b.rate * 100), Math.round(b.lo * 100), Math.round(b.hi * 100), Math.round(b.cont * 100)]), ...(c.brands_hidden ? [[c.label, `${c.brands_hidden} brands`, 'suppressed', '', '', '', '']] : [])]),
    )
  const stats = flow
    ? [
        { k: `Real change by wk ${d.cohort.weeks}`, v: pct(flow.rate), n: `${flow.changed[flow.changed.length - 1]} / ${flow.n} users` },
        { k: 'Median time', v: weeksLabel(flow.median_weeks), n: flow.median_weeks === null ? `fewer than ${MIN_GROUP} changed` : 'among those who changed' },
        { k: 'Non-users, same goal', v: flow.base ? pct(flow.base.rate) : '—', n: flow.base ? `${flow.base.k} / ${flow.base.n} users` : `suppressed · n<${MIN_GROUP}` },
      ]
    : []
  return (
    <section id="brands" aria-labelledby="brands-h" className="retail-light retail-anchor flex flex-col gap-3.5 overflow-hidden rounded-[44px] bg-surface p-[clamp(20px,3vw,32px)] shadow-[0_40px_80px_-50px_rgba(0,0,0,.9)]">
      <Head d={d} id="brands-h" eyebrow={`CATEGORY · ${flow ? `${flow.goal.toUpperCase()} GOAL` : 'GOAL'}`} title="Users reaching a real change" light>
        <CsvButton onClick={csv} label="category flows" light />
      </Head>
      {!cat || !flow ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No category has {MIN_GROUP} or more users for one goal at week {d.cohort.weeks} yet.</p>
      ) : (
        <>
          <SegRadio label="Category" light options={cats.map((c) => ({ value: c.category, label: c.label }))} value={cat.category} onChange={setCatId} />
          <SegRadio label="Goal" light options={cat.flows.map((f) => ({ value: f.goal_id, label: `${f.goal} · ${f.n}` }))} value={flow.goal_id} onChange={setGoalPick} />
          <FlowChart f={flow} cat={cat.label} />
          <span className="-mt-1.5 text-[12px] text-ink-2">
            {cat.label} users with the {flow.goal.toLowerCase()} goal at week {d.cohort.weeks} (n={flow.n}). Ember band and upper pill: users whose real change (held to week {d.cohort.weeks}) had begun by that week. Light band: users still using a {cat.label.toLowerCase()} product for the goal.
          </span>
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
            <span className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-2">
              Brands in {cat.label.toLowerCase()} · real-change rate by week {d.cohort.weeks}, with its 95% interval
              <CsvButton onClick={brandCsv} label="brands by category" light text="Brands CSV ↓" />
            </span>
            {cat.brands.length || cat.brands_hidden ? <BrandRows brands={cat.brands} hidden={cat.brands_hidden} /> : <span className="text-[13px] text-ink-2">No brand in this category has {MIN_GROUP} or more people.</span>}
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

type Split = 'tone' | 'skin'

export function OutcomesCard({ d }: { d: Insights }) {
  const hasSkin = Boolean(d.skin_types?.length && d.products.some((p) => p.cells_skin?.length))
  const [split, setSplit] = useState<Split>('tone')
  const by = hasSkin ? split : 'tone'
  const bands = by === 'tone' ? d.tone_bands : d.skin_types!
  const cellsOf = (p: Insights['products'][number]) => (by === 'tone' ? p.cells : p.cells_skin!)
  const wk8 = d.products.some((p) => p.cont8 !== undefined)
  const csv = () =>
    exportCsv(
      `outcomes-by-${by === 'tone' ? 'tone-band' : 'skin-type'}`,
      d,
      ['product', 'brand', 'concern', 'people_n', 'real_change_pct', ...bands.map((b) => `${b} (people with change / n)`), 'median_weeks_to_change', wk8 ? 'still_using_wk8_pct' : 'still_using_after_wk4_pct', 'non_users_with_change', 'non_users_n', 'non_users_pct', 'lift_pts'],
      d.products.map((p) => {
        const base = nonUsers(p)
        return [
          p.product,
          p.brand,
          p.concern,
          p.n,
          Math.round(p.rate * 100),
          ...cellsOf(p).map((c) => (c.suppressed || c.value === null ? 'suppressed' : `${numerator(c)}/${c.n}`)),
          p.weeks,
          Math.round((p.cont8 ?? p.cont) * 100),
          base?.k ?? 'suppressed',
          base?.n ?? 'suppressed',
          base ? Math.round(base.rate * 100) : 'suppressed',
          p.lift === null ? 'suppressed' : Math.round(p.lift * 100),
        ]
      }),
    )
  return (
    <section id="outcomes" aria-labelledby="outcomes-h" className="retail-anchor flex flex-col gap-4 rounded-[44px] border border-line bg-surface p-[clamp(20px,3vw,32px)]">
      <Head d={d} id="outcomes-h" eyebrow={`PRODUCT OUTCOMES · ${by === 'tone' ? 'BY TONE BAND' : 'BY SKIN PROFILE'}`} title="Who sees a real change in their goal" big>
        {hasSkin ? (
          <SegRadio
            label="Split by"
            options={[
              { value: 'tone', label: 'Tone band' },
              { value: 'skin', label: 'Skin profile' },
            ]}
            value={split}
            onChange={setSplit}
          />
        ) : null}
        <CsvButton onClick={csv} label="product outcomes" />
      </Head>
      <p className="m-0 max-w-[760px] text-[14px] leading-normal text-ink-2">
        {by === 'tone'
          ? 'Each person is compared with their own baseline. Tone bands describe who is in the cohort; they are not ranked.'
          : 'Self-reported skin type from the profile (optional). Each person is compared with their own baseline. In the simulation skin type has no effect on outcomes.'}{' '}
        The {d.products.length} products with the most people are shown; every product with evidence is listed below.
      </p>
      {d.products.length === 0 ? (
        <p className="py-8 text-center text-[15px] text-ink-2">No product has {MIN_GROUP} or more people at week {d.cohort.weeks} yet.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[1080px] border-separate border-spacing-x-2 border-spacing-y-1.5 text-[14px]">
            <thead>
              <tr className="text-left text-ink-2">
                <th scope="col" className="px-2.5 py-1.5 font-normal">Product</th>
                {bands.map((b) => (
                  <th key={b} scope="col" className="w-[92px] px-2.5 py-1.5 font-normal first-letter:uppercase">{b}</th>
                ))}
                <th scope="col" className="px-2.5 py-1.5 font-normal">Time to change</th>
                <th scope="col" className="px-2.5 py-1.5 font-normal">{wk8 ? `Still using wk ${d.cohort.weeks}` : 'Still using after wk 4'}</th>
                <th scope="col" className="px-2.5 py-1.5 font-normal">Non-users</th>
              </tr>
            </thead>
            <tbody>
              {d.products.map((p) => {
                const base = nonUsers(p)
                return (
                  <tr key={`${p.brand} ${p.product}`}>
                    <th scope="row" className="max-w-[260px] px-2.5 py-3 text-left font-normal">
                      <span className="flex flex-col gap-0.5">
                        <span>{p.product}</span>
                        <span className="text-[12px] text-ink-2">{p.brand} · {p.concern} · n={p.n}</span>
                      </span>
                    </th>
                    {cellsOf(p).map((c, i) => (
                      <HeatCell key={i} c={c} />
                    ))}
                    <td className="px-3 py-2.5 font-mono">{weeksLabel(p.weeks)}</td>
                    <td className="px-3 py-2.5 font-mono">{pct(p.cont8 ?? p.cont)}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">
                      {base === null ? (
                        <Suppressed />
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          <span>{pct(base.rate)}{base.k !== null ? ` · ${base.k}/${base.n}` : ''}</span>
                          {p.lift !== null ? <span className="text-[12px]">lift {signedPts(p.lift)}</span> : null}
                        </span>
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
        <span>Non-users = people with the product’s goal who don’t use it (with a change / all). Lift = the product’s rate minus theirs.</span>
      </div>
    </section>
  )
}

/* ───────────────────────────── every product with evidence ───────────────────────────── */

export function AllProductsCard({ d }: { d: Insights }) {
  const [open, setOpen] = useState(false)
  const rows = outcomes(d).sort((a, b) => b.rate - a.rate || b.n - a.n || a.product.localeCompare(b.product))
  if (!rows.length) return null
  const wk8 = rows.some((r) => r.cont8 !== undefined)
  const csv = () =>
    exportCsv(
      'all-products',
      d,
      ['product', 'brand', 'category', 'concern', 'people_n', 'real_change_pct', 'lift_pts', 'median_weeks_to_change', wk8 ? 'still_using_wk8_pct' : 'still_using_after_wk4_pct'],
      rows.map((r) => [r.product, r.brand, r.category ?? '', r.concern, r.n, Math.round(r.rate * 100), r.lift === null || r.lift === undefined ? 'suppressed' : Math.round(r.lift * 100), r.weeks, Math.round((r.cont8 ?? r.cont) * 100)]),
    )
  const shown = open ? rows : rows.slice(0, 5)
  return (
    <section aria-labelledby="all-products-h" className="flex flex-col gap-4 rounded-[44px] border border-line bg-surface p-[clamp(20px,3vw,32px)]">
      <Head d={d} id="all-products-h" eyebrow={`EVERY PRODUCT WITH ${MIN_GROUP}+ PEOPLE AT WEEK ${d.cohort.weeks}`} title={`All products with evidence · ${rows.length}`}>
        <CsvButton onClick={csv} label="all products with evidence" />
      </Head>
      <div className="-mx-2 overflow-x-auto">
        <table id="all-products-table" className="w-full min-w-[760px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-ink-2">
              {['Product', 'Category', 'People', 'Real change', 'Lift vs non-users', 'Time to change', wk8 ? `Still using wk ${d.cohort.weeks}` : 'Still using after wk 4'].map((h) => (
                <th key={h} scope="col" className="px-2.5 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.product_id} className="border-t border-line">
                <th scope="row" className="max-w-[300px] px-2.5 py-2.5 text-left font-normal">
                  <span className="flex flex-col gap-0.5">
                    <span>{r.product}</span>
                    <span className="text-[12px] text-ink-2">{r.brand} · {r.concern}</span>
                  </span>
                </th>
                <td className="px-2.5 py-2.5 text-ink-2 first-letter:uppercase">{(r.category ?? '').replace('_', ' ')}</td>
                <td className="px-2.5 py-2.5 font-mono">{r.n}</td>
                <td className="px-2.5 py-2.5 font-mono">{pct(r.rate)}</td>
                <td className="px-2.5 py-2.5 font-mono text-ink-2">{r.lift === null || r.lift === undefined ? `—, n<${MIN_GROUP}` : signedPts(r.lift)}</td>
                <td className="px-2.5 py-2.5 font-mono">{weeksLabel(r.weeks)}</td>
                <td className="px-2.5 py-2.5 font-mono">{pct(r.cont8 ?? r.cont)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 5 ? (
        <button type="button" aria-expanded={open} aria-controls="all-products-table" onClick={() => setOpen((o) => !o)} className="min-h-11 self-start rounded-pill border border-line-strong px-4 text-[13px] text-ink hover:bg-glass">
          {open ? 'Show the top 5' : `Show all ${rows.length}`}
        </button>
      ) : null}
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
  const raw = flagged.filter((f) => f.g[f.tier].rate !== null).map((f, i) => ({ ...f, unmet: 1 - f.g[f.tier].rate!, users: f.g[f.tier].n ?? null, colour: GAP_COLOURS[i % GAP_COLOURS.length] }))
  const maxUsers = Math.max(1, ...raw.map((p) => p.users ?? 0))
  // y: more people without a real change sits higher; size: area ∝ users (the design's 12 + √share × 34).
  const placed = raw.map((p) => ({ ...p, x: TIER_X[p.tier], y: 6 + (1 - p.unmet) * 78, ly: 6 + (1 - p.unmet) * 78, size: 12 + Math.sqrt((p.users ?? 0) / maxUsers) * 34 }))
  // Labels in one tier column are pushed apart so they never overlap.
  for (const tier of TIERS) {
    const col = placed.filter((p) => p.tier === tier).sort((a, b) => a.ly - b.ly)
    for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + 7)
  }
  const largest = raw.length ? raw.reduce((a, b) => ((b.users ?? 0) * b.unmet > (a.users ?? 0) * a.unmet ? b : a)) : null
  const csv = () =>
    exportCsv(
      'gaps',
      d,
      ['goal', ...TIERS.flatMap((t) => [`${t}_options`, `${t}_users`, `${t}_real_change_pct`]), 'flagged_tier', 'suggested_action'],
      d.gaps.map((g) => {
        const t = gapTier(g)
        return [g.goal, ...TIERS.flatMap((tier) => [g[tier].options, g[tier].n ?? (g[tier].options ? 'suppressed' : 0), g[tier].rate === null ? (g[tier].options ? 'suppressed' : '') : Math.round(g[tier].rate! * 100)]), t ? t.tier : '', g.action]
      }),
    )
  const alt = raw.length
    ? `Assortment gaps by goal and price tier: ${raw.map((p) => `${p.g.goal}, ${p.tier}: ${pct(p.unmet)} without a real change, ${p.users ?? `fewer than ${MIN_GROUP}`} users, ${p.g[p.tier].options} ${p.g[p.tier].options === 1 ? 'option' : 'options'}`).join('; ')}.`
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
          <span key={`b-${p.g.goal}`} aria-hidden className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full blur-[16px] mix-blend-multiply" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}%`, background: `radial-gradient(circle, ${p.colour}, transparent 68%)` }} />
        ))}
        {placed.map((p) => (
          // Premium sits near the right edge: its labels end there instead of centring on the bubble.
          <span key={`l-${p.g.goal}`} aria-hidden className={`absolute -translate-y-1/2 whitespace-nowrap rounded-pill bg-white px-2.5 py-1.5 text-[12px] shadow-[0_6px_14px_-8px_rgba(0,0,0,.3)] ${p.tier === 'premium' ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${p.tier === 'premium' ? 96 : p.x}%`, top: `${p.ly}%` }}>
            {p.g.goal} · {p.users ?? `n<${MIN_GROUP}`}
          </span>
        ))}
        {TIERS.map((t) => (
          <span key={t} aria-hidden className="absolute bottom-[4%] -translate-x-1/2 text-[12px] text-ink-2" style={{ left: `${TIER_X[t]}%` }}>{TIER_LABEL[t]}</span>
        ))}
        <span aria-hidden className="absolute bottom-[13.5%] right-[4%] font-mono text-[11px] text-ink-2">PRICE TIER →</span>
        <span aria-hidden className="absolute left-[2%] top-[6%] rotate-180 font-mono text-[11px] text-ink-2 [writing-mode:vertical-rl]">MORE WITHOUT A REAL CHANGE ↑</span>
      </div>
      <p className="m-0 text-[14px] leading-normal text-ink-2">
        Bubble = a goal’s weakest price tier; height = share of that tier’s product users without a real change by week {d.cohort.weeks}; size and number = those users. A goal is flagged when a tier has no option, every tier is under 35%, or a tier has a single option.
        {largest ? ` Largest gap: ${largest.tier} ${largest.g.goal.toLowerCase()}.` : ''}
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
                  <span className="font-mono">{t.options === 0 ? 'no product' : t.rate === null ? `—, n<${MIN_GROUP}` : `${pct(t.rate)} real change of ${t.n} users`}</span>
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
  const checked = d.routines_checked ?? d.cohort.synthetic
  const csv = () =>
    exportCsv(
      'conflicts',
      d,
      ['finding', 'routines_with_it', 'routines_checked', 'share_of_routines_pct', 'suggested_change', 'products_that_resolve_it'],
      rows.map((c) => [c.pair, c.n ?? '', checked, Math.round(c.share * 100), c.fix, c.resolves.join('; ')]),
    )
  return (
    <section id="conflicts" aria-labelledby="conflicts-h" className="retail-anchor flex flex-col gap-4 rounded-[44px] border border-line bg-black p-[clamp(20px,3vw,32px)]">
      <Head d={d} id="conflicts-h" eyebrow="ROUTINE CONFLICTS · RULE TABLE" title="Most common findings">
        <CsvButton onClick={csv} label="routine conflicts" />
      </Head>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-2">No finding appears in {MIN_GROUP} or more routines.</p>
      ) : (
        <div role="img" aria-label={rows.map((c) => `${c.pair}: ${pct(c.share)} of routines${c.n ? ` (${c.n} of ${checked})` : ''}`).join('; ')} className="flex h-[280px] items-end gap-3">
          {rows.map((c, i) => (
            <div key={c.pair} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <span className="flex flex-col items-center">
                <span className="font-mono text-[20px]">{pct(c.share)}</span>
                {c.n ? <span className="font-mono text-[11px] text-ink-2">{c.n}</span> : null}
              </span>
              <span className="block w-full max-w-[96px] origin-bottom rounded-pill animate-[wGrow_.9s_cubic-bezier(.2,.7,.2,1)_both]" style={{ height: `${Math.round((c.share / max) * 180)}px`, background: CONFLICT_COLOURS[i % CONFLICT_COLOURS.length], animationDelay: `${i * 90}ms` }} />
              <span className="min-h-[46px] text-center text-[12px] leading-tight text-ink-2">{c.pair}</span>
            </div>
          ))}
        </div>
      )}
      <span className="text-[13px] leading-snug text-ink-2">
        Share of the {checked} routines checked with each finding. Fixed-rule findings only (the same rule table as the app); AI suggestions are excluded. Findings in fewer than {MIN_GROUP} routines are hidden.
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
