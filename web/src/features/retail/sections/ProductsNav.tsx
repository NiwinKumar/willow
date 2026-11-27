import { NavLink } from 'react-router-dom'

import { useRetailState } from '../state'

/**
 * Products and Range are one section: the range is where products come from, the table is how they do. Two
 * underline links (the same look as Tabs, but routes, so each view has its own URL).
 */
export function ProductsNav() {
  const { carry } = useRetailState()
  const items = [
    { to: `/retail/products${carry}`, label: 'Products', end: true },
    { to: `/retail/range${carry}`, label: 'Your range', end: true },
  ]
  return (
    <nav aria-label="Products views" className="no-scrollbar flex max-w-full gap-6 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <NavLink key={i.label} to={i.to} end={i.end} className={({ isActive }) => `relative -mb-px flex h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-0.5 text-proof-body no-underline transition-colors duration-150 ${isActive ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}
