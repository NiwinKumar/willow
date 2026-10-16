import { sectionPath } from '../state'
import { Scaffold } from './Scaffold'

// TODO(slice D): Competitors on GET /v1/retailer/brands and /brands/{brand}: brand vs market per goal (with 95%
// intervals), positioning (outcome rate vs continuation), share of routines, switching won/lost. Needs a brand
// workspace ("Viewing as"); the retailer view compares all brands.
export default function Competitors() {
  return (
    <Scaffold
      title="Competitors"
      question="How a brand’s measured outcomes compare with the market, goal by goal."
      coming="Brand against market for each goal, positioning by outcome rate and continuation, share of routines, and where switching customers go. Same method and suppression for every brand, with intervals so small differences aren’t over-read."
      next={{ label: 'Compare brands by category', path: sectionPath('categories') }}
    />
  )
}
