import { useRetailState } from '../state'
import { Tabs } from '../ui'
import Demand from './Demand'
import SkinProfiles from './SkinProfiles'

/** Customers (/retail/customers): skin profiles and demand (placeholder shell; rebuilt in the revamp). */
export default function Customers() {
  const { param, setParam } = useRetailState()
  const view = param('view') === 'demand' ? 'demand' : 'profiles'
  return (
    <div className="flex flex-col gap-6">
      <Tabs label="Customers views" tabs={[{ id: 'profiles', label: 'Skin profiles' }, { id: 'demand', label: 'Demand' }]} value={view} onChange={(v) => setParam({ view: v === 'profiles' ? null : v })} />
      {view === 'demand' ? <Demand /> : <SkinProfiles />}
    </div>
  )
}
