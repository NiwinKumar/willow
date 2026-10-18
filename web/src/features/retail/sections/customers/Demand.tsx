import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'

import { csvMeta, csvName, gapTier, monthLabel, TIER_LABEL, TIERS, totalUsers, type Gap, type Insights, type Tier } from '../../data'
import { DataTable, EmptyState, int, MIN_GROUP, Panel, pct, RateCell, ShareBar, useTooltip, type Column } from '../../ui'
import { rateInterval } from '../../ui/insight'
import { goalTrends, type GoalTrend } from './model'

/*
 * Below the fold of Customers: what people want (people per goal, the share with a visible change so far, and
 * the goal's share of each month's people), assortment gaps by price tier, and routine conflicts.
 */

type Need = Insights['needs'][number]

export function WhatPeopleWant({ d, goalId, className = '' }: { d: Insights; goalId: string | null; className?: string }) {
  const trends = goalTrends(d.needs_by_month)
  const rows = [...d.needs].sort((a, b) => b.n - a.n)
  const max = Math.max(1, ...rows.map((r) => r.n))
  const months = d.needs_by_month?.months ?? []
  return (
    <Panel title="What people want" id="demand-h" description="People per goal (up to 5 each), and the share with a visible change so far." className={className}>
      {rows.length === 0 ? (
        <EmptyState compact title="No goal has enough people yet" body={`No goal has ${MIN_GROUP} or more people in this filter.`} />
      ) : (
        <div className="relative -mx-1 overflow-x-auto overscroll-x-contain px-1">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-proof-body">
            <caption className="sr-only">Goals by people, with the share who saw a visible change so far and the trend in each month’s share of people</caption>
            <colgroup>
              <col style={{ width: 132 }} />
              <col />
              <col style={{ width: 116 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr className="text-proof-label text-ink-2">
                <th scope="col" className="pb-2 text-left font-normal">
                  Goal
                </th>
                <th scope="col" className="pb-2 text-left font-normal">
                  People
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="block size-2 rounded-[2px] bg-ink" />
                    Visible change
                  </span>
                </th>
                <th scope="col" className="pb-2 pl-4 text-left font-normal">
                  {months.length > 1 ? `Share of people, ${monthLabel(months[0], true)}–${monthLabel(months.at(-1)!, true)}` : 'Share of people'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <NeedRow key={r.goal} r={r} max={max} trend={r.goal_id ? trends.get(r.goal_id) : undefined} on={goalId !== null && r.goal_id === goalId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function NeedRow({ r, max, trend, on }: { r: Need; max: number; trend?: GoalTrend; on: boolean }) {
  const w = (r.n / max) * 100
  return (
    <tr className={`h-11 border-t border-line ${on ? 'bg-pf-bg2' : ''}`} aria-current={on || undefined}>
      <th scope="row" className={`truncate pr-3 text-left ${on ? 'font-medium' : 'font-normal'} text-ink`}>
        {r.goal}
      </th>
      <td className="pr-3">
        <span className="flex items-center gap-3">
          <span aria-hidden className="relative block h-2.5 rounded-[3px] bg-muted" style={{ width: `${w}%` }}>
            <span className="absolute inset-y-0 left-0 block rounded-[3px] bg-ink" style={{ width: `${r.real}%` }} />
          </span>
          <span className="shrink-0 text-proof-small text-ink tnum">{int(r.n)}</span>
        </span>
      </td>
      <td className="text-right text-proof-small text-ink tnum">{r.real}%</td>
      <td className="pl-4">{trend ? <Trend t={trend} /> : <span className="text-proof-small text-ink-2">—</span>}</td>
    </tr>
  )
}

/** A goal's share of each month's people as a small line, with the last change in points. */
function Trend({ t }: { t: GoalTrend }) {
  const pts = t.shares.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  const words =
    t.delta === null || t.prevMonth === null || t.lastMonth === null
      ? 'Not enough months to compare'
      : `${t.last}% of people with a reading in ${monthLabel(t.lastMonth)} chose it, ${t.dir === 'flat' ? 'the same as' : `${t.dir} from ${t.prev}% in`} ${monthLabel(t.prevMonth)}`
  const tip = useTooltip(words)
  const W = 48
  const H = 18
  const lo = Math.min(...pts.map((p) => p.v))
  const hi = Math.max(...pts.map((p) => p.v))
  const span = Math.max(4, hi - lo)
  const n = t.shares.length
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * (W - 4) + 2)
  const y = (v: number) => H - 2 - ((v - (lo + hi) / 2 + span / 2) / span) * (H - 4)
  const Icon = t.dir === 'up' ? ArrowUpRight : t.dir === 'down' ? ArrowDownRight : ArrowRight
  return (
    <span {...tip.trigger} tabIndex={0} className="inline-flex cursor-help items-center gap-2">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0 overflow-visible">
        {pts.length > 1 ? <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {pts.length ? <circle cx={x(pts.at(-1)!.i)} cy={y(pts.at(-1)!.v)} r={2.25} fill="var(--text-primary)" /> : null}
      </svg>
      {t.delta === null ? (
        <span className="text-proof-label text-ink-2">—</span>
      ) : (
        <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-proof-label tnum ${t.dir === 'up' ? 'text-ink' : 'text-ink-2'}`}>
          <Icon size={13} strokeWidth={1.8} aria-hidden />
          {t.delta > 0 ? '+' : t.delta < 0 ? '−' : '±'}
          {Math.abs(t.delta)} pts
        </span>
      )}
      {tip.node}
    </span>
  )
}

/* ───────────── assortment gaps ───────────── */

type GapRow = { g: Gap; flag: ReturnType<typeof gapTier> }

function TierCell({ r, tier }: { r: GapRow; tier: Tier }) {
  const t = r.g[tier]
  const flagged = r.flag?.tier === tier
  if (t.options === 0)
    return (
      <span className="flex flex-col items-end">
        <span className="text-proof-body font-medium text-pf-amber">No option</span>
        <span className="text-proof-label text-pf-amber">gap</span>
      </span>
    )
  const ci = rateInterval(t.rate, t.n)
  return (
    <span className="flex flex-col items-end">
      <RateCell rate={t.rate} n={t.n} lo={ci?.lo} hi={ci?.hi} showN={false} />
      <span className={`text-proof-label ${flagged ? 'text-pf-amber' : 'text-ink-2'}`}>
        {t.options} {t.options === 1 ? 'option' : 'options'}
        {flagged ? (r.flag!.reason === 'low' ? ' · weakest' : ' · gap') : ''}
      </span>
    </span>
  )
}

export function Gaps({ d }: { d: Insights }) {
  const rows: GapRow[] = d.gaps.map((g) => ({ g, flag: gapTier(g) })).sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)))
  const tierCol = (t: Tier): Column<GapRow> => ({
    id: t,
    header: TIER_LABEL[t],
    headerText: `${TIER_LABEL[t]}: visible change (%)`,
    align: 'right',
    width: '14%',
    sortValue: (r) => r.g[t].rate,
    cell: (r) => <TierCell r={r} tier={t} />,
    csv: (r) => (r.g[t].options === 0 ? 'no option' : r.g[t].rate === null ? 'suppressed' : `${Math.round(r.g[t].rate! * 100)}% (${r.g[t].options} options, n=${r.g[t].n ?? 'suppressed'})`),
  })
  const columns: Column<GapRow>[] = [
    { id: 'goal', header: 'Goal', rowHeader: true, width: '20%', sortValue: (r) => r.g.goal, cell: (r) => <span className="text-ink">{r.g.goal}</span> },
    ...TIERS.map(tierCol),
    {
      id: 'action',
      header: 'What to do',
      width: '38%',
      cell: (r) => <span className={`block truncate pl-4 ${r.flag ? 'text-ink' : 'text-ink-2'}`} title={r.g.action}>{r.g.action}</span>,
      csv: (r) => r.g.action,
    },
  ]
  return (
    <section id="gaps">
      <Panel flush>
        <DataTable
          caption="Assortment gaps by price tier"
          heading={
            <span className="flex flex-col gap-0.5">
              <h2 className="m-0 text-proof-h text-ink">Assortment gaps</h2>
              <span className="text-proof-small text-ink-2">Visible-change rate by week 8 among users of each price tier’s products for the goal.</span>
            </span>
          }
          columns={columns}
          rows={rows}
          rowKey={(r) => r.g.goal}
          csv={{ name: csvName('assortment-gaps', d), meta: csvMeta(d) }}
          minWidth={760}
          empty="No goal has products in the catalogue yet."
        />
      </Panel>
    </section>
  )
}

/* ───────────── routine conflicts ───────────── */

export function Conflicts({ d, className = '' }: { d: Insights; className?: string }) {
  const rows = d.conflicts
  const checked = d.routines_checked ?? totalUsers(d.cohort)
  const max = Math.max(0.01, ...rows.map((c) => c.share))
  return (
    <Panel title="Routine conflicts" id="conflicts-h" description={`Share of the ${int(checked)} routines checked.`} className={className}>
      {rows.length === 0 ? (
        <EmptyState compact title="No common conflicts" body={`No conflict appears in ${MIN_GROUP} or more routines.`} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((c) => (
            <li key={c.pair} className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-proof-body text-ink">{c.pair}</span>
                <span className="shrink-0 text-proof-small text-ink tnum">
                  {pct(c.share)}
                  {c.n ? <span className="text-ink-2"> · {int(c.n)}</span> : null}
                </span>
              </span>
              <ShareBar value={c.share} max={max} />
              <span className="text-proof-small text-ink-2">
                {c.fix}
                {c.resolves.length ? ` · ${c.resolves.length} ${c.resolves.length === 1 ? 'product resolves' : 'products resolve'} it` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
