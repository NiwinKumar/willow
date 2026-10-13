import { Download } from 'lucide-react'
import { useState } from 'react'

import { Chip } from '../components/Chip'
import { RETAILER, TONE_BANDS, type Cell } from '../mock/retailer'

const TABS = ['Needs next', 'Product outcomes', 'Brand & category', 'Assortment gaps', 'Routine conflicts', 'About this data'] as const

export function Retailer() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Product outcomes')
  const [window_, setWindow] = useState<'4' | '8'>('8')
  return (
    <div className="pb-20">
      <div role="status" className="bg-warn/18 px-5 py-2 text-[13px] text-warn-text sm:px-8">
        <strong className="font-semibold">Synthetic demo cohort + team data</strong> · {RETAILER.cohort.synthetic} simulated users and {RETAILER.cohort.real} real users · simulated outcomes follow Willow's measured noise model ·{' '}
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setTab('About this data')}>About this data</button>
      </div>
      <div className="mx-auto w-full max-w-[1120px] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Willow Retailer</h1>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <label className="flex items-center gap-1">Window <select value={window_} onChange={(e) => setWindow(e.target.value as '4' | '8')} className="rounded-(--radius-control) border border-border bg-surface px-2 py-1"><option value="4">4 weeks</option><option value="8">8 weeks</option></select></label>
            <label className="flex items-center gap-1">Region <select className="rounded-(--radius-control) border border-border bg-surface px-2 py-1"><option>All</option><option>IN</option><option>US</option><option>UK</option><option>KR</option></select></label>
            <label className="flex items-center gap-1">Tier <select className="rounded-(--radius-control) border border-border bg-surface px-2 py-1"><option>All</option><option>budget</option><option>mid</option><option>premium</option></select></label>
          </div>
        </div>
        <nav className="-mx-5 mt-4 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label="Retailer views">
          <ul className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${tab === t ? 'border-text font-semibold' : 'border-transparent text-text-2 hover:text-text'}`}>{t}</button>
              </li>
            ))}
          </ul>
        </nav>

        {tab === 'Needs next' ? (
          <Section q="What do customers need next?" tiles={RETAILER.tiles}>
            <ul className="space-y-3">
              {RETAILER.needs.map((r) => (
                <li key={r.goal}>
                  <div className="flex justify-between text-[13px]"><span className="font-medium">{r.goal}</span><span className="font-mono text-text-2">n={r.n}</span></div>
                  <div className="mt-1 flex h-6 w-full overflow-hidden rounded-(--radius-chip)" role="img" aria-label={`${r.goal}: ${r.real}% real change, ${r.none}% no clear change, ${r.early}% too early`}>
                    <span style={{ width: `${r.real}%` }} className="bg-signal-500" />
                    <span style={{ width: `${r.none}%` }} className="chip-hatch bg-noise-band" />
                    <span style={{ width: `${r.early}%` }} className="bg-surface-2" />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-text-3">Blue: real change in the target metric by week {window_}. Hatched: no clear change. Grey: too early.</p>
          </Section>
        ) : null}

        {tab === 'Product outcomes' ? (
          <Section q="Which products actually help which profiles?" tiles={[{ label: 'Products with evidence', value: '5', n: 5, sub: 'n ≥ 10 in at least one band' }, { label: 'Best outcome rate', value: '61%', n: 24, sub: 'Azelaic acid, very light band' }, { label: 'Median weeks to change', value: '5', n: 264, sub: 'across products' }]}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-text-2">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Concern</th>
                    {TONE_BANDS.map((b) => <th key={b} className="py-2 pr-2 font-medium">{b}</th>)}
                    <th className="py-2 pr-2 font-medium">Lift vs non-users</th>
                    <th className="py-2 font-medium">Weeks · continuation</th>
                  </tr>
                </thead>
                <tbody>
                  {RETAILER.products.map((p) => (
                    <tr key={p.product} className="border-t border-border">
                      <td className="py-2 pr-3"><span className="font-medium">{p.product}</span><span className="block text-text-3">{p.brand}</span></td>
                      <td className="py-2 pr-3 text-text-2">{p.concern}</td>
                      {p.cells.map((c, i) => <td key={i} className="py-1 pr-2"><HeatCell c={c} /></td>)}
                      <td className="py-2 pr-2 font-mono">+{Math.round(p.lift * 100)} pts</td>
                      <td className="py-2 font-mono">{p.weeks} · {Math.round(p.cont * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-text-3">Cell = share of users with a real change in the target metric by week {window_}, with n. Hatched cells have fewer than 10 users and are hidden.</p>
          </Section>
        ) : null}

        {tab === 'Brand & category' ? (
          <Section q="How are our brands and categories performing on measured outcomes?" tiles={[{ label: 'Brands with evidence', value: '5', n: 5, sub: 'n ≥ 10' }, { label: 'Top category', value: 'Treatment', n: 173, sub: '55% outcome rate' }, { label: 'Continuation 4 wks', value: '71%', n: 441, sub: 'still using at week 4' }]}>
            <ul className="space-y-3">
              {RETAILER.brands.map((b) => (
                <li key={b.brand} className="grid grid-cols-[120px_1fr_60px] items-center gap-3 text-[13px]">
                  <span className="font-medium">{b.brand}</span>
                  <div className="relative h-6" role="img" aria-label={`${b.brand}: outcome rate ${Math.round(b.rate * 100)}%, interval ${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}, n=${b.n}`}>
                    <span className="absolute inset-y-0 left-0 right-0 top-1/2 h-px bg-border" />
                    <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-noise-band" style={{ left: `${b.lo * 100}%`, width: `${(b.hi - b.lo) * 100}%` }} />
                    <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-500 ring-2 ring-surface" style={{ left: `${b.rate * 100}%` }} />
                  </div>
                  <span className="font-mono text-text-2">{Math.round(b.rate * 100)}% · n={b.n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-text-3">Dot: outcome rate at week {window_}. Band: 95% Wilson interval. Continuation is the repeat-purchase analogue.</p>
          </Section>
        ) : null}

        {tab === 'Assortment gaps' ? (
          <Section q="Where are the assortment gaps?" tiles={[{ label: 'Goal × tier combos with no option', value: '1', n: 9, sub: 'dark spots, premium' }, { label: 'Combos below median outcome', value: '3', n: 9, sub: 'texture & pores in every tier' }, { label: 'Largest gap', value: 'Dark spots, premium', n: 189, sub: '44% of users want it' }]}>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="text-left text-text-2"><th className="py-2 pr-3 font-medium">Goal</th><th className="py-2 pr-3 font-medium">Budget</th><th className="py-2 pr-3 font-medium">Mid</th><th className="py-2 pr-3 font-medium">Premium</th><th className="py-2 font-medium">Suggested action</th></tr></thead>
              <tbody>
                {RETAILER.gaps.map((g) => (
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
          </Section>
        ) : null}

        {tab === 'Routine conflicts' ? (
          <Section q="How common are routine conflicts, and what resolves them?" tiles={[{ label: 'Routines with a caution', value: '18%', n: 427, sub: 'retinoid + acid same night' }, { label: 'Missing SPF', value: '27%', n: 427, sub: 'with a retinoid or acid' }, { label: 'Most common pair', value: 'Retinoid + BHA', n: 77, sub: 'alternate nights resolves it' }]}>
            <ul className="space-y-3">
              {RETAILER.conflicts.map((c) => (
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
            <p>This view mixes a synthetic cohort with the team's real sessions. The synthetic cohort has {RETAILER.cohort.synthetic} simulated users across six regions and all six skin-tone bands, each with one to three goals and a routine of two to five catalog products, weekly sessions for {RETAILER.cohort.weeks} weeks and {Math.round(RETAILER.cohort.dropout * 100)}% dropout. The generator uses a fixed seed ({RETAILER.cohort.seed}).</p>
            <p>Each simulated weekly change is a product effect (only on the metrics mapped to the product's concerns; some products are set to about zero) plus noise drawn from Willow's measured noise bands. A simulated reading counts as real change only if it clears the band, the same rule the app uses.</p>
            <p>Suppression: any group under 10 users is hidden, in the data query and in the api, not only on the chart. Rates are never shown without n. Skin-tone bands are a slice, never a ranking.</p>
            <p>What this is not: evidence that any product works. It is a demonstration of what a multi-brand retailer would see once real, consented outcome data flows in.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Section({ q, tiles, children }: { q: string; tiles: { label: string; value: string; n: number; sub: string }[]; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <h2 className="text-[20px] font-bold tracking-[-0.02em]">{q}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-(--radius-tile) bg-surface p-3">
            <dt className="text-[12px] text-text-2">{t.label}</dt>
            <dd className="mt-1 font-mono text-[22px] font-medium leading-none">{t.value}</dd>
            <dd className="mt-1 text-[11px] text-text-3">{t.sub} · n={t.n}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 rounded-(--radius-tile) border border-border bg-surface p-4">{children}</div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="inline-flex min-h-9 items-center gap-1 text-[13px] text-text-2 hover:text-text" onClick={() => alert('CSV export connects to the api in M4; rows will carry a synthetic flag.')}>
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
