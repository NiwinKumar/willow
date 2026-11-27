import { EyeOff } from 'lucide-react'

import { useRetailState } from '../state'
import { EmptyState } from '../ui'

/** What a brand organisation sees where another brand would be named and the retailer's policy keeps names off. */
export function NamesHidden({ what }: { what: string }) {
  const { carry } = useRetailState()
  return (
    <EmptyState
      icon={<EyeOff size={18} strokeWidth={1.6} />}
      title={`${what} is hidden by the retailer’s policy`}
      body="Your retailer keeps competitor names off for brands: other brands appear as “Brand A”, “Brand B”, with the category median and best in category. Your own products are fully open."
      action={{ label: 'Your products', to: `/retail/products${carry}` }}
      secondary={{ label: 'What brands see', to: `/retail/research${carry}${carry ? '&' : '?'}tab=sharing` }}
    />
  )
}
