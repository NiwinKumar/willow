import type { CSSProperties, ReactNode } from 'react'

import { Widget } from './Widget'

/**
 * A share as a grid of dots: leaf dots are the share, pale rings the rest. Rounded to the
 * nearest dot, so the figure beside it is always the exact number; the dots are the picture.
 */
export function DotMatrix({
  title,
  value,
  share,
  caption,
  cols = 16,
  rows = 3,
  tone = 'leaf',
  ariaLabel,
}: {
  title: string
  value: string
  /** 0–1. */
  share: number
  caption: ReactNode
  cols?: number
  rows?: number
  /** leaf = a visible change; amber = people still waiting for one. */
  tone?: 'leaf' | 'amber'
  ariaLabel: string
}) {
  const total = cols * rows
  const on = Math.round(Math.max(0, Math.min(1, share)) * total)
  return (
    <Widget label={ariaLabel} className="wg-dots" head={false} style={{ '--wg-dot': tone === 'amber' ? 'var(--wg-amber)' : 'var(--wg-acc)' } as CSSProperties}>
      <div className="wg-dots-top">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="wg-title !pt-0">{title}</h3>
          <p className="wg-cap">{caption}</p>
        </div>
        <p className="wg-dots-val m-0">{value}</p>
      </div>
      <div role="img" aria-label={`${on} of ${total} dots filled, ${value}`} className="wg-dots-grid" style={{ '--cols': cols } as CSSProperties}>
        {Array.from({ length: total }, (_, k) => (
          <span key={k} className="wg-dot" data-on={k < on ? '' : undefined} style={{ '--i': k } as CSSProperties} />
        ))}
      </div>
    </Widget>
  )
}
