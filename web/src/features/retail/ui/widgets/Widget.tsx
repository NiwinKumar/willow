import './widgets.css'

import { Ellipsis } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** The round button in a card's corner: a link when it has `to`, else a button. Names where it goes. */
export type WidgetMenu = { label: string; to?: string; onClick?: () => void }

/**
 * The card every widget sits on: a Proof panel (surface, hairline border), a title and an optional corner button. `label` is the spoken summary of the whole widget (a figure for screen readers);
 * the numbers inside are real text, so it stays short.
 */
export function Widget({
  title,
  label,
  menu,
  className = '',
  style,
  head = true,
  children,
}: {
  title?: ReactNode
  label: string
  menu?: WidgetMenu
  className?: string
  style?: CSSProperties
  /** false: the widget draws its own header row (the title is still the accessible name). */
  head?: boolean
  children: ReactNode
}) {
  return (
    <figure role="group" aria-label={label} className={`wg m-0 ${className}`} style={style}>
      {head && (title || menu) ? (
        <div className="wg-head">
          {title ? <h3 className="wg-title">{title}</h3> : <span />}
          <MenuButton menu={menu} />
        </div>
      ) : null}
      {children}
    </figure>
  )
}

export function MenuButton({ menu }: { menu?: WidgetMenu }) {
  if (!menu) return null
  const icon = <Ellipsis size={16} strokeWidth={2} aria-hidden />
  return menu.to ? (
    <Link to={menu.to} aria-label={menu.label} title={menu.label} className="wg-menu hit44">
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={menu.onClick} aria-label={menu.label} title={menu.label} className="wg-menu hit44">
      {icon}
    </button>
  )
}

/** A visually hidden data table: what the chart draws, for screen readers (one row per reading). */
export function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="wg-sr">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
