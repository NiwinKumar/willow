import { sectionPath } from '../state'
import { Scaffold } from './Scaffold'

// TODO(slice D): Promote on GET /v1/retailer/eligibility and /campaigns (slice B): eligible (Proven) products,
// create a campaign (product, goals, skin types, 7/14/30 days), live stats from consumer-app events, consumer
// preview. Rule shown on screen: money buys reach, never rank or eligibility.
export default function Promote() {
  return (
    <Scaffold
      title="Promote"
      question="Products that clear Willow’s evidence bar can be shown to matching people in the Willow app."
      coming="Pick a Proven product, choose the goals and skin types to reach, and follow impressions, views and adds to routine from the consumer app. Payment buys reach only: it never changes rank, eligibility or anyone’s recommendations."
      next={{ label: 'See which products are measured', path: sectionPath('products') }}
    />
  )
}
