import { useRetailState } from '../state'
import { Tabs } from '../ui'
import Categories from './Categories'
import Competitors from './Competitors'

/** Market (/retail/market): competitors and categories (placeholder shell; rebuilt in the revamp). */
export default function Market() {
  const { param, setParam } = useRetailState()
  const view = param('view') === 'categories' ? 'categories' : 'brands'
  return (
    <div className="flex flex-col gap-6">
      <Tabs label="Market views" tabs={[{ id: 'brands', label: 'Brands' }, { id: 'categories', label: 'Categories' }]} value={view} onChange={(v) => setParam({ view: v === 'brands' ? null : v })} />
      {view === 'categories' ? <Categories /> : <Competitors />}
    </div>
  )
}
