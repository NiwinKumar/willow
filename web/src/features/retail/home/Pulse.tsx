import { ArrowRight, Megaphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign } from '../../../lib/api'
import { Button, int, Meter, pct, ProofRing, pts, Sparkline, useTooltip } from '../ui'
import { changeText, monthShort, type CampaignTotals, type GoalTrend, type Portfolio } from './dashboard'

/*
 * Home's dashboard band (sections/Home.tsx): four KPI tiles with a small mark each (a meter, the Proof score
 * ring, a delta, a daily sparkline), then two panels that earn their place: what people come for, month by
 * month (goal demand; a brand's own goals lead in leaf), and the campaign funnel (reach → clicks → adds, then the
 * lift against the holdout). Every figure is from the api; tiles open the section behind them.
 *
 * Four tests: each tile answers "how are we doing" on one axis with its comparison (1); the ring and meter are
 * labelled with the figure they draw (2); nothing animates after the first draw (3); kit surfaces, one accent (4).
 */

export type Tile = { id: string; label: string; value: string; unit?: string; note: ReactNode; mark?: ReactNode; to?: string; delta?: { text: string; tone: 'up' | 'down' | 'flat'; title?: string } | null }

export function KpiBand({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-surface xl:grid-cols-4">
      {tiles.map((t, i) => (
        <TileCell key={t.id} t={t} i={i} />
      ))}
    </section>
  )
}

function TileCell({ t, i }: { t: Tile; i: number }) {
  const tip = useTooltip(t.delta?.title ?? '')
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-proof-small text-ink-2">
        <span className="truncate">{t.label}</span>
        {t.to ? <ArrowRight size={14} strokeWidth={1.7} aria-hidden className="shrink-0 -translate-x-1 opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100" /> : null}
      </span>
      <span className="flex min-h-[44px] items-end justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-ink tnum sm:text-proof-kpi">{t.value}</span>
          {t.unit ? <span className="text-proof-small text-ink-2">{t.unit}</span> : null}
          {t.delta ? (
            <>
              <span {...tip.trigger} tabIndex={t.delta.title ? 0 : undefined} className={`ml-1 inline-flex h-5 items-center rounded-pill px-1.5 text-proof-label font-medium tnum ${t.delta.tone === 'up' ? 'bg-proof-leaf-soft text-proof-leaf' : t.delta.tone === 'down' ? 'bg-pf-amber-soft text-pf-amber' : 'bg-sunken text-ink-2'}`}>
                {t.delta.text}
              </span>
              {t.delta.title ? tip.node : null}
            </>
          ) : null}
        </span>
        {t.mark ? <span className="mb-1 hidden shrink-0 sm:block">{t.mark}</span> : null}
      </span>
      <span className="truncate text-proof-small text-ink-2">{t.note}</span>
    </>
  )
  const cls = `group flex min-w-0 flex-col gap-1.5 border-line px-4 py-3.5 text-left no-underline animate-[proofPage_.28s_var(--ease-standard)_both] sm:px-5 sm:py-4 [&:nth-child(odd)]:border-r [&:nth-child(-n+2)]:border-b xl:!border-b-0 xl:[&:not(:last-child)]:border-r`
  const style = { animationDelay: `${i * 40}ms` }
  return t.to ? (
    <Link to={t.to} className={`${cls} transition-colors hover:bg-pf-hover`} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  )
}

/** The tiles' marks, labelled in words. */
export const marks = {
  meter: (v: number | null, label: string) => <Meter value={v} label={label} className="w-20" />,
  ring: (v: number | null, label: string) => <ProofRing value={v} size={40} label={label} center={v === null ? '—' : `${Math.round(v * 100)}%`} />,
  spark: (values: (number | null)[], label: string, tone: 'leaf' | 'ink' = 'leaf') => <Sparkline values={values} label={label} width={88} height={30} tone={tone} />,
}

export const portfolioNote = (p: Portfolio) => [p.collecting ? `${int(p.collecting)} collecting` : null, p.noUsers ? `${int(p.noUsers)} no users yet` : null].filter(Boolean).join(' · ') || 'every product has readings'

/* ───────────── demand by goal ───────────── */

export function DemandPanel({ months, rows, brand, className = '', loading }: { months: string[]; rows: GoalTrend[]; brand: string | null; className?: string; loading?: boolean }) {
  const shown = rows.slice(0, 6)
  const span = months.length ? `${monthShort(months[0])}–${monthShort(months.at(-1)!)}` : ''
  const anyFocus = shown.some((r) => r.focus)
  return (
    <section aria-labelledby="demand-h" className={`flex min-w-0 flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
        <h2 id="demand-h" className="m-0 text-proof-h text-ink">
          What people come for
        </h2>
        <span className="text-proof-small text-ink-2">People with a reading each month{span ? ` · ${span}` : ''}</span>
      </div>
      {loading ? null : !shown.length ? (
        <p className="m-0 px-5 pb-5 text-proof-small text-ink-2">Goal demand appears once a month has 10 people with readings.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 pb-2">
          {shown.map((r, i) => (
            <li key={r.goalId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-t border-line px-5 py-2.5 first:border-t-0 animate-[proofPage_.28s_var(--ease-standard)_both] sm:grid-cols-[minmax(0,1fr)_96px_64px_72px]" style={{ animationDelay: `${i * 30}ms` }}>
              <span className="flex min-w-0 items-center gap-2">
                {anyFocus ? <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${r.focus ? 'bg-proof-leaf' : 'bg-transparent'}`} /> : null}
                <span className={`truncate text-proof-body ${r.focus ? 'font-medium text-ink' : 'text-ink'}`}>{r.goal}</span>
                {r.focus && i === 0 && brand ? <span className="hidden shrink-0 text-proof-label text-ink-2 md:inline">{brand}’s goals</span> : null}
              </span>
              <span className="hidden sm:block">
                <Sparkline values={r.counts} label={`${r.goal}: ${r.counts.map((c, j) => `${monthShort(months[j])} ${c ?? 'fewer than 10'}`).join(', ')}`} width={96} height={24} tone={r.focus ? 'leaf' : 'ink'} area={r.focus} />
              </span>
              <span className="text-right text-proof-body text-ink tnum">{int(r.latest)}</span>
              <span className={`text-right text-proof-small tnum ${r.change !== null && r.change > 0.005 ? 'text-proof-leaf' : 'text-ink-2'}`}>{changeText(r.change)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-auto border-t border-line px-5 py-2.5 text-proof-label text-ink-2">
        {anyFocus ? 'Green: goals your products target. ' : ''}Change is the latest month against the one before.
      </p>
    </section>
  )
}

/* ───────────── campaign funnel ───────────── */

export function FunnelPanel({ t, samples, promoteTo, campaignsTo, className = '', canPromote }: { t: CampaignTotals; samples: number; promoteTo: string; campaignsTo: string; className?: string; canPromote: boolean }) {
  const steps = [
    { id: 'reach', label: 'Reached', value: t.reach, note: 'people shown the card' },
    { id: 'clicks', label: 'Clicked', value: t.clicks, note: 'opened the product' },
    { id: 'adds', label: 'Added', value: t.adds, note: 'added it to a routine' },
  ]
  const top = Math.max(1, t.reach)
  return (
    <section aria-labelledby="funnel-h" className={`flex min-w-0 flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
        <h2 id="funnel-h" className="m-0 text-proof-h text-ink">
          Campaign funnel
        </h2>
        {t.count ? (
          <Link to={campaignsTo} className="text-proof-small text-ink-2 no-underline hover:text-ink">
            {int(t.count)} {t.count === 1 ? 'campaign' : 'campaigns'}
            {t.live ? ` · ${int(t.live)} live` : ''} →
          </Link>
        ) : null}
      </div>
      {!t.count ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 px-5 pb-5 pt-2">
          <span aria-hidden className="grid size-9 place-items-center rounded-ctl bg-sunken text-ink-2">
            <Megaphone size={17} strokeWidth={1.7} />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-proof-body font-medium text-ink">No campaigns yet</span>
            <span className="max-w-[44ch] text-proof-small text-ink-2">Promote a Proven product to the people it works for; a randomised holdout measures the adoption it caused.</span>
          </span>
          {canPromote ? (
            <Button to={promoteTo} size="sm">
              Plan a campaign
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ol className="m-0 flex list-none flex-col gap-3 px-5 pb-4 pt-1">
            {steps.map((s, i) => {
              const w = s.value / top
              const prev = i ? steps[i - 1].value : null
              return (
                <li key={s.id} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-3 text-proof-small">
                    <span className="text-ink">
                      {s.label} <span className="text-ink-2">· {s.note}</span>
                    </span>
                    <span className="whitespace-nowrap text-ink tnum">
                      {int(s.value)}
                      {prev ? <span className="text-ink-2"> · {pct(s.value / prev)}</span> : null}
                    </span>
                  </span>
                  <span className="block h-2 overflow-hidden rounded-pill bg-sunken">
                    <span className="block h-full origin-left rounded-pill animate-[wGrowX_.6s_var(--ease-standard)_both]" style={{ width: `${Math.max(w * 100, s.value ? 1.5 : 0)}%`, background: i === steps.length - 1 ? 'var(--proof-leaf)' : 'var(--text-secondary)', animationDelay: `${i * 80}ms`, opacity: i === steps.length - 1 ? 1 : 0.55 }} />
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line px-5 py-3">
            {t.best ? (
              <>
                <span className="text-proof-small text-ink-2">
                  Best lift vs holdout · <span className="text-ink">{t.best.product}</span>
                </span>
                <span className={`text-proof-body font-semibold tnum ${t.best.lo > 0 ? 'text-proof-leaf' : 'text-ink'}`} title={`95% interval ${pts(t.best.lo)} to ${pts(t.best.hi)} · n=${int(t.best.n)}`}>
                  {pts(t.best.lift)} <span className="text-proof-label font-normal text-ink-2">({pts(t.best.lo).replace(' pts', '')} to {pts(t.best.hi)})</span>
                </span>
              </>
            ) : (
              <span className="text-proof-small text-ink-2">Lift appears once both the exposed group and the holdout reach 10 people.</span>
            )}
          </div>
          {samples ? <p className="m-0 border-t border-line bg-pf-bg2 px-5 py-2 text-proof-label text-ink-2">Includes {int(samples)} sample {samples === 1 ? 'campaign' : 'campaigns'}: simulated history for the demo.</p> : null}
        </>
      )}
    </section>
  )
}

/** Campaigns a viewer counts on Home: a brand's own, the retailer's all. */
export const campaignsFor = (list: Campaign[], brand: string | null) => (brand ? list.filter((c) => c.brand === brand) : list)
