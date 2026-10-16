import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export type Option = { value: string; label: string; hint?: string }

/**
 * A filter picker for the Explore query panel: a full-width button names the choice ("All brands", "CeraVe",
 * "3 brands"); it opens a checklist (with a search field when the list is long). ↑/↓ move, Enter or Space
 * toggles, Esc closes and returns focus to the button, a click outside closes. "Clear" empties the filter.
 */
export function MultiSelect({ label, plural, options, value, onChange }: { label: string; plural: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const base = useId()
  const searchable = options.length > 8
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options
  }, [options, q])
  const chosen = options.filter((o) => value.includes(o.value))
  const summary = chosen.length === 0 ? `All ${plural}` : chosen.length === 1 ? chosen[0].label : chosen.length === 2 ? `${chosen[0].label}, ${chosen[1].label}` : `${chosen.length} ${plural}`

  const close = (refocus = true) => {
    setOpen(false)
    setQ('')
    if (refocus) requestAnimationFrame(() => button.current?.focus())
  }
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  useEffect(() => {
    if (!open) return
    // preventScroll: opening a filter never moves the page.
    requestAnimationFrame(() => (searchable ? pop.current?.querySelector('input') : list.current)?.focus({ preventScroll: true }))
    const down = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
    // `close` only touches state setters and refs.
  }, [open, searchable]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active option in view inside the list only (scrollIntoView would also scroll the page).
  useEffect(() => {
    const ul = list.current
    const el = open ? document.getElementById(`${base}-o-${active}`) : null
    if (!ul || !el) return
    if (el.offsetTop < ul.scrollTop) ul.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = el.offsetTop + el.offsetHeight - ul.clientHeight + 4
  }, [active, base, open, value.length])

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (shown.length ? (a + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : 0))
    } else if (e.key === 'Enter' || (e.key === ' ' && e.currentTarget === list.current)) {
      e.preventDefault()
      if (shown[active]) toggle(shown[active].value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <div className="relative grid min-w-0 grid-cols-[68px_minmax(0,1fr)] items-center gap-2">
      <span id={`${base}-l`} className="text-proof-small text-ink-2">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${base}-l ${base}-v`}
        onClick={() => (open ? close() : (setActive(0), setOpen(true)))}
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-ctl border bg-surface pl-3 pr-2.5 text-left text-proof-small hover:border-line-strong ${chosen.length ? 'border-line-strong text-ink' : 'border-line text-ink-2'}`}
      >
        <span id={`${base}-v`} className="min-w-0 flex-1 truncate">
          {summary}
        </span>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2" />
      </button>
      {open ? (
        <div ref={pop} className="absolute left-0 right-0 top-[calc(100%+6px)] z-[60] flex max-h-[min(360px,60dvh)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[0_0_0_1px_var(--line-subtle),0_4px_8px_-4px_rgba(0,0,0,.06),0_16px_24px_-8px_rgba(0,0,0,.12)] animate-[wFadeIn_.12s_ease_both]">
          {searchable ? (
            <input
              role="combobox"
              aria-expanded
              aria-controls={`${base}-list`}
              aria-activedescendant={shown[active] ? `${base}-o-${active}` : undefined}
              aria-label={`Search ${plural}`}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={key}
              placeholder={`Search ${plural}`}
              className="h-10 w-full border-0 border-b border-line bg-transparent px-3 text-proof-body text-ink outline-none placeholder:text-ink-2"
            />
          ) : null}
          <ul
            ref={list}
            id={`${base}-list`}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={!searchable && shown[active] ? `${base}-o-${active}` : undefined}
            onKeyDown={searchable ? undefined : key}
            className="relative m-0 min-h-0 flex-1 list-none overflow-y-auto p-1 outline-none"
          >
            {shown.length === 0 ? <li className="px-2.5 py-2 text-proof-small text-ink-2">Nothing matches “{q}”.</li> : null}
            {shown.map((o, i) => {
              const on = value.includes(o.value)
              return (
                <li
                  key={o.value}
                  id={`${base}-o-${i}`}
                  role="option"
                  aria-selected={on}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.value)}
                  onPointerMove={() => setActive(i)}
                  className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-proof-small text-ink ${i === active ? 'bg-pf-hover' : ''}`}
                >
                  <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${on ? 'border-ink bg-ink text-inverse' : 'border-line-strong bg-surface'}`}>
                    {on ? <Check size={11} strokeWidth={2.5} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="shrink-0 text-proof-label text-ink-2 tnum">{o.hint}</span> : null}
                </li>
              )
            })}
          </ul>
          {value.length ? (
            <div className="flex items-center justify-between border-t border-line bg-pf-bg2 px-3 py-2 text-proof-label text-ink-2">
              <span className="tnum">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="hit44 rounded-ctl border-0 bg-transparent px-1.5 py-0.5 text-proof-label text-ink hover:bg-pf-hover">
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
