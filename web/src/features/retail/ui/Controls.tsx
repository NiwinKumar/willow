import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Text tabs with an underline indicator (docs/DESIGN.md Tabs): role tablist/tab, roving tabindex, ←/→/Home/End.
 * `panelId` links each tab to the panel it controls. `count` adds a quiet number after the label.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, panelId }: { tabs: { id: T; label: ReactNode; count?: number | null }[]; value: T; onChange: (id: T) => void; label: string; panelId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value)
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (j === null) return
    e.preventDefault()
    const next = tabs[(j + tabs.length) % tabs.length]
    // Every tab is rendered, so focus moves at once (a frame later is skipped in background tabs).
    ref.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus()
    onChange(next.id)
  }
  // Keep the selected tab in view when the row scrolls (phones, deep links to a late tab).
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [value])
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={move} className="no-scrollbar flex max-w-full gap-6 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative -mb-px flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-0 border-b-2 bg-transparent px-0.5 text-proof-body transition-colors duration-150 ${on ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t.label}
            {t.count !== undefined && t.count !== null ? <span className="rounded-pill bg-sunken px-1.5 text-proof-label text-ink-2 tnum">{t.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Segmented radio group (Geist Switch): 36 px, arrow keys move, the chosen option raised on a sunken track.
 */
export function Segmented<T extends string>({ label, options, value, onChange, className = '' }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    const el = box?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!box || !el) return
    if (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft - 4
  }, [value])
  const move = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const k = (i + d + options.length) % options.length
    // Focus moves at once (a frame later is skipped in background tabs); the radios render in option order.
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[k]?.focus()
    onChange(options[k].value)
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={move} className={`no-scrollbar flex h-9 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-ctl border border-line bg-sunken p-[3px] ${className}`}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`h-full whitespace-nowrap rounded-[4px] border-0 px-3 text-proof-small transition-colors duration-150 ${on ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line-subtle),0_1px_2px_rgba(0,0,0,.06)]' : 'bg-transparent text-ink-2 hover:text-ink'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A labelled native select (36 px). Native, so phones get the system picker. */
export function Select<T extends string>({ label, value, options, onChange, hideLabel = false }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hideLabel?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-proof-small text-ink-2">
      <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
      <span className="relative inline-flex">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-9 max-w-[220px] appearance-none truncate rounded-ctl border border-line bg-surface py-0 pl-3 pr-8 text-proof-small text-ink hover:border-line-strong"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-2" />
      </span>
    </label>
  )
}

/** Toolbar search box (type to filter a table), 36 px, labelled, with the search glyph inside. */
export function SearchField({ label, value, onChange, placeholder, width = 240 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <Search size={15} strokeWidth={1.7} aria-hidden className="pointer-events-none absolute left-3 text-ink-2" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width }}
        className="h-9 max-w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-proof-small text-ink placeholder:text-ink-2 hover:border-line-strong"
      />
    </label>
  )
}
