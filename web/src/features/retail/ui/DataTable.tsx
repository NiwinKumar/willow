import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { downloadCsv, type CsvValue } from './format'
import { ToolButton } from './Layout'

export type SortDir = 'asc' | 'desc'
export type Sort = { id: string; dir: SortDir }

export type Column<T> = {
  id: string
  header: ReactNode
  /** Plain header text for the CSV and aria (defaults to `header` when it is a string). */
  headerText?: string
  /** Numbers right-align and use tabular mono (set by `cell`). */
  align?: 'left' | 'right'
  /** CSS width (e.g. '120px', '28%'). */
  width?: string
  /** Makes the column sortable. null sorts last in both directions. */
  sortValue?: (row: T) => number | string | null
  /** First sort direction when the header is clicked (numbers usually start high). */
  firstDir?: SortDir
  cell: (row: T) => ReactNode
  /** The exported value; defaults to sortValue. Suppressed values should export as 'suppressed'. */
  csv?: (row: T) => CsvValue
  /** This column names the row (th scope="row"). */
  rowHeader?: boolean
}

/**
 * The Proof table: typed columns, sortable headers (aria-sort), sticky header, right-aligned tabular
 * numbers, 36 px rows, row click → handler (Enter/Space too; ↑/↓ move between rows), CSV export of exactly
 * the visible columns in the current order, and an empty state. Sort can be controlled (deep links keep it in
 * the URL) or left to the table. Scrolls sideways inside its own box on narrow screens.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  selectedKey,
  sort: sortProp,
  onSortChange,
  defaultSort,
  empty,
  csv,
  toolbar,
  heading,
  maxHeight,
  minWidth = 720,
  rowClassName,
}: {
  /** Names the table for screen readers (visually hidden). */
  caption: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Accessible name for the row action ("Open Cicaplast Baume B5+"). */
  rowLabel?: (row: T) => string
  selectedKey?: string | null
  sort?: Sort | null
  onSortChange?: (s: Sort | null) => void
  defaultSort?: Sort
  empty?: ReactNode
  /** File name and "# " header lines (cohort, filter, disclaimer); adds the Export CSV button. */
  csv?: { name: string; meta: string[] }
  /** Filters and counts, left of the export button. */
  toolbar?: ReactNode
  /** Title (and badges) for the table's own header row, so title, filters and export share one bar. */
  heading?: ReactNode
  maxHeight?: number | string
  minWidth?: number
  rowClassName?: (row: T) => string
}) {
  const [own, setOwn] = useState<Sort | null>(defaultSort ?? null)
  const sort = sortProp !== undefined ? sortProp : own
  const setSort = (s: Sort | null) => (onSortChange ? onSortChange(s) : setOwn(s))
  const body = useRef<HTMLTableSectionElement>(null)

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined
    if (!col?.sortValue || !sort) return rows
    const get = col.sortValue
    const k = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * k
    })
  }, [rows, columns, sort])

  const toggle = (c: Column<T>) => {
    const first = c.firstDir ?? (c.align === 'right' ? 'desc' : 'asc')
    if (!sort || sort.id !== c.id) setSort({ id: c.id, dir: first })
    else if (sort.dir === first) setSort({ id: c.id, dir: first === 'asc' ? 'desc' : 'asc' })
    else setSort(defaultSort ?? null)
  }

  const exportCsv = () => {
    if (!csv) return
    const text = (c: Column<T>) => c.headerText ?? (typeof c.header === 'string' ? c.header : c.id)
    downloadCsv(
      csv.name,
      csv.meta,
      columns.map(text),
      sorted.map((r) => columns.map((c) => (c.csv ? c.csv(r) : (c.sortValue?.(r) ?? '')))),
    )
  }

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const tr = e.currentTarget
    const next = (e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null
    next?.focus()
  }

  return (
    <div className="flex min-w-0 flex-col">
      {toolbar || csv || heading ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
          {heading ? <div className="flex min-w-0 flex-wrap items-center gap-2">{heading}</div> : null}
          <div className={`flex min-w-0 flex-wrap items-center gap-2 ${heading ? 'ml-auto' : ''}`}>{toolbar}</div>
          {csv ? (
            <ToolButton onClick={exportCsv} label={`Export ${caption} as CSV`}>
              <Download size={14} strokeWidth={1.6} aria-hidden />
              Export CSV
            </ToolButton>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-auto overscroll-x-contain" style={{ maxHeight }}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-proof-body" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            {columns.map((c) => (
              <col key={c.id} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort?.id === c.id
                const right = c.align === 'right'
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
                    className={`sticky top-0 z-[1] h-9 whitespace-nowrap border-b border-line bg-surface px-3 align-middle text-proof-small font-normal text-ink-2 first:pl-4 last:pr-4 ${right ? 'text-right' : 'text-left'}`}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className={`inline-flex items-center gap-1 rounded-[4px] border-0 bg-transparent p-0 text-inherit hover:text-ink ${on ? 'text-ink' : ''} ${right ? 'flex-row-reverse' : ''}`}
                      >
                        <span>{c.header}</span>
                        {on ? (
                          sort!.dir === 'asc' ? <ArrowUp size={12} strokeWidth={1.8} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.8} aria-hidden />
                        ) : (
                          <ChevronsUpDown size={12} strokeWidth={1.6} aria-hidden className="opacity-50" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody ref={body}>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-proof-body text-ink-2">
                  {empty ?? 'Nothing to show for these filters.'}
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const key = rowKey(r)
                const selected = selectedKey === key
                return (
                  <tr
                    key={key}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick && rowLabel ? rowLabel(r) : undefined}
                    aria-current={selected || undefined}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    onKeyDown={onRowClick ? (e) => onRowKey(e, r) : undefined}
                    className={`group ${onRowClick ? 'cursor-pointer' : ''} ${selected ? 'bg-proof-leaf-soft' : onRowClick ? 'hover:bg-glass' : ''} focus-visible:outline-offset-[-2px] ${rowClassName?.(r) ?? ''}`}
                  >
                    {columns.map((c) => {
                      const cls = `h-[var(--proof-row)] border-b border-line px-3 py-1.5 align-middle first:pl-4 last:pr-4 ${c.align === 'right' ? 'text-right' : 'text-left'}`
                      return c.rowHeader ? (
                        <th key={c.id} scope="row" className={`${cls} font-normal`}>
                          {c.cell(r)}
                        </th>
                      ) : (
                        <td key={c.id} className={cls}>
                          {c.cell(r)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
