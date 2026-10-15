import { Menu } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useData } from '../data/useData'
import { Sheet } from './Sheet'

const baseLinks = [
  { to: '/s/face_full', label: 'Results' },
  { to: '/capture', label: 'New session' },
  { to: '/routine', label: 'Routine' },
  { to: '/advisor', label: 'Advisor' },
  { to: '/retailer', label: 'Retailer insights' },
  { to: '/science', label: 'How it works' },
  { to: '/settings', label: 'Settings' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const data = useData()
  const q = data.mode === 'demo' ? '?demo=1' : ''
  // Live: Results opens the first place with results (the face when it has any), else the face's empty state.
  const resultsTo = data.mode === 'demo' ? '/s/face_full' : `/s/${data.sites[0] ?? 'face_full'}`
  const links = baseLinks.map((l) => (l.label === 'Results' ? { ...l, to: resultsTo } : l))
  const here = (l: { to: string; label: string }) => pathname.startsWith(l.label === 'Results' ? '/s/' : l.to.split('?')[0])
  return (
    <>
      <nav className="hidden items-center gap-4 text-[13px] text-text-2 md:flex" aria-label="Primary">
        {links.map((l) => (
          <Link key={l.to} to={`${l.to}${q}`} aria-current={here(l) ? 'page' : undefined} className={`hover:text-text ${here(l) ? 'font-semibold text-text' : ''}`}>
            {l.label}
          </Link>
        ))}
      </nav>
      <button type="button" onClick={() => setOpen(true)} aria-label="Menu" className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-control) hover:bg-surface-2 md:hidden">
        <Menu size={20} aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Willow">
        <ul className="divide-y divide-border">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={`${l.to}${q}`} onClick={() => setOpen(false)} aria-current={here(l) ? 'page' : undefined} className={`block min-h-12 py-3 text-[17px] ${here(l) ? 'font-semibold' : ''}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
