import { Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type ComboOption = { value: string; label: string; hint?: string; group?: string }

/**
 * A searchable picker (the "Viewing as" workspace switch): a button shows the current choice; opening it shows
 * a filter field (role=combobox) over a listbox. ↑/↓ move, Enter picks, Esc closes and returns focus to the
 * button, a click outside closes. Options can carry a group heading and a quiet hint (e.g. a product count).
 */
export function Combobox({ label, value, options, onChange, prefix, footer, width = 280, searchPlaceholder = 'Search brands', emptyText = 'Choose', disabled = false }: { label: string; value: string; options: ComboOption[]; onChange: (v: string) => void; prefix?: ReactNode; footer?: ReactNode; width?: number; searchPlaceholder?: string; emptyText?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const base = useId()
  const current = options.find((o) => o.value === value)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options
  }, [options, q])

  const close = (refocus = true) => {
    setOpen(false)
    setQ('')
    if (refocus) requestAnimationFrame(() => button.current?.focus())
  }
  const pick = (o: ComboOption) => {
    onChange(o.value)
    close()
  }

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => input.current?.focus())
    const down = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open])

  useEffect(() => {
    document.getElementById(`${base}-o-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, base])

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (shown.length ? (a + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (shown[active]) pick(shown[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        className="hit44 flex h-8 min-w-0 max-w-full items-center gap-2 rounded-xs border border-line-strong bg-sunken pl-2.5 pr-2 text-proof-small text-ink hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="shrink-0 text-ink-2">{label}</span>
        {prefix}
        <span className="min-w-0 truncate font-medium">{current?.label ?? emptyText}</span>
        <ChevronsUpDown size={14} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2" />
      </button>
      {open ? (
        <div ref={pop} className="absolute left-0 top-[calc(100%+6px)] z-[60] flex max-h-[min(420px,70dvh)] flex-col overflow-hidden rounded-sm border border-line-strong bg-muted shadow-modal animate-[wFadeIn_.12s_ease_both]" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
          <input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls={`${base}-list`}
            aria-activedescendant={shown[active] ? `${base}-o-${active}` : undefined}
            aria-label={`${label}: search`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={key}
            placeholder={searchPlaceholder}
            className="h-10 w-full border-0 border-b border-line bg-transparent px-3 text-proof-body text-ink outline-none placeholder:text-ink-2"
          />
          <ul id={`${base}-list`} role="listbox" aria-label={label} className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1">
            {shown.length === 0 ? <li className="px-2.5 py-2 text-proof-small text-ink-2">Nothing matches “{q}”.</li> : null}
            {shown.map((o, i) => {
              const head = o.group && o.group !== shown[i - 1]?.group
              return (
                <li key={o.value} role="presentation">
                  {head ? <span className="eyebrow block px-2.5 pb-1 pt-2.5">{o.group}</span> : null}
                  <div
                    id={`${base}-o-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                    onPointerMove={() => setActive(i)}
                    className={`flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-proof-body ${i === active ? 'bg-glass text-ink' : 'text-ink'}`}
                  >
                    <span className="grid w-3.5 shrink-0 place-items-center text-proof-leaf">{o.value === value ? <Check size={14} strokeWidth={2} aria-hidden /> : null}</span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint ? <span className="shrink-0 font-mono text-[11px] text-ink-2">{o.hint}</span> : null}
                  </div>
                </li>
              )
            })}
          </ul>
          {footer ? <div className="border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-2">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
