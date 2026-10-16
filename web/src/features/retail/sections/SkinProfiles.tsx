import { sectionPath } from '../state'
import { Scaffold } from './Scaffold'

// TODO(slice D): Skin profiles on GET /v1/retailer/segments: skin type × goal matrix (demand, unmet share, best
// product per cell with a runner-up), and per skin type the top goals and products. Use ui/Heatmap + SidePanel.
export default function SkinProfiles() {
  return (
    <Scaffold
      title="Skin profiles"
      question="Which skin types and goals are under-served, and which products serve each one."
      coming="A skin type × goal matrix with demand, the share of people without a real change yet, and the best measured product in each cell. Every cell under 10 people stays hidden."
      next={{ label: 'See demand by goal', path: sectionPath('demand') }}
    />
  )
}
