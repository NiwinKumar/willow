import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'

import { Widget, type WidgetMenu } from './Widget'

/**
 * A tile for one headline share. `pill` is the tag in the corner (the count behind the share).
 * The arrow shows a direction only when `arrow` is given; a figure with no earlier reading to compare with gets none.
 */
export function ProgressTile({
  title,
  value,
  unit,
  pill,
  arrow,
  foot,
  hint,
  ariaLabel,
  menu,
}: {
  title: string
  value: string
  unit?: string
  pill?: string
  arrow?: 'up' | 'down'
  foot: ReactNode
  hint?: ReactNode
  ariaLabel: string
  menu?: WidgetMenu
}) {
  const Arrow = arrow === 'down' ? ArrowDown : ArrowUp
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-progress">
      {pill ? (
        <span className="wg-pill absolute right-[20px] top-[20px] z-[1]" style={menu ? { right: 56 } : undefined}>
          {pill}
        </span>
      ) : null}
      <div className="wg-progress-foot">
        <p className="wg-big m-0 flex items-end gap-1 text-[clamp(56px,16cqw,76px)]">
          {arrow ? <Arrow aria-hidden strokeWidth={1.5} className="mb-1 size-[0.62em] shrink-0" /> : null}
          <span>{value}</span>
          {unit ? <span className="wg-unit mb-1 text-[0.42em] text-[var(--wg-fg)]">{unit}</span> : null}
        </p>
        <p className="wg-cap m-0">{foot}</p>
        {hint ? <p className="wg-cap m-0">{hint}</p> : null}
      </div>
    </Widget>
  )
}
