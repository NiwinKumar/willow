import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Columns3, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

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
  /** Left out of the CSV (row-selection checkboxes, action buttons). */
  noCsv?: boolean
  /** The viewer can hide or show this column (the Columns menu). `hidden` starts it hidden. */
  optional?: boolean
  hidden?: boolean
}

function readHidden(key: string | undefined, cols: { id: string; hidden?: boolean }[]): Set<string> {
  const fallback = new Set(cols.filter((c) => c.hidden).map((c) => c.id))
  if (!key) return fallback
  try {
    const v = window.localStorage.getItem(`willow.proof.cols.${key}`)
    return v ? new Set(JSON.parse(v) as string[]) : fallback
  } catch {
    return fallback
  }
}

/**
 * The Proof table (Geist Table): typed columns, sortable headers (aria-sort), sticky header, right-aligned
 * tabular numbers, 48 px rows, an optional Columns menu, row click → handler (Enter/Space too; ↑/↓ move between rows), CSV export of exactly
 * the visible columns in the current order, and an empty state. Sort can be controlled (deep links keep it in
 * the URL) or left to the table. Scrolls sideways inside its own box on narrow screens.
 */
export function DataTable<T>({
  caption,
  columns: allColumns,
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
  columnsKey,
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
  /** Adds the Columns menu (optional columns), remembered on this browser under this key. */
  columnsKey?: string
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(columnsKey, allColumns))
  const columns = useMemo(() => allColumns.filter((c) => !c.optional || !hidden.has(c.id)), [allColumns, hidden])
  const toggleColumn = (id: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        if (columnsKey) window.localStorage.setItem(`willow.proof.cols.${columnsKey}`, JSON.stringify([...next]))
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
      return next
    })
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

  const text = (c: Column<T>) => c.headerText ?? (typeof c.header === 'string' ? c.header : c.id)
  const exportCsv = () => {
    if (!csv) return
    const cols = columns.filter((c) => !c.noCsv)
    downloadCsv(
      csv.name,
      csv.meta,
      cols.map(text),
      sorted.map((r) => cols.map((c) => (c.csv ? c.csv(r) : (c.sortValue?.(r) ?? '')))),
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
      {toolbar || csv || heading || columnsKey ? (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3">
          {heading ? <div className="flex min-w-0 flex-wrap items-center gap-2">{heading}</div> : null}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {toolbar}
            {columnsKey ? <ColumnsMenu columns={allColumns} hidden={hidden} onToggle={toggleColumn} /> : null}
            {csv ? (
              <ToolButton onClick={exportCsv} label={`Export ${caption} as CSV`}>
                <Download size={15} strokeWidth={1.6} aria-hidden />
                Export
              </ToolButton>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="relative overflow-auto overscroll-x-contain border-t border-line" style={{ maxHeight }}>
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
                    className={`sticky top-0 z-[1] h-10 whitespace-nowrap border-b border-line bg-pf-bg2 px-4 align-middle text-proof-small font-medium text-ink-2 first:pl-5 last:pr-5 ${right ? 'text-right' : 'text-left'}`}
                  >
                    {c.sortValue && typeof c.header === 'string' ? (
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className={`inline-flex items-center gap-1 rounded-[4px] border-0 bg-transparent p-0 text-inherit hover:text-ink ${on ? 'text-ink' : ''} ${right ? 'flex-row-reverse' : ''}`}
                      >
                        <span>{c.header}</span>
                        <SortIcon on={on} dir={sort?.dir} />
                      </button>
                    ) : c.sortValue ? (
                      // A rich header (e.g. a glossary Term, itself a button) can't sit inside the sort button:
                      // the label stays interactive on its own and a separate icon button sorts (the label's
                      // empty area sorts too, for the mouse).
                      <span
                        className={`inline-flex items-center gap-1 ${on ? 'text-ink' : ''} ${right ? 'flex-row-reverse' : ''}`}
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest('button')) toggle(c)
                        }}
                      >
                        <span className="cursor-default">{c.header}</span>
                        <button
                          type="button"
                          onClick={() => toggle(c)}
                          aria-label={`Sort by ${text(c)}`}
                          className="inline-flex rounded-[4px] border-0 bg-transparent p-0 text-inherit hover:text-ink"
                        >
                          <SortIcon on={on} dir={sort?.dir} />
                        </button>
                      </span>
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
                <td colSpan={columns.length} className="px-5 py-12 text-center text-proof-body text-ink-2">
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
                    className={`group ${onRowClick ? 'cursor-pointer' : ''} ${selected ? 'bg-pf-hover' : onRowClick ? 'hover:bg-pf-hover' : ''} transition-colors duration-100 focus-visible:outline-offset-[-2px] ${rowClassName?.(r) ?? ''}`}
                  >
                    {columns.map((c) => {
                      const cls = `h-[var(--proof-row)] border-b border-line px-4 py-2 align-middle first:pl-5 last:pr-5 group-last:border-b-0 ${c.align === 'right' ? 'text-right' : 'text-left'}`
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

function SortIcon({ on, dir }: { on: boolean; dir?: 'asc' | 'desc' }) {
  if (!on) return <ChevronsUpDown size={12} strokeWidth={1.6} aria-hidden className="opacity-50" />
  return dir === 'asc' ? <ArrowUp size={12} strokeWidth={1.8} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.8} aria-hidden />
}

/** The Columns menu: a checklist of the optional columns (a popover; Esc or a click outside closes it). */
function ColumnsMenu<T>({ columns, hidden, onToggle }: { columns: Column<T>[]; hidden: Set<string>; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const optional = columns.filter((c) => c.optional)
  if (!optional.length) return null
  return (
    <div ref={box} className="relative">
      <ToolButton onClick={() => setOpen((o) => !o)} label="Choose columns" pressed={open}>
        <Columns3 size={15} strokeWidth={1.6} aria-hidden />
        Columns
      </ToolButton>
      {open ? (
        <div role="group" aria-label="Columns" className="absolute right-0 top-[calc(100%+6px)] z-[60] flex w-64 flex-col rounded-card border border-line bg-surface p-1 shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.12)] animate-[wFadeIn_.12s_ease_both]">
          {optional.map((c) => {
            const on = !hidden.has(c.id)
            return (
              <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => onToggle(c.id)} className="flex min-h-9 items-center gap-2 rounded-ctl border-0 bg-transparent px-2.5 py-1.5 text-left text-proof-body text-ink hover:bg-pf-hover">
                <span className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${on ? 'border-ink bg-ink text-inverse' : 'border-line-strong'}`}>{on ? <Check size={12} strokeWidth={2.5} aria-hidden /> : null}</span>
                {c.headerText ?? (typeof c.header === 'string' ? c.header : c.id)}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
