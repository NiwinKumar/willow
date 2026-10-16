import { useRetailState } from '../state'
import { CategoriesView } from './market/CategoriesView'
import { BrandsView } from './market/Brands'
import { HeroBone, MarketFrame } from './market/Frame'
import { InsightsGate } from './shared'

/**
 * Market (/retail/market): how a brand compares with its competitors on outcomes, not sales. Two views:
 * Brands (default; you against the market by goal, or the brand leaderboard for the retailer) and
 * Categories (`?view=categories&category=`; flows per goal, brands and top products in one category).
 */
export default function Market() {
  const { param } = useRetailState()
  const view = param('view') === 'categories' ? 'categories' : 'brands'
  return (
    <InsightsGate
      skeleton={
        <MarketFrame view={view}>
          <HeroBone />
        </MarketFrame>
      }
    >
      {(d) => (view === 'categories' ? <CategoriesView d={d} /> : <BrandsView d={d} />)}
    </InsightsGate>
  )
}
