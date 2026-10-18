import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { Widget, type WidgetMenu } from './Widget'

export type RankRow = { id: string; label: string; value: string; to?: string; current?: boolean; title?: string }

/**
 * A short ranked list on a dark card. The rows fade toward the bottom to say "most first"; hover or focus
 * brings every row to full strength. The current row (your brand) carries a lime dot and full strength.
 */
export function RankList({ title, rows, menu, ariaLabel, foot }: { title: string; rows: RankRow[]; menu?: WidgetMenu; ariaLabel: string; foot?: string }) {
  return (
    <Widget title={title} label={ariaLabel} menu={menu} className="wg-rank">
      <ol className="wg-rank-list">
        {rows.map((r, i) => {
          const style = { '--i': i } as CSSProperties
          const inner = (
            <>
              <span>
                {r.current ? <i aria-hidden className="wg-rank-dot" /> : null}
                <span className="t">{r.label}</span>
                {r.current ? <span className="wg-sr"> (yours)</span> : null}
              </span>
              <span className="v">{r.value}</span>
            </>
          )
          return (
            <li key={r.id}>
              {r.to ? (
                <Link to={r.to} title={r.title} className="wg-rank-row" style={style} data-on={r.current || i === 0 ? '' : undefined}>
                  {inner}
                </Link>
              ) : (
                <div title={r.title} className="wg-rank-row" style={style} data-on={r.current || i === 0 ? '' : undefined}>
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {foot ? <p className="wg-cap m-0 mt-auto">{foot}</p> : null}
    </Widget>
  )
}
