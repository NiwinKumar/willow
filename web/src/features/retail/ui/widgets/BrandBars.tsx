import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { Widget, type WidgetMenu } from './Widget'

export type BrandBar = {
  id: string
  label: string
  /** The bar's length, 0–1 of the track. */
  value: number
  display: string
  /** How it sits against the reference, e.g. "+9 pts". */
  delta?: string
  to?: string
  current?: boolean
  title?: string
}

/**
 * A ranked list drawn as bars on a 0–100% track. A tick marks a reference (the market average) so the gap to it
 * is what the eye reads; the current row (your brand) carries a lime dot and full strength.
 */
export function BrandBars({ title, rows, reference, referenceLabel, menu, ariaLabel, foot }: { title: string; rows: BrandBar[]; reference?: number | null; referenceLabel?: string; menu?: WidgetMenu; ariaLabel: string; foot?: string }) {
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-bars">
      <ol className="wg-bars-list">
        {rows.map((r, i) => {
          const inner = (
            <>
              <span className="wg-bars-line">
                <span className="t">
                  {r.current ? <i aria-hidden className="wg-rank-dot" /> : null}
                  <span className="n">{r.label}</span>
                  {r.current ? <span className="wg-sr"> (yours)</span> : null}
                </span>
                {r.delta ? <span className="d">{r.delta}</span> : null}
                <span className="v">{r.display}</span>
              </span>
              <span aria-hidden className="wg-bars-track">
                <span className="wg-bars-fill" style={{ width: `${Math.min(Math.max(r.value, 0), 1) * 100}%`, '--i': i } as CSSProperties} />
                {reference != null ? <span className="wg-bars-ref" style={{ left: `${Math.min(Math.max(reference, 0), 1) * 100}%` }} /> : null}
              </span>
            </>
          )
          return (
            <li key={r.id}>
              {r.to ? (
                <Link to={r.to} title={r.title} className="wg-bars-row" data-on={r.current ? '' : undefined}>
                  {inner}
                </Link>
              ) : (
                <div title={r.title} className="wg-bars-row" data-on={r.current ? '' : undefined}>
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {foot || (reference != null && referenceLabel) ? (
        <p className="wg-cap m-0 mt-auto">
          {reference != null && referenceLabel ? (
            <>
              <i aria-hidden className="wg-bars-key" /> {referenceLabel}
              {foot ? ' · ' : ''}
            </>
          ) : null}
          {foot}
        </p>
      ) : null}
    </Widget>
  )
}
