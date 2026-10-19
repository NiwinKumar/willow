import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useRetailData } from '../context'
import { useRetailState } from '../state'
import type { Insights, Products, ProductRow, Segments } from '../types'
import { Bone, ErrorState, int, MIN_GROUP, PageHeader, pct, SkeletonPanel } from '../ui'
import { topUnmet } from '../ui/insight'
import { fetchProducts } from '../productData'
import { useSegments, useView } from '../useView'
import { Conflicts, Gaps, WhatPeopleWant } from './customers/Demand'
import { MatrixPanel } from './customers/Matrix'
import { cellKey, ownForGoal, parseMode } from './customers/model'
import { CellPanel, SkinPanel } from './customers/Panels'
import { SkinTypes } from './customers/SkinTypes'
import { InsightsGate } from './shared'

/*
 * Customers (/retail/customers): who uses products like yours, what they are trying to change, and where they
 * are not being served. Hero: the skin type × goal matrix (GET /v1/retailer/segments); below: skin types, demand
 * by goal, routine conflicts and assortment gaps (GET /v1/retailer/insights). URL keys: `show` (matrix reading),
 * `cell` ("oily.lines", the group drawer), `skin` (the skin-type drawer), `goal` (highlights a goal). Anchors
 * #unmet, #demand, #conflicts, #gaps (brief cards link to them; `view=demand` from old links lands on #demand).
 */
export default function Customers() {
  return <InsightsGate skeleton={<Skeleton />}>{(d) => <Page d={d} />}</InsightsGate>
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div aria-hidden className="flex flex-col gap-2">
        <Bone className="h-7 w-40" />
        <Bone className="h-4 w-[min(620px,90%)]" />
      </div>
      <SkeletonPanel height={360} />
      <SkeletonPanel height={240} />
    </div>
  )
}

function Page({ d }: { d: Insights }) {
  const seg = useSegments()
  const { filters, workspace } = useRetailData()
  const { param, setParam } = useRetailState()
  const { hash } = useLocation()
  const mine = workspace.kind === 'brand' ? workspace.brand : null
  // The same request (and cache) as the product screens (productData).
  const catalog = useView<Products>(`products|${filters.cohort}|${filters.range}`, () => fetchProducts(filters))
  const products = new Map<string, ProductRow>((catalog.data?.products ?? []).map((p) => [p.product_id, p]))

  // Anchors land once the matrix is in (it sets the height above them); an old `view=demand` link lands on
  // What people want. Scrolled in the effect itself: a frame callback is skipped in background tabs.
  // The old key places the page once: opening a panel later must not scroll the page there again.
  const legacyDone = useRef(false)
  const target = hash ? hash.slice(1) : param('view') === 'demand' && !legacyDone.current ? 'demand' : null
  const ready = seg.status !== 'loading'
  useEffect(() => {
    if (!target || !ready) return
    document.getElementById(target)?.scrollIntoView({ block: 'start' })
    legacyDone.current = true
  }, [target, ready])

  const s = seg.status === 'ready' ? seg.data : null
  const openCell = param('cell')
  const cell = s && openCell ? (s.cells.find((c) => cellKey(c) === openCell) ?? null) : null
  const skinRow = s ? (s.by_skin.find((b) => b.skin === param('skin')) ?? null) : null
  const goalId = param('goal')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Customers" description={<Finding s={s} d={d} mine={mine} products={products} />} />
      <section id="unmet" aria-label="Skin type by goal">
        {seg.status === 'loading' ? (
          <div role="status" aria-label="Loading skin types" aria-busy="true">
            <SkeletonPanel height={360} />
          </div>
        ) : seg.status === 'failed' ? (
          <ErrorState title="Skin types couldn’t load" body="The skin type and goal aggregates didn’t answer. No partial numbers are shown." onRetry={seg.retry} />
        ) : (
          <MatrixPanel
            s={seg.data}
            d={d}
            mode={parseMode(param('show'))}
            onMode={(m) => setParam({ show: m === 'unmet' ? null : m })}
            openKey={openCell}
            onOpen={(c) => setParam({ cell: cellKey(c), skin: null }, { push: true })}
            goalId={goalId}
            skinId={param('skin')}
            mine={mine}
          />
        )}
      </section>
      {s ? <SkinTypes s={s} d={d} selected={param('skin')} onOpen={(skin) => setParam({ skin, cell: null }, { push: true })} mine={mine} /> : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section id="demand" className="flex min-w-0 xl:col-span-7">
          <WhatPeopleWant d={d} goalId={goalId} className="w-full" />
        </section>
        <section id="conflicts" className="flex min-w-0 xl:col-span-5">
          <Conflicts d={d} className="w-full" />
        </section>
      </div>
      <Gaps d={d} />
      {s ? (
        <>
          <CellPanel cell={cell} s={s} catalog={products} mine={mine} onClose={() => setParam({ cell: null })} />
          <SkinPanel row={skinRow} mine={mine} onClose={() => setParam({ skin: null })} onGoal={(skin, goal) => setParam({ skin: null, cell: `${skin}.${goal}` }, { push: true })} />
        </>
      ) : null}
    </div>
  )
}

/** The page's one-line answer: the most under-served group, with its numbers (and, for a brand, its coverage). */
function Finding({ s, d, mine, products }: { s: Segments | null; d: Insights; mine: string | null; products: Map<string, ProductRow> }) {
  const worst = s ? topUnmet(s, 1)[0] : undefined
  if (!worst) {
    const top = [...d.needs].sort((a, b) => b.n - a.n)[0]
    if (s) return <>No skin type and goal group has {MIN_GROUP} or more people with 8 weeks of readings in this filter.</>
    return top ? (
      <>
        <strong>{top.goal}</strong> is the most-chosen goal ({int(top.n)} people).
      </>
    ) : null
  }
  const own = mine && products.size ? ownForGoal([...products.values()], mine, worst.goal).length : null
  return (
    <>
      <strong>
        {worst.skinLabel} skin × {worst.goalLabel}
      </strong>{' '}
      is the most under-served group: {pct(worst.unmet)} saw no visible change by week 8 ({int(worst.users)} people)
      {own === null ? '.' : own === 0 ? <>, and you have no product for {worst.goalLabel.toLowerCase()}.</> : <>; you have {own} {own === 1 ? 'product' : 'products'} for it.</>}
    </>
  )
}
