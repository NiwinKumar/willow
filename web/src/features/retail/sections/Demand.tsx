import { Download } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { csvMeta, csvName, gapTier, monthLabel, TIER_LABEL, TIERS, totalUsers, type Gap, type Insights, type Tier } from '../data'
import { DataTable, EmptyState, Heatmap, int, MIN_GROUP, Panel, pct, SectionHeader, SimBadge, SkeletonHeader, SkeletonPanel, Term, ToolButton, weeks, type Column } from '../ui'
import { downloadCsv } from '../ui/format'
import { InsightsGate, useWorkspaceLabel } from './shared'

/*
 * Demand (/retail/demand): what customers are trying to change. Goal demand by month (the existing radial,
 * re-laid as a heat table), outcomes by goal, assortment gaps by price tier, and routine conflicts as
 * education and cross-sell openings. TODO(slice D): unmet needs by skin profile (GET /v1/retailer/segments).
 */
export default function Demand() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-4">
          <SkeletonHeader />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <SkeletonPanel height={300} className="xl:col-span-6" />
            <SkeletonPanel height={300} className="xl:col-span-6" />
          </div>
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Body({ d }: { d: Insights }) {
  const eyebrow = useWorkspaceLabel()
  const { hash } = useLocation()
  // #conflicts and #gaps links from the Overview land on their panel.
  useEffect(() => {
    if (hash) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }))
  }, [hash])
  const nbm = d.needs_by_month
  const months = nbm?.months ?? []
  const last = months.length - 1
  // Fastest-rising goal: the largest increase in people from the previous month to the latest (both shown).
  const rising =
    nbm && last > 0
      ? nbm.goals
          .filter((g) => g.counts[last] !== null && g.counts[last - 1] !== null)
          .map((g) => ({ g, delta: g.counts[last]! - g.counts[last - 1]! }))
          .sort((a, b) => b.delta - a.delta)[0]
      : undefined
  const top = d.needs[0]
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={eyebrow}
        title="Demand"
        answer={
          <>
            {top ? (
              <>
                <strong>{top.goal}</strong> is the most-chosen goal ({int(top.n)} people).{' '}
              </>
            ) : null}
            {rising && rising.delta > 0 ? (
              <>
                <strong>{rising.g.goal}</strong> grew most, from {int(rising.g.counts[last - 1])} people in {monthLabel(months[last - 1])} to {int(rising.g.counts[last])} in {monthLabel(months[last])}.
              </>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <MonthsPanel d={d} className="xl:col-span-6" />
        <OutcomesByGoal d={d} className="xl:col-span-6" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <GapsPanel d={d} className="xl:col-span-7" />
        <ConflictsPanel d={d} className="xl:col-span-5" />
      </div>
    </div>
  )
}

function MonthsPanel({ d, className }: { d: Insights; className?: string }) {
  const nbm = d.needs_by_month
  const months = nbm?.months ?? []
  const goals = (nbm?.goals ?? []).filter((g) => g.counts.some((c) => c !== null))
  const csv = () =>
    downloadCsv(
      csvName('goal-demand-by-month', d),
      csvMeta(d),
      ['goal', ...months.flatMap((m) => [`${m}_people`, `${m}_pct_of_peak`])],
      goals.map((g) => [g.goal, ...months.flatMap((_, i) => [g.counts[i] ?? 'suppressed', g.share_of_peak[i] === null ? 'suppressed' : Math.round(g.share_of_peak[i]! * 100)])]),
    )
  return (
    <Panel
      title="Goal demand by month"
      id="months-h"
      meta={<SimBadge cohort={d.cohort} />}
      actions={<ToolButton onClick={csv} label="Export goal demand by month as CSV"><Download size={14} strokeWidth={1.6} aria-hidden />Export CSV</ToolButton>}
      className={className}
      footnote={`People choosing each goal among those with a reading that month (up to 3 goals each). Shade: share of that month’s most-chosen goal. Dryness can’t be measured, so it isn’t a goal. Months with fewer than ${MIN_GROUP} people for a goal are hidden.`}
    >
      {goals.length === 0 ? (
        <EmptyState compact title="No month has enough people yet" body={`No goal has ${MIN_GROUP} or more people in a month in this filter.`} />
      ) : (
        <Heatmap
          caption="Goal demand by month: people per goal, shaded by share of the month's most-chosen goal"
          rows={goals.map((g) => ({ id: g.goal_id, label: g.goal, g }))}
          cols={months.map((m, i) => ({ id: m, label: monthLabel(m), i }))}
          corner="Goal"
          cell={(r, c) => {
            const v = r.g.share_of_peak[c.i]
            const n = r.g.counts[c.i]
            return { value: v, text: n === null ? '—' : int(n), sub: v === null ? undefined : `${pct(v)} of peak` }
          }}
          minWidth={460}
        />
      )}
    </Panel>
  )
}

type Need = Insights['needs'][number]

function OutcomesByGoal({ d, className }: { d: Insights; className?: string }) {
  const columns: Column<Need>[] = [
    { id: 'goal', header: 'Goal', rowHeader: true, sortValue: (r) => r.goal, cell: (r) => <span className="block truncate text-ink">{r.goal}</span> },
    { id: 'n', header: 'People', align: 'right', width: '76px', sortValue: (r) => r.n, cell: (r) => <span className="font-mono tnum">{int(r.n)}</span> },
    { id: 'real', header: <Term id="real_change">Real change</Term>, headerText: 'Real change (%)', align: 'right', width: '112px', sortValue: (r) => r.real, cell: (r) => <span className="font-mono tnum">{r.real}%</span> },
    { id: 'early', header: 'Too early', headerText: 'Too early (%)', align: 'right', width: '92px', sortValue: (r) => r.early, cell: (r) => <span className="font-mono tnum text-ink-2">{r.early}%</span> },
    { id: 'weeks', header: 'Median', headerText: 'Median weeks to change', align: 'right', width: '80px', sortValue: (r) => r.weeks ?? null, firstDir: 'asc', cell: (r) => <span className="font-mono tnum">{weeks(r.weeks)}</span>, csv: (r) => r.weeks ?? 'suppressed' },
  ]
  return (
    <Panel
      className={className}
      flush
      footnote={`Of everyone with the goal: a real change by week ${d.cohort.weeks}, or still too early (under ${d.cohort.weeks} weeks of readings). Median weeks among those who changed; hidden under ${MIN_GROUP}.`}
    >
      <DataTable heading={<><h2 className="m-0 text-proof-h font-medium text-ink">Outcomes by goal</h2><SimBadge cohort={d.cohort} /></>} caption="Outcomes by goal" columns={columns} rows={d.needs} rowKey={(r) => r.goal} defaultSort={{ id: 'n', dir: 'desc' }} csv={{ name: csvName('outcomes-by-goal', d), meta: csvMeta(d) }} minWidth={480} />
    </Panel>
  )
}

const REASON: Record<'missing' | 'low' | 'thin', string> = { missing: 'no option', low: 'low everywhere', thin: 'one option' }

function GapsPanel({ d, className }: { d: Insights; className?: string }) {
  const flagged = d.gaps.map((g) => ({ g, flag: gapTier(g) }))
  const shown = flagged.filter((f) => f.flag)
  const largest = shown
    .map((f) => ({ ...f, t: f.g[f.flag!.tier] }))
    .filter((f) => f.t.rate !== null && f.t.n)
    .sort((a, b) => (1 - b.t.rate!) * (b.t.n ?? 0) - (1 - a.t.rate!) * (a.t.n ?? 0))[0]
  const csv = () =>
    downloadCsv(
      csvName('assortment-gaps', d),
      csvMeta(d),
      ['goal', ...TIERS.flatMap((t) => [`${t}_options`, `${t}_users`, `${t}_real_change_pct`]), 'flagged_tier', 'suggested_action'],
      d.gaps.map((g) => {
        const t = gapTier(g)
        return [g.goal, ...TIERS.flatMap((tier) => [g[tier].options, g[tier].n ?? (g[tier].options ? 'suppressed' : 0), g[tier].rate === null ? (g[tier].options ? 'suppressed' : '') : Math.round(g[tier].rate! * 100)]), t ? t.tier : '', g.action]
      }),
    )
  return (
    <Panel
      title="Assortment gaps by price tier"
      id="gaps"
      meta={<SimBadge cohort={d.cohort} />}
      actions={<ToolButton onClick={csv} label="Export assortment gaps as CSV"><Download size={14} strokeWidth={1.6} aria-hidden />Export CSV</ToolButton>}
      className={className}
      footnote={`Shade: real-change rate by week ${d.cohort.weeks} among users of that tier’s products for the goal. ◇ marks the gap: a tier with no option, the weakest tier when every tier is under 35%, or a tier with one option.`}
    >
      <div className="flex flex-col gap-3">
        {largest ? (
          <p className="m-0 text-proof-body text-ink-2">
            Largest gap: <strong className="font-normal text-ink">{TIER_LABEL[largest.flag!.tier].toLowerCase()} {largest.g.goal.toLowerCase()}</strong>, where {pct(1 - largest.t.rate!)} of {int(largest.t.n)} users have no real change yet.
          </p>
        ) : null}
        <Heatmap<{ id: string; label: string; g: Gap; flag: ReturnType<typeof gapTier> }, { id: Tier; label: string }>
          caption="Assortment by goal and price tier: real-change rate, options and users"
          tone="signal"
          corner="Goal"
          rows={flagged.map((f) => ({ id: f.g.goal, label: f.g.goal, g: f.g, flag: f.flag }))}
          cols={TIERS.map((t) => ({ id: t, label: TIER_LABEL[t] }))}
          cell={(r, c) => {
            const t = r.g[c.id]
            const flag = r.flag?.tier === c.id ? REASON[r.flag.reason] : undefined
            if (t.options === 0) return { value: 0, text: 'No option', sub: '0 products', flag }
            return { value: t.rate, text: pct(t.rate), sub: `${t.options} ${t.options === 1 ? 'option' : 'options'}${t.n ? ` · ${int(t.n)} users` : ''}`, flag }
          }}
          minWidth={520}
        />
        {shown.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 border-t border-line p-0 pt-3">
            {shown.map((f) => (
              <li key={f.g.goal} className="text-proof-body">
                <span className="text-ink">{f.g.goal}</span>
                <span className="text-ink-2"> · {TIER_LABEL[f.flag!.tier]}: {f.g.action}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-proof-small text-ink-2">Every goal has two or more options in each tier, and at least one tier at 35% or more.</p>
        )}
      </div>
    </Panel>
  )
}

function ConflictsPanel({ d, className }: { d: Insights; className?: string }) {
  const rows = d.conflicts
  const checked = d.routines_checked ?? totalUsers(d.cohort)
  const max = Math.max(0.01, ...rows.map((c) => c.share))
  const csv = () =>
    downloadCsv(
      csvName('routine-conflicts', d),
      csvMeta(d),
      ['finding', 'routines_with_it', 'routines_checked', 'share_of_routines_pct', 'suggested_change', 'products_that_resolve_it'],
      rows.map((c) => [c.pair, c.n ?? '', checked, Math.round(c.share * 100), c.fix, c.resolves.join('; ')]),
    )
  return (
    <Panel
      title="Routine conflicts"
      id="conflicts"
      meta={<SimBadge cohort={d.cohort} />}
      actions={<ToolButton onClick={csv} label="Export routine conflicts as CSV"><Download size={14} strokeWidth={1.6} aria-hidden />Export CSV</ToolButton>}
      className={className}
      footnote={`Share of the ${int(checked)} routines checked with each finding, from the app’s fixed rule table (AI suggestions excluded). Findings in fewer than ${MIN_GROUP} routines are hidden.`}
    >
      {rows.length === 0 ? (
        <EmptyState compact title="No common findings" body={`No finding appears in ${MIN_GROUP} or more routines.`} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((c) => (
            <li key={c.pair} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-proof-body text-ink">{c.pair}</span>
                <span className="whitespace-nowrap font-mono text-proof-small tnum">
                  {pct(c.share)}
                  {c.n ? <span className="text-ink-2"> · {int(c.n)}</span> : null}
                </span>
              </span>
              <span aria-hidden className="block h-1.5 rounded-pill bg-muted">
                <span className="block h-full rounded-pill bg-ink/70" style={{ width: `${(c.share / max) * 100}%` }} />
              </span>
              <span className="text-proof-small text-ink-2">
                {c.fix}.{c.resolves.length ? ` Resolved by ${c.resolves.length === 1 ? c.resolves[0] : `${c.resolves.length} catalogue products`}.` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
