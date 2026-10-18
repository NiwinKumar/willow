import { Download } from 'lucide-react'
import type { ReactNode } from 'react'

import { csvMeta, csvName } from '../../data'
import type { Insights, Segments } from '../../types'
import { int, MIN_GROUP, Panel, pct, Segmented, ToolButton, useTooltip } from '../../ui'
import { downloadCsv } from '../../ui/format'
import { cellFill, cellKey, MATRIX_MODES, type MatrixMode, type SegCell } from './model'

/*
 * The hero of Customers: skin type × goal. One matrix, three readings (Segmented): the share with no visible
 * change by week 8 (gray → amber), the people who chose the goal (gray), or the best product in the group (in a
 * brand workspace, the brand's own wins in leaf). Suppressed groups are hatched and say "n<10", never 0.
 */

const DESCRIPTION: Record<MatrixMode, string> = {
  unmet: 'Share of people with no visible change by week 8. Select a group for the products that work in it.',
  people: 'People who chose each goal, by skin type (up to 5 goals each).',
  best: 'The product with the highest visible-change rate in each group (10+ users).',
}

export function MatrixPanel({ s, d, mode, onMode, openKey, onOpen, goalId, skinId, mine }: { s: Segments; d: Insights; mode: MatrixMode; onMode: (m: MatrixMode) => void; openKey: string | null; onOpen: (c: SegCell) => void; goalId: string | null; skinId: string | null; mine: string | null }) {
  const byKey = new Map(s.cells.map((c) => [cellKey(c), c]))
  const maxUsers = Math.max(1, ...s.cells.map((c) => c.users ?? 0))
  const csv = () =>
    downloadCsv(
      csvName('customers-skin-by-goal', d),
      csvMeta(s),
      ['skin_type', 'goal', 'people_with_goal', 'no_visible_change_pct', 'best_product', 'best_brand', 'best_visible_change_pct', 'best_n', 'runner_up_product', 'runner_up_brand', 'runner_up_visible_change_pct', 'runner_up_n'],
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
      title="Skin type × goal"
      id="matrix-h"
      description={DESCRIPTION[mode]}
      actions={
        <>
          <Segmented label="Show in each group" options={MATRIX_MODES} value={mode} onChange={onMode} />
          <ToolButton onClick={csv} label="Export the skin type by goal matrix as CSV">
            <Download size={15} strokeWidth={1.6} aria-hidden />
          </ToolButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative -mx-1 overflow-x-auto overscroll-x-contain px-1">
          <table className="w-full table-fixed border-separate border-spacing-1 text-proof-body" style={{ minWidth: 860 }}>
            <caption className="sr-only">Skin type by goal: {DESCRIPTION[mode]}</caption>
            <colgroup>
              <col style={{ width: 132 }} />
              {s.goals.map((g) => (
                <col key={g.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="px-1 pb-1 text-left align-bottom text-proof-label font-normal text-ink-2">
                  Skin type
                </th>
                {s.goals.map((g) => (
                  <th key={g.id} scope="col" className={`px-2 pb-1 text-left align-bottom text-proof-label leading-4 ${goalId === g.id ? 'font-medium text-ink' : 'font-normal text-ink-2'}`}>
                    {g.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.skin_types.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="px-1 text-left align-middle font-normal">
                    <span className={`block truncate text-proof-body ${skinId === t.id ? 'font-medium text-ink' : 'text-ink'}`}>{t.label}</span>
                    <span className="block text-proof-label text-ink-2 tnum">{t.users === null ? `n<${MIN_GROUP}` : `${int(t.users)} people`}</span>
                  </th>
                  {s.goals.map((g) => {
                    const c = byKey.get(`${t.id}.${g.id}`)
                    return c ? <MatrixCell key={g.id} c={c} mode={mode} maxUsers={maxUsers} where={`${t.label} skin, ${g.label}`} selected={openKey === cellKey(c)} mine={mine} onOpen={() => onOpen(c)} /> : <td key={g.id} />
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Legend mode={mode} maxUsers={maxUsers} mine={mine} />
      </div>
    </Panel>
  )
}

function pickLine(p: SegCell['best']) {
  return p ? `${p.product} (${p.brand}): ${pct(p.rate)} of ${int(p.n)}` : null
}

function MatrixCell({ c, mode, maxUsers, where, selected, mine, onOpen }: { c: SegCell; mode: MatrixMode; maxUsers: number; where: string; selected: boolean; mine: string | null; onOpen: () => void }) {
  const best = pickLine(c.best)
  const tip = useTooltip(
    c.users === null ? null : (
      <span className="flex flex-col gap-0.5">
        <span className="text-ink-2">{where}</span>
        {best ? <span>Best: {best}</span> : <span>No product has {MIN_GROUP}+ users in this group yet.</span>}
      </span>
    ),
  )
  // Too few people in the whole group: hatched, not a button.
  if (c.users === null)
    return (
      <td className="retail-hatch h-14 rounded-ctl px-2.5 align-middle">
        <span className="text-proof-label text-ink-2" aria-hidden>
          n&lt;{MIN_GROUP}
        </span>
        <span className="sr-only">
          {where}: fewer than {MIN_GROUP} people
        </span>
      </td>
    )

  const fill = cellFill(mode, c, maxUsers)
  const own = mode === 'best' && mine !== null && c.best?.brand === mine
  let main: ReactNode
  let sub: ReactNode
  let label: string
  if (mode === 'unmet') {
    main = c.unmet === null ? <span className="text-ink-2">n&lt;{MIN_GROUP}</span> : pct(c.unmet)
    sub = c.unmet === null ? 'at week 8' : `${int(c.users)} people`
    label = c.unmet === null ? `${where}: ${int(c.users)} people, fewer than ${MIN_GROUP} at week 8 so no share yet. Open details` : `${where}: ${pct(c.unmet)} with no visible change by week 8, ${int(c.users)} people. Open details`
  } else if (mode === 'people') {
    main = int(c.users)
    sub = c.unmet === null ? 'people' : `${pct(c.unmet)} unmet`
    label = `${where}: ${int(c.users)} people. Open details`
  } else {
    main = c.best ? <span className="line-clamp-2 whitespace-normal text-proof-small font-medium leading-4">{c.best.product}</span> : <span className="text-proof-small text-ink-2">None yet</span>
    sub = c.best ? `${pct(c.best.rate)} · n=${int(c.best.n)}` : `no product n≥${MIN_GROUP}`
    label = c.best ? `${where}: best is ${best}${own ? ', yours' : ''}. Open details` : `${where}: no product has ${MIN_GROUP} or more users yet. Open details`
  }
  const hatch = fill === null
  const ring = selected ? 'outline outline-2 -outline-offset-2 outline-ink' : own ? 'outline outline-1 -outline-offset-1 outline-proof-leaf-line' : ''
  return (
    <td className={`h-14 rounded-ctl p-0 align-middle ${hatch ? 'retail-hatch' : ''} ${ring}`} style={hatch ? undefined : { background: own ? 'var(--proof-leaf-soft)' : fill }}>
      <button type="button" onClick={onOpen} aria-label={label} aria-pressed={selected} {...tip.trigger} className="flex h-14 w-full min-w-0 flex-col justify-center rounded-ctl border-0 bg-transparent px-2.5 text-left transition-[box-shadow] duration-150 hover:shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <span className={`block min-w-0 text-proof-body font-medium tnum ${mode === 'best' ? '' : 'truncate'} ${own ? 'text-proof-leaf' : 'text-ink'}`}>{main}</span>
        <span className="block truncate text-proof-label text-ink-2 tnum">{sub}</span>
      </button>
      {tip.node}
    </td>
  )
}

function Legend({ mode, maxUsers, mine }: { mode: MatrixMode; maxUsers: number; mine: string | null }) {
  const ramp =
    mode === 'unmet'
      ? { from: '0%', to: '100%', what: 'No visible change by week 8', grad: 'linear-gradient(90deg, var(--bg-sunken), color-mix(in srgb, var(--pf-amber-fill) 60%, var(--bg-sunken)))' }
      : mode === 'people'
        ? { from: '0', to: int(maxUsers), what: 'People', grad: 'linear-gradient(90deg, var(--bg-sunken), color-mix(in srgb, var(--text-primary) 30%, var(--bg-sunken)))' }
        : null
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-proof-label text-ink-2" aria-hidden>
      {ramp ? (
        <span className="flex items-center gap-2">
          {ramp.what}
          <span className="tnum">{ramp.from}</span>
          <span className="block h-2 w-28 rounded-pill" style={{ background: ramp.grad }} />
          <span className="tnum">{ramp.to}</span>
        </span>
      ) : mine ? (
        <span className="flex items-center gap-2">
          <span className="block h-3 w-5 rounded-[3px] border border-proof-leaf-line bg-proof-leaf-soft" />
          Your product leads the group
        </span>
      ) : (
        <span>Rate: share of the product’s users in the group with a visible change by week 8</span>
      )}
      <span className="flex items-center gap-2">
        <span className="retail-hatch block h-3 w-5 rounded-[3px]" />
        Not enough data (n&lt;{MIN_GROUP})
      </span>
    </div>
  )
}
