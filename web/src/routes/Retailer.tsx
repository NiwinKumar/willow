import { Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AskData } from '../components/AskData'
import { Chip } from '../components/Chip'
import { api, type RetailerInsights } from '../lib/api'

type Cell = RetailerInsights['products'][number]['cells'][number]

/** The same suppressed aggregates as a shareable Data Studio report (api/scripts/publish_looker.py). */
const DATA_STUDIO = 'https://datastudio.google.com/reporting/5147af6b-c268-470a-a420-2277dfcfe7df'

const TABS = ['Needs next', 'Product outcomes', 'Brands', 'Assortment gaps', 'Routine conflicts', 'About this data'] as const

export function Retailer() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Product outcomes')
  const [d, setD] = useState<RetailerInsights | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .retailerInsights()
      .then((r) => alive && setD(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [attempt])

  if (!d)
    return (
      <div className="mx-auto max-w-[36rem] px-5 py-12" role="status">
        {failed ? (
          <>
            <p className="text-[15px] text-text-2">The insights could not be loaded.</p>
            <button type="button" className="mt-3 font-medium underline-offset-2 hover:underline" onClick={() => { setFailed(false); setAttempt((a) => a + 1) }}>Try again</button>
          </>
        ) : (
          <p className="text-[15px] text-text-2">Querying BigQuery…</p>
        )}
      </div>
    )

  const best = [...d.products].sort((a, b) => b.rate - a.rate)[0]
  const evidence = d.product_outcomes ? Object.keys(d.product_outcomes).length : d.products.length
  const zeroTiers = d.gaps.flatMap((g) => (['budget', 'mid', 'premium'] as const).filter((t) => g[t].options === 0).map((t) => `${g.goal}, ${t}`))
  const thinTiers = d.gaps.flatMap((g) => (['budget', 'mid', 'premium'] as const).filter((t) => g[t].options === 1).map((t) => `${g.goal}, ${t}`))
  const spf = d.conflicts.find((c) => c.pair.startsWith('No morning sunscreen'))
  const topClash = d.conflicts.find((c) => !c.pair.startsWith('No morning sunscreen'))
  // Conflict shares are computed over every routine checked (api retailer.py), not week-8 actives.
  const routines = d.cohort.synthetic + d.cohort.real
  return (
    <div className="pb-20">
      <div role="status" className="bg-warn/18 px-5 py-2 text-[13px] text-warn-text sm:px-8">
        <strong className="font-semibold">Synthetic data only</strong> · {d.cohort.synthetic} simulated users{d.cohort.real ? `, ${d.cohort.real} real` : ', no real customers'} · simulated outcomes follow Willow's measured noise model ·{' '}
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setTab('About this data')}>About this data</button>
      </div>
      <div className="mx-auto w-full max-w-[1120px] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Retailer insights</h1>
          <a href={DATA_STUDIO} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-(--radius-control) border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            Open the Data Studio report <ExternalLink size={14} aria-hidden />
          </a>
        </div>
        <AskData />
        <nav className="-mx-5 mt-4 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label="Retailer views">
          <ul className="flex gap-1 border-b border-border" role="tablist">
            {TABS.map((t) => (
              <li key={t} role="presentation">
                <button type="button" role="tab" onClick={() => setTab(t)} aria-selected={tab === t} className={`min-h-11 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${tab === t ? 'border-text font-semibold' : 'border-transparent text-text-2 hover:text-text'}`}>{t}</button>
              </li>
            ))}
          </ul>
        </nav>

        {tab === 'Needs next' ? (
          <Section q="What do customers need next?" tiles={d.tiles} csv={d.needs}>
            <ul className="space-y-3">
              {d.needs.map((r) => (
                <li key={r.goal}>
                  <div className="flex justify-between gap-3 text-[13px]"><span className="font-medium">{r.goal}</span><span className="font-mono text-text-2"><span className="text-signal-700">{r.real}% real</span> · {r.none}% no change · n={r.n}</span></div>
                  <div className="mt-1 flex h-6 w-full overflow-hidden rounded-(--radius-chip)" role="img" aria-label={`${r.goal}: ${r.real}% real change, ${r.none}% no clear change, ${r.early}% too early`}>
                    <span style={{ width: `${r.real}%` }} className="bg-signal-500" />
                    <span style={{ width: `${r.none}%` }} className="chip-hatch bg-noise-band" />
                    <span style={{ width: `${r.early}%` }} className="bg-surface-2" />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-text-3">Blue: real change in the target metric by week 8. Hatched: no clear change. Grey: too early.</p>
          </Section>
        ) : null}

        {tab === 'Product outcomes' ? (
          <Section q="Which products actually help which profiles?" csv={d.products.map(({ cells, ...p }) => ({ ...p, ...Object.fromEntries(cells.map((c, i) => [`${d.tone_bands[i]} (%)`, c.suppressed || c.value === null ? '' : Math.round(c.value * 100)])) }))} tiles={[{ label: 'Products with evidence', value: String(evidence), sub: `10 or more users each; top ${d.products.length} shown` }, { label: 'Best outcome rate', value: best ? `${Math.round(best.rate * 100)}%` : '–', n: best?.n ?? 0, sub: best ? `${best.brand} ${best.product}` : '' }, { label: 'Median weeks to change', value: d.tiles[3].value, n: d.tiles[3].n, sub: 'held to week 8' }, { label: 'Users at week 8', value: d.tiles[0].value, n: d.tiles[0].n, sub: `${Math.round(d.cohort.dropout * 100)}% of ${routines} dropped out` }]}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-text-2">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Concern</th>
                    {d.tone_bands.map((b) => <th key={b} className="py-2 pr-2 font-medium">{b}</th>)}
                    <th className="py-2 pr-2 font-medium">Lift vs non-users</th>
                    <th className="py-2 font-medium">Weeks to change · still using</th>
                  </tr>
                </thead>
                <tbody>
                  {d.products.map((p) => (
                    <tr key={p.product} className="border-t border-border">
                      <td className="py-2 pr-3"><span className="font-medium">{p.product}</span><span className="block text-text-3">{p.brand}</span></td>
                      <td className="py-2 pr-3 text-text-2">{p.concern}</td>
                      {p.cells.map((c, i) => <td key={i} className="py-1 pr-2"><HeatCell c={c} /></td>)}
                      <td className="py-2 pr-2 font-mono">{p.lift === null ? '–' : `${p.lift >= 0 ? '+' : ''}${Math.round(p.lift * 100)} pts`}</td>
                      <td className="py-2 font-mono">{p.weeks !== null ? `${p.weeks} wk` : '–'} · {Math.round(p.cont * 100)}% kept</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-text-3">Cell = share of users with a real change in the target metric by week 8, with n. Hatched cells have fewer than 10 users and are hidden.</p>
          </Section>
        ) : null}

        {tab === 'Brands' ? (
          <Section q="How are our brands performing on measured outcomes?" csv={d.brands} tiles={[{ label: 'Brands with evidence', value: String(d.brands.length), sub: '10 or more users each' }, { label: 'Highest outcome rate', value: d.brands[0] ? `${Math.round(d.brands[0].rate * 100)}%` : '–', n: d.brands[0]?.n ?? 0, sub: d.brands[0]?.brand ?? '' }, { label: 'Lowest outcome rate', value: d.brands.at(-1) ? `${Math.round(d.brands.at(-1)!.rate * 100)}%` : '–', n: d.brands.at(-1)?.n ?? 0, sub: d.brands.at(-1)?.brand ?? '' }, { label: 'Best continuation', value: d.brands.length ? `${Math.round(Math.max(...d.brands.map((b) => b.cont)) * 100)}%` : '–', sub: 'still using after week 4' }]}>
            <ul className="space-y-3">
              {d.brands.map((b) => (
                <li key={b.brand} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="font-medium">{b.brand}</span>
                  <div className="relative h-6" role="img" aria-label={`${b.brand}: outcome rate ${Math.round(b.rate * 100)}%, interval ${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}, n=${b.n}`}>
                    <span className="absolute inset-y-0 left-0 right-0 top-1/2 h-px bg-border" />
                    <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-noise-band" style={{ left: `${b.lo * 100}%`, width: `${(b.hi - b.lo) * 100}%` }} />
                    <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-500 ring-2 ring-surface" style={{ left: `${b.rate * 100}%` }} />
                  </div>
                  <span className="whitespace-nowrap font-mono text-text-2">{Math.round(b.rate * 100)}% · n={b.n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-text-3">Dot: outcome rate at week 8. Band: 95% Wilson interval. Continuation is the repeat-purchase analogue.</p>
          </Section>
        ) : null}

        {tab === 'Assortment gaps' ? (
          <Section q="Where are the assortment gaps?" csv={d.gaps.map((g) => ({ goal: g.goal, budget_options: g.budget.options, budget_rate: g.budget.rate, mid_options: g.mid.options, mid_rate: g.mid.rate, premium_options: g.premium.options, premium_rate: g.premium.rate, action: g.action }))} tiles={[{ label: 'Goal and price tier with no option', value: String(zeroTiers.length), sub: `of ${d.gaps.length * 3}; ${zeroTiers[0] ?? 'none'}` }, { label: 'Goal and price tier with one option', value: String(thinTiers.length), sub: `of ${d.gaps.length * 3}; ${thinTiers[0] ?? 'none'}` }, { label: 'Goals tracked', value: String(d.gaps.length), sub: 'each with a measured metric' }, { label: 'Most options for one goal', value: String(d.gaps.reduce((a, g) => Math.max(a, g.budget.options + g.mid.options + g.premium.options), 0)), sub: 'catalog products, all price tiers' }]}>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead><tr className="text-left text-text-2"><th className="py-2 pr-3 font-medium">Goal</th><th className="py-2 pr-3 font-medium">Budget</th><th className="py-2 pr-3 font-medium">Mid</th><th className="py-2 pr-3 font-medium">Premium</th><th className="py-2 font-medium">Suggested action</th></tr></thead>
              <tbody>
                {d.gaps.map((g) => (
                  <tr key={g.goal} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{g.goal}</td>
                    {[g.budget, g.mid, g.premium].map((t, i) => (
                      <td key={i} className="py-2 pr-3 font-mono">
                        {t.options} {t.options === 1 ? 'option' : 'options'}{t.rate !== null ? ` · ${Math.round(t.rate * 100)}%` : ''}
                        {t.options < 2 ? <Chip tone="warn" className="ml-1">gap</Chip> : null}
                      </td>
                    ))}
                    <td className="py-2 text-text-2">{g.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Section>
        ) : null}

        {tab === 'Routine conflicts' ? (
          <Section q="How common are routine conflicts, and what resolves them?" csv={d.conflicts.map((c) => ({ ...c, resolves: c.resolves.join('; ') }))} tiles={[{ label: 'Missing morning SPF', value: spf ? `${Math.round(spf.share * 100)}%` : '–', n: routines, sub: 'with a retinoid or acid' }, { label: 'Most common clash', value: topClash ? `${Math.round(topClash.share * 100)}%` : '–', n: routines, sub: topClash?.pair ?? 'none' }, { label: 'Clash types seen', value: String(d.conflicts.length), sub: 'each in 10 or more routines' }, { label: 'Routines checked', value: String(d.cohort.synthetic + d.cohort.real), n: d.cohort.synthetic + d.cohort.real, sub: 'rule table, same as the app' }]}>
            <ul className="space-y-3">
              {d.conflicts.map((c) => (
                <li key={c.pair} className="rounded-(--radius-tile) border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-3 text-[13px]"><span className="font-medium">{c.pair}</span><span className="font-mono text-text-2">{Math.round(c.share * 100)}% of routines</span></div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-surface-2"><span className="block h-full bg-warn" style={{ width: `${c.share * 100}%` }} /></div>
                  <p className="mt-2 text-[13px] text-text-2">Suggested change: {c.fix}.{c.resolves.length ? ` Products that resolve it: ${c.resolves.join(', ')}.` : ''}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {tab === 'About this data' ? (
          <div className="max-w-[36rem] space-y-3 pt-6 text-[15px] leading-relaxed text-text-2">
            <h2 className="text-[20px] font-bold text-text">About this data</h2>
            <p>Every number here is computed live from BigQuery (dataset willow_insights) over a synthetic cohort: {d.cohort.synthetic} simulated people{d.cohort.real ? ` and ${d.cohort.real} real people who opted in` : ', no real customers yet'}. Each has one to three goals, a routine of two to five real catalog products (about 60% also use a sunscreen) and weekly face readings for {d.cohort.weeks} weeks; {Math.round(d.cohort.dropout * 100)}% dropped out early. Fixed seed ({d.cohort.seed}), so the numbers are reproducible.</p>
            <p>Simulated change: each product drifts the metrics its concerns map to towards the desired direction, growing to full size by week 6, between 0.2 and 1.1 times that metric's noise band; about 3 in 10 products have no effect. Every reading adds noise at the spread Willow measures, and a reading counts as a real change only if it clears the noise band, the same rule the app uses. Skin tone and region have no effect in the simulation.</p>
            <p>Outcome: still improved beyond the noise band at the week-8 reading. A single lucky reading earlier does not count. Lift compares product users with people who share the goal but do not use the product. Routine conflicts come from the same rule table as the app's compatibility check.</p>
            <p>Suppression: any group under 10 users is hidden, in the data query and in the api, not only on the chart. Rates are never shown without n. Skin-tone bands are a slice, never a ranking.</p>
            <p>What this is not: evidence that any product works. It is a demonstration of what a multi-brand retailer would see once real, consented outcome data flows in.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const CSV_HEADER: Record<string, string> = {
  product_id: 'Product id',
  product: 'Product',
  brand: 'Brand',
  concern: 'Concern',
  goal: 'Goal',
  n: 'People (n)',
  rate: 'Outcome rate (%)',
  lift: 'Lift vs non-users (points)',
  weeks: 'Median weeks to change',
  cont: 'Still using after week 4 (%)',
  lo: 'Interval low (%)',
  hi: 'Interval high (%)',
  real: 'Real change (%)',
  none: 'No clear change (%)',
  early: 'Too early (%)',
  budget_options: 'Budget options',
  budget_rate: 'Budget outcome rate (%)',
  mid_options: 'Mid options',
  mid_rate: 'Mid outcome rate (%)',
  premium_options: 'Premium options',
  premium_rate: 'Premium outcome rate (%)',
  action: 'Suggested action',
  pair: 'Routine issue',
  share: 'Share of routines (%)',
  fix: 'Suggested change',
  resolves: 'Products that resolve it',
  is_synthetic: 'Synthetic data',
}
const PERCENT_KEYS = new Set(['rate', 'lift', 'cont', 'lo', 'hi', 'share', 'budget_rate', 'mid_rate', 'premium_rate'])

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const keys = [...Object.keys(rows[0]), 'is_synthetic']
  const cols = keys.map((k) => CSV_HEADER[k] ?? k)
  // Shares are fractions in the data; the screen shows percents, and so does the file.
  const cell = (k: string, v: unknown) => (PERCENT_KEYS.has(k) && typeof v === 'number' ? Math.round(v * 100) : v)
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const body = [cols.map(esc).join(','), ...rows.map((r) => keys.map((k) => esc(k === 'is_synthetic' ? true : cell(k, r[k]))).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `willow-${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Section({ q, tiles, csv, children }: { q: string; tiles: { label: string; value: string; n?: number; sub: string }[]; csv: Record<string, unknown>[]; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <h2 className="text-[20px] font-bold tracking-[-0.02em]">{q}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-(--radius-tile) bg-surface p-3">
            <dt className="text-[12px] text-text-2">{t.label}</dt>
            <dd className="mt-1 font-mono text-[22px] font-medium leading-none">{t.value}</dd>
            <dd className="mt-1 line-clamp-3 text-[11px] text-text-3" title={t.sub}>{t.sub}{t.n !== undefined ? ` · n=${t.n}` : ''}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 rounded-(--radius-tile) border border-border bg-surface p-4">{children}</div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-text-2 hover:text-text" onClick={() => downloadCsv(q, csv)}>
          <Download size={14} aria-hidden /> CSV
        </button>
      </div>
    </section>
  )
}

function HeatCell({ c }: { c: Cell }) {
  if (c.suppressed) return <span className="chip-hatch block rounded-(--radius-chip) bg-noise-band px-1 py-1 text-center text-[11px] text-text-3" title="Hidden (under 10 users)">n&lt;10</span>
  const v = c.value ?? 0
  const bg = `oklch(${(0.97 - v * 0.42).toFixed(3)} ${(0.03 + v * 0.1).toFixed(3)} 220)`
  const fg = v > 0.45 ? 'var(--color-surface)' : 'var(--color-text)'
  return <span className="block rounded-(--radius-chip) px-1 py-1 text-center font-mono text-[12px]" style={{ background: bg, color: fg }}>{Math.round(v * 100)}% <span className="opacity-70">n={c.n}</span></span>
}
