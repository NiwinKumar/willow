import { ArrowRight, Download } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ProductImage } from '../../../components/willow/ProductImage'
import { useRetailData } from '../context'
import { csvMeta, csvName } from '../data'
import { sectionPath, useRetailState } from '../state'
import type { Insights, Products, Segments } from '../types'
import { DataTable, EmptyState, ErrorState, EvidenceBar, Heatmap, int, LiftValue, MIN_GROUP, Panel, pct, SectionHeader, SidePanel, SimBadge, SkeletonHeader, SkeletonPanel, Suppressed, Tabs, Term, ToolButton, type Column, type HeatCell } from '../ui'
import { downloadCsv } from '../ui/format'
import { rateInterval, strongestWinner, topUnmet } from '../ui/insight'
import { retailerProducts } from '../../../lib/api'
import { useSegments, useView } from '../useView'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Skin profiles (/retail/segments) on GET /v1/retailer/segments: which skin type × goal groups are
 * under-served (share with no real change by week 8) and which product serves each one best. URL keys:
 * `skin` (the per-skin-type tab), `cell` ("oily.lines", the side panel). Every group under 10 people is
 * suppressed by the api; the screen only says so.
 */

type Cell = Segments['cells'][number]
type Choice = NonNullable<Cell['best']>
type SkinRow = Segments['by_skin'][number]
type TopProduct = SkinRow['top_products'][number]

export default function SkinProfiles() {
  return (
    <InsightsGate skeleton={<Skeleton />}>
      {(d) => <Loader d={d} />}
    </InsightsGate>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SkeletonHeader />
      <SkeletonPanel height={300} />
      <SkeletonPanel height={260} />
    </div>
  )
}

function Loader({ d }: { d: Insights }) {
  const seg = useSegments()
  if (seg.status === 'loading')
    return (
      <div role="status" aria-label="Loading skin profiles" aria-busy="true">
        <Skeleton />
      </div>
    )
  if (seg.status === 'failed') return <ErrorState title="Skin profiles couldn’t load" body="The skin-profile aggregates didn’t answer. No partial numbers are shown." onRetry={seg.retry} />
  return <Body s={seg.data} d={d} />
}

const cellKey = (c: Pick<Cell, 'skin' | 'goal'>) => `${c.skin}.${c.goal}`

function Body({ s, d }: { s: Segments; d: Insights }) {
  const eyebrow = useWorkspaceLabel()
  const { param, setParam } = useRetailState()
  const skinLabel = new Map(s.skin_types.map((x) => [x.id, x.label]))
  const goalLabel = new Map(s.goals.map((x) => [x.id, x.label]))
  const worst = topUnmet(s, 1)[0]
  const win = strongestWinner(s)
  const open = param('cell')
  const selected = open ? (s.cells.find((c) => cellKey(c) === open) ?? null) : null
  const anyShown = s.cells.some((c) => c.users !== null)
  // Packshots for the side panel's picks, from the catalogue's image links (products view, top products).
  const { filters } = useRetailData()
  const catalog = useView<Products>(`products|${filters.cohort}|${filters.range}`, () => retailerProducts(filters))
  const images = new Map<string, string | null>([...(catalog.data?.products ?? []).map((p) => [p.product_id, p.image_url] as const), ...s.by_skin.flatMap((b) => b.top_products.map((p) => [p.product_id, p.image_url] as const))])

  const answer = anyShown ? (
    <>
      {worst ? (
        <>
          Most under-served: <strong>{worst.skinLabel.toLowerCase()} skin with {worst.goalLabel.toLowerCase()}</strong>, where {pct(worst.unmet)} of people at week {d.cohort.weeks} have no <Term id="real_change">real change</Term> yet ({int(worst.users)} chose the goal).{' '}
        </>
      ) : null}
      {win ? (
        <>
          Strongest match: <strong>{win.best.product}</strong> ({win.best.brand}) for {win.goalLabel.toLowerCase()} on {win.skinLabel.toLowerCase()} skin, {pct(win.best.rate)} of {int(win.best.n)} users.
        </>
      ) : null}
    </>
  ) : (
    `No skin type and goal has ${MIN_GROUP} or more people in this filter.`
  )

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title="Skin profiles" answer={answer} />
      <Matrix s={s} d={d} openKey={open} onOpen={(c) => setParam({ cell: cellKey(c) }, { push: true })} />
      <BySkin s={s} d={d} onOpenCell={(skin, goal) => setParam({ cell: `${skin}.${goal}` }, { push: true })} />
      <CellPanel images={images} cell={selected} skin={selected ? (skinLabel.get(selected.skin) ?? selected.skin) : ''} goal={selected ? (goalLabel.get(selected.goal) ?? selected.goal) : ''} d={d} onClose={() => setParam({ cell: null })} onSkin={(id) => setParam({ skin: id, cell: null })} />
    </div>
  )
}

/* ───────────────────────────── the matrix ───────────────────────────── */

function pickLine(p: Choice | null) {
  return p ? `${p.product} (${p.brand}) ${pct(p.rate)}, n=${int(p.n)}` : null
}

function Matrix({ s, d, openKey, onOpen }: { s: Segments; d: Insights; openKey: string | null; onOpen: (c: Cell) => void }) {
  const byKey = new Map(s.cells.map((c) => [cellKey(c), c]))
  const rows = s.skin_types.map((t) => ({
    id: t.id,
    label: (
      <span className="flex flex-col">
        <span>{t.label}</span>
        <span className="font-mono text-[11px] text-ink-2 tnum">{t.users === null ? `n<${MIN_GROUP}` : `${int(t.users)} people`}</span>
      </span>
    ),
    name: t.label,
  }))
  const cols = s.goals.map((g) => ({ id: g.id, label: <span className="block min-w-[72px] whitespace-normal leading-tight">{g.label}</span>, name: g.label }))
  const csv = () =>
    downloadCsv(
      csvName('skin-profiles-matrix', d),
      csvMeta(s),
      ['skin_type', 'goal', 'people_with_goal', 'no_real_change_pct', 'best_product', 'best_brand', 'best_real_change_pct', 'best_n', 'runner_up_product', 'runner_up_brand', 'runner_up_real_change_pct', 'runner_up_n'],
      s.cells.map((c) => [
        c.skin,
        c.goal,
        c.users ?? 'suppressed',
        c.unmet === null ? 'suppressed' : Math.round(c.unmet * 100),
        c.best?.product ?? '',
        c.best?.brand ?? '',
        c.best ? Math.round(c.best.rate * 100) : '',
        c.best?.n ?? '',
        c.runner_up?.product ?? '',
        c.runner_up?.brand ?? '',
        c.runner_up ? Math.round(c.runner_up.rate * 100) : '',
        c.runner_up?.n ?? '',
      ]),
    )
  return (
    <Panel
      title="Skin type × goal: share with no real change yet"
      id="matrix-h"
      meta={<SimBadge cohort={s.cohort} />}
      actions={
        <ToolButton onClick={csv} label="Export the skin type by goal matrix as CSV">
          <Download size={14} strokeWidth={1.6} aria-hidden />
          Export CSV
        </ToolButton>
      }
      footnote={
        <>
          Figure and shade: share of people with the goal and {d.cohort.weeks} weeks of readings who have no <Term id="real_change">real change</Term> in its metrics yet; below it, everyone who chose the goal. Hover or focus a cell for its best measured product; select it for the runner-up. <Term id="suppression">Groups under {MIN_GROUP}</Term> are hidden in the api.
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Heatmap
          caption="Skin type by goal: share of people with no real change yet, and people who chose the goal"
          rows={rows}
          cols={cols}
          corner="Skin type"
          minWidth={780}
          onCell={(r, c) => {
            const cell = byKey.get(`${r.id}.${c.id}`)
            if (cell && cell.users !== null) onOpen(cell)
          }}
          cell={(r, c): HeatCell | null => {
            const cell = byKey.get(`${r.id}.${c.id}`)
            if (!cell) return null
            const where = `${r.name} skin, ${c.name}`
            if (cell.users === null) return { value: null, text: '' }
            const best = pickLine(cell.best)
            const runner = pickLine(cell.runner_up)
            const tip = (
              <span className="flex flex-col gap-0.5">
                <span className="text-ink-2">{where}</span>
                {best ? <span>Best: {best}</span> : <span>No product has {MIN_GROUP}+ users with this skin type for this goal.</span>}
                {runner ? <span className="text-ink-2">Runner-up: {runner}</span> : null}
              </span>
            )
            const selected = openKey === cellKey(cell)
            if (cell.unmet === null)
              return { value: 0, text: '—', sub: `${int(cell.users)} people`, tip, selected, label: `${where}: ${int(cell.users)} people; fewer than ${MIN_GROUP} at week ${d.cohort.weeks}, so no unmet share. Open details` }
            return {
              value: cell.unmet,
              text: pct(cell.unmet),
              sub: `${int(cell.users)} people`,
              tip,
              selected,
              label: `${where}: ${pct(cell.unmet)} with no real change yet, ${int(cell.users)} people. Open details`,
            }
          }}
        />
        <Legend />
      </div>
    </Panel>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-proof-small text-ink-2" aria-hidden>
      <span className="flex items-center gap-2">
        No real change yet
        <span className="font-mono text-[11px] tnum">0%</span>
        <span className="block h-2.5 w-28 rounded-[3px]" style={{ background: 'linear-gradient(90deg, var(--bg-sunken), color-mix(in srgb, var(--text-primary) 32%, var(--bg-sunken)))' }} />
        <span className="font-mono text-[11px] tnum">100%</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="retail-hatch block h-2.5 w-6 rounded-[3px]" />
        Fewer than {MIN_GROUP} people
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-ink">—</span>
        Under {MIN_GROUP} at week 8 yet
      </span>
    </div>
  )
}

/* ───────────────────────────── per skin type ───────────────────────────── */

function BySkin({ s, d, onOpenCell }: { s: Segments; d: Insights; onOpenCell: (skin: string, goal: string) => void }) {
  const { param, setParam, carry } = useRetailState()
  const { workspace } = useRetailData()
  const navigate = useNavigate()
  const mine = workspace.kind === 'brand' ? workspace.brand : null
  const first = s.by_skin.find((b) => b.users !== null)?.skin ?? s.by_skin[0]?.skin
  const tab = s.by_skin.find((b) => b.skin === param('skin'))?.skin ?? first
  const row = s.by_skin.find((b) => b.skin === tab)
  if (!row) return null
  const maxShare = Math.max(0.01, ...row.top_goals.map((g) => g.share))

  const columns: Column<TopProduct>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      sortValue: (r) => r.product,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5" title={`${r.product} · ${r.brand}`}>
          <ProductImage product={{ image_url: r.image_url, category: '', name: r.product }} size={26} decorative />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink">{r.product}</span>
            <span className="truncate text-proof-small text-ink-2">
              {r.brand}
              {mine === r.brand ? <YoursTag /> : null}
            </span>
          </span>
        </span>
      ),
      headerText: 'Product (brand)',
      csv: (r) => `${r.product} (${r.brand})`,
    },
    {
      id: 'rate',
      header: <Term id="real_change">Real change</Term>,
      headerText: 'Real change (%)',
      width: '36%',
      sortValue: (r) => r.rate,
      firstDir: 'desc',
      cell: (r) => {
        const ci = rateInterval(r.rate, r.n)
        return (
          <span className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right font-mono tnum">{pct(r.rate)}</span>
            <EvidenceBar rate={r.rate} lo={ci?.lo} hi={ci?.hi} base={r.lift === null ? null : Math.max(0, r.rate - r.lift)} n={r.n} showN={false} className="min-w-0 flex-1" />
          </span>
        )
      },
      csv: (r) => Math.round(r.rate * 100),
    },
    { id: 'lift', header: <Term id="lift">Lift</Term>, headerText: 'Lift vs non-users with this skin type (pts)', align: 'right', width: '84px', sortValue: (r) => r.lift, cell: (r) => <LiftValue lift={r.lift} />, csv: (r) => (r.lift === null ? 'suppressed' : Math.round(r.lift * 100)) },
    { id: 'n', header: 'n', headerText: 'Users at week 8 (n)', align: 'right', width: '64px', sortValue: (r) => r.n, cell: (r) => <span className="font-mono tnum">{int(r.n)}</span> },
  ]

  return (
    <Panel title="By skin type" id="by-skin-h" meta={<SimBadge cohort={s.cohort} />} flush>
      <div className="px-4 pt-1">
        <Tabs label="Skin type" panelId="by-skin-panel" value={tab} onChange={(id) => setParam({ skin: id })} tabs={s.by_skin.map((b) => ({ id: b.skin, label: b.label, count: b.users }))} />
      </div>
      <div id="by-skin-panel" role="tabpanel" aria-label={`${row.label} skin`} className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-4">
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5 rounded-xs border border-line bg-sunken px-3 py-2.5">
              <dt className="text-proof-small text-ink-2">People</dt>
              <dd className="m-0 font-mono text-[20px] leading-tight text-ink tnum">{row.users === null ? <Suppressed /> : int(row.users)}</dd>
            </div>
            <div className="flex flex-col gap-0.5 rounded-xs border border-line bg-sunken px-3 py-2.5">
              <dt className="text-proof-small text-ink-2">Routines with a finding</dt>
              <dd className="m-0 font-mono text-[20px] leading-tight text-ink tnum">{row.conflict_share === null ? <Suppressed /> : pct(row.conflict_share)}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-proof-small font-normal text-ink-2">Top goals (share of {row.label.toLowerCase()} skin)</h3>
            {row.top_goals.length === 0 ? (
              <p className="m-0 text-proof-small text-ink-2">No goal has {MIN_GROUP} or more people with this skin type.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {row.top_goals.map((g) => (
                  <li key={g.goal_id}>
                    <button type="button" onClick={() => onOpenCell(row.skin, g.goal_id)} className="grid w-full grid-cols-[minmax(0,1fr)_minmax(60px,40%)_40px] items-center gap-3 rounded-xs border-0 bg-transparent px-1.5 py-1.5 text-left hover:bg-glass" aria-label={`${g.label}: ${pct(g.share)} of ${row.label.toLowerCase()} skin. Open details`}>
                      <span className="truncate text-proof-body text-ink">{g.label}</span>
                      <span aria-hidden className="block h-1.5 rounded-pill bg-muted">
                        <span className="block h-full rounded-pill bg-ink/70" style={{ width: `${(g.share / maxShare) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono text-proof-small tnum">{pct(g.share)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="m-0 text-proof-small text-ink-2">Goal shares overlap: people choose up to 3. Routine findings come from the app’s fixed rule table, among routines checked.</p>
        </div>
        <div className="min-w-0 rounded-sm border border-line lg:col-span-8">
          <DataTable
            caption={`Top products for ${row.label.toLowerCase()} skin`}
            heading={<h3 className="m-0 text-proof-h font-medium text-ink">Top products for {row.label.toLowerCase()} skin</h3>}
            columns={columns}
            rows={row.top_products}
            rowKey={(r) => r.product_id}
            onRowClick={(r) => navigate(`${sectionPath('products', r.product_id)}${carry}`)}
            rowLabel={(r) => `${r.product}, ${r.brand}: open product page`}
            defaultSort={{ id: 'lift', dir: 'desc' }}
            minWidth={560}
            csv={{ name: csvName(`skin-profile-${row.skin}-products`, d), meta: csvMeta(s, `${row.label} skin`) }}
            empty={`No product has ${MIN_GROUP} or more users with ${row.label.toLowerCase()} skin at week ${d.cohort.weeks}.`}
          />
          <p className="m-0 border-t border-line px-4 py-2.5 text-proof-small text-ink-2">
            Among each product’s users with {row.label.toLowerCase()} skin: ember dot the real-change rate, bar its 95% interval (from the rate and n), tick <Term id="base_rate">non-users</Term> with the same skin type. Ordered by <Term id="lift">lift</Term>.
          </p>
        </div>
      </div>
    </Panel>
  )
}

/* ───────────────────────────── cell side panel ───────────────────────────── */

function CellPanel({ cell, skin, goal, d, images, onClose, onSkin }: { cell: Cell | null; skin: string; goal: string; d: Insights; images: Map<string, string | null>; onClose: () => void; onSkin: (id: string) => void }) {
  const { carry } = useRetailState()
  // Keep the last cell while the panel slides out.
  const [last, setLast] = useState<{ cell: Cell; skin: string; goal: string } | null>(cell ? { cell, skin, goal } : null)
  if (cell && cell !== last?.cell) setLast({ cell, skin, goal })
  const v = cell ? { cell, skin, goal } : last
  const goalQs = v ? `${carry}${carry ? '&' : '?'}goal=${encodeURIComponent(v.cell.goal)}` : carry
  return (
    <SidePanel open={Boolean(cell)} onClose={onClose} title={v ? `${v.skin} skin · ${v.goal}` : 'Skin profile'} subtitle={v && v.cell.users !== null ? `${int(v.cell.users)} people chose this goal` : undefined} labelledBy="cell-panel-title">
      {v ? (
        <div className="flex flex-col gap-4">
          <span className="self-start">
            <SimBadge cohort={d.cohort} />
          </span>
          <div className="flex flex-col gap-1 rounded-sm border border-line bg-sunken p-3.5">
            <span className="text-proof-small text-ink-2">
              No <Term id="real_change">real change</Term> yet, at week {d.cohort.weeks}
            </span>
            {v.cell.unmet === null ? (
              <Suppressed />
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[28px] leading-none text-ink tnum">{pct(v.cell.unmet)}</span>
                <span className="text-proof-small text-ink-2">of people with this skin type and goal and {d.cohort.weeks} weeks of readings</span>
              </span>
            )}
          </div>
          <PickCard label="Best measured product" p={v.cell.best} carry={carry} image={v.cell.best ? (images.get(v.cell.best.product_id) ?? null) : null} />
          <PickCard label="Runner-up" p={v.cell.runner_up} carry={carry} image={v.cell.runner_up ? (images.get(v.cell.runner_up.product_id) ?? null) : null} />
          {!v.cell.best ? (
            <EmptyState compact title="No product ranked yet" body={`No catalogue product for this goal has ${MIN_GROUP} or more users with ${v.skin.toLowerCase()} skin and ${d.cohort.weeks} weeks of readings.`} />
          ) : null}
          <p className="m-0 text-proof-small text-ink-2">
            Rate among each product’s users with {v.skin.toLowerCase()} skin, on the metrics of {v.goal.toLowerCase()}, by week {d.cohort.weeks}; interval from the rate and n. An association with use, not proof of effect. Cosmetic measurements only.
          </p>
          <div className="flex flex-wrap gap-2">
            <ToolButton onClick={() => onSkin(v.cell.skin)}>Open {v.skin.toLowerCase()} skin profile</ToolButton>
            <Link to={`${sectionPath('demand')}${goalQs}`} className="hit44 inline-flex h-8 items-center gap-1 rounded-xs border border-line-strong px-2.5 text-proof-small text-ink no-underline hover:bg-glass">
              {v.goal} demand <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}
    </SidePanel>
  )
}

function PickCard({ label, p, carry, image }: { label: string; p: Choice | null; carry: string; image: string | null }) {
  if (!p) return null
  const ci = rateInterval(p.rate, p.n)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-proof-small text-ink-2">{label}</span>
      <Link to={`${sectionPath('products', p.product_id)}${carry}`} className="group flex items-center gap-3 rounded-sm border border-line p-3 no-underline hover:border-line-strong hover:bg-glass">
        <ProductImage product={{ image_url: image, category: '', name: p.product }} size={36} decorative />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-proof-body text-ink" title={p.product}>
              {p.product}
            </span>
            <span className="shrink-0 font-mono text-proof-body text-ink tnum">{pct(p.rate)}</span>
          </span>
          <span className="text-proof-small text-ink-2">{p.brand}</span>
          <EvidenceBar rate={p.rate} lo={ci?.lo} hi={ci?.hi} n={p.n} />
        </span>
        <ArrowRight size={14} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2 group-hover:text-ink" />
      </Link>
    </div>
  )
}
