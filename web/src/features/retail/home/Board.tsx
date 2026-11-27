import { forwardRef, useState, type ReactNode } from 'react'

import { Tabs } from '../ui'

/*
 * Home's decision board (below the dashboard): every card the top of the page did not show, one lane at a time
 * behind tabs (More to decide · In progress · Results) instead of three columns side by side, which stacked 21
 * results into one long column for a retailer. A lane shows six cards on a grid, then "Show N more".
 * The lane is in the URL (?lane=), so a reload or Back keeps it.
 *
 * Four tests: (1) the full record of decisions, findable in one place; (2) tabs with counts, the kit's own;
 * (3) the grid reserves nothing it does not fill, show-more appends below without moving what is read;
 * (4) kit Tabs, the cards are the same CardView as the rail.
 */

export type LaneId = 'decide' | 'progress' | 'results'
export type Lane = { id: LaneId; label: string; items: ReactNode[]; count: number; empty: ReactNode }

const PAGE = 6

export const Board = forwardRef<HTMLElement, { lanes: Lane[]; lane: LaneId; onLane: (l: LaneId) => void }>(function Board({ lanes, lane, onLane }, ref) {
  const [more, setMore] = useState<Record<string, boolean>>({})
  const cur = lanes.find((l) => l.id === lane) ?? lanes[0]
  const all = more[cur.id]
  const shown = all ? cur.items : cur.items.slice(0, PAGE)
  return (
    <section ref={ref} aria-labelledby="board-h" className="flex scroll-mt-28 flex-col gap-4">
      <h2 id="board-h" className="m-0 text-proof-h text-ink">
        Decisions
      </h2>
      <Tabs label="Decision lanes" value={cur.id} onChange={onLane} panelId="board-panel" tabs={lanes.map((l) => ({ id: l.id, label: l.label, count: l.count }))} />
      <div id="board-panel" role="tabpanel" aria-labelledby="board-h" key={cur.id} className="flex flex-col gap-3 animate-[proofPage_.2s_var(--ease-standard)_both]">
        {cur.items.length ? (
          <>
            <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">{shown}</div>
            {cur.items.length > PAGE ? (
              <button type="button" onClick={() => setMore((m) => ({ ...m, [cur.id]: !all }))} className="hit44 self-start rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
                {all ? 'Show fewer' : `Show ${cur.items.length - PAGE} more`}
              </button>
            ) : null}
          </>
        ) : (
          <div className="rounded-card border border-dashed border-line px-4 py-5 text-proof-small text-ink-2">{cur.empty}</div>
        )}
      </div>
    </section>
  )
})
