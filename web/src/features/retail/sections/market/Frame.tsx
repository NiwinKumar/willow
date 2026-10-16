import type { ReactNode } from 'react'

import { useRetailState } from '../../state'
import { Bone, PageHeader, Tabs } from '../../ui'
import type { MarketView } from './model'

/** Market page frame: the header (one sentence with the view's answer), the Brands / Categories tabs, the view. */
export function MarketFrame({ view, description, actions, children }: { view: MarketView; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { setParam } = useRetailState()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Market" description={description ?? <Bone className="mt-1 h-4 w-[min(520px,80vw)]" />} actions={actions} />
      <div className="flex flex-col gap-6">
        <Tabs
          label="Market views"
          panelId="market-view"
          tabs={[
            { id: 'brands', label: 'Brands' },
            { id: 'categories', label: 'Categories' },
          ]}
          value={view}
          onChange={(v) => setParam({ view: v === 'brands' ? null : v, goal: null, brand: null, sort: null }, { push: true })}
        />
        <div id="market-view" role="tabpanel" aria-label={view === 'brands' ? 'Brands' : 'Categories'} className="flex min-w-0 flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  )
}

/** A panel-shaped placeholder at the final panel's height. */
export function PanelBone({ height, className = '' }: { height: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-4 ${className}`}>
      <Bone className="h-4 w-48" />
      <Bone className="h-3 w-72 max-w-full" />
      <span className="retail-shimmer block rounded-ctl" style={{ height }} />
    </div>
  )
}

/** The hero row while it loads: the 7/5 split every Market view opens on. */
export function HeroBone() {
  return (
    <div role="status" aria-label="Loading the market" aria-busy="true" className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <PanelBone height={380} className="xl:col-span-7" />
      <PanelBone height={380} className="xl:col-span-5" />
    </div>
  )
}
