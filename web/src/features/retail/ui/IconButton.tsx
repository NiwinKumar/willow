import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useTooltip } from './Tooltip'

/**
 * An icon-only control (32 px visual, 44 px hit area) whose name is its tooltip: the kit tooltip on hover and
 * focus, the same words as its accessible name. `to` renders a router link, otherwise a button.
 */
export function IconButton({ label, children, onClick, to, pressed }: { label: string; children: ReactNode; onClick?: () => void; to?: string; pressed?: boolean }) {
  const tip = useTooltip(label)
  const cls = `hit44 grid size-8 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 no-underline transition-[background,color,transform] duration-150 hover:bg-pf-hover hover:text-ink active:scale-[.94] ${pressed ? 'bg-pf-hover text-ink' : ''}`
  return (
    <>
      {to ? (
        <Link to={to} aria-label={label} {...tip.trigger} className={cls}>
          {children}
        </Link>
      ) : (
        <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} {...tip.trigger} className={cls}>
          {children}
        </button>
      )}
      {tip.node}
    </>
  )
}
