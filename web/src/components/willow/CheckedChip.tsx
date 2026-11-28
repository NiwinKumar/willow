import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'

import { CHECK_WORDS, LABELS_NOTE, marketWords, noFlagsText, REGULATORY_WORDS, type CheckStatus, type ProductCheck } from '../../lib/safety'
import { Link } from 'react-router-dom'

/** Status colours from the routine-check state tokens; the meaning is always in the glyph and the words too. */
const LOOK: Record<CheckStatus, { fg: string; bg: string }> = {
  clear: { fg: 'var(--willow-700)', bg: 'rgba(79,184,102,.14)' },
  check: { fg: 'var(--state-caution-fg)', bg: 'var(--state-caution-bg)' },
  avoid: { fg: 'var(--state-avoid-fg)', bg: 'var(--state-avoid-bg)' },
  not_sold: { fg: 'var(--text-secondary)', bg: 'var(--bg-muted)' },
  unknown: { fg: 'var(--text-secondary)', bg: 'var(--bg-muted)' },
}

const POP_W = 300

/**
 * A product's check for this person, as a compact chip: glyph + words ("No flags for you", "Check this",
 * "Not advised for you", "Not sold as a cosmetic in your market", or "Not checked yet" when Willow has no
 * ingredient list for it). Hover (mouse), tap or Enter opens the
 * reasons: each flag's title, detail, source link and evidence grade, how the product is sold, and
 * "Labels can be incomplete". `loading` draws a quiet placeholder; no check and not loading draws nothing.
 * The panel stays in the chip's own tree (so it works inside a modal <dialog>) as a manual popover: shown,
 * it joins the top layer above any dialog and is fixed to the viewport, so a scroll box never clips it.
 * Browsers without popovers get the same fixed panel in place.
 */
export function CheckedChip({ check, loading = false, profileComplete = null, short = false, className = '', wordsFor }: {
  /** The chip's words in another language (a translated Wisp answer); absent: the app's own (CHECK_WORDS). */
  wordsFor?: (status: CheckStatus) => string | null | undefined
  check: ProductCheck | null | undefined
  loading?: boolean
  /** false: the check used an incomplete profile (the panel says how to finish it). */
  profileComplete?: boolean | null
  /** The shorter words, for tight rows (the panel always has the full ones). */
  short?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  // Opened by the mouse hovering: the click that follows pins it open instead of closing it.
  const hovered = useRef(false)
  const id = useId()

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(POP_W, vw - 16)
    const left = Math.max(8, Math.min(r.left, vw - w - 8))
    const h = pop.current?.offsetHeight ?? 220
    const below = r.bottom + 6 + h < vh - 8 || r.top < h + 14
    // Taller than the room on either side (a short phone screen): clamp inside the viewport, it scrolls inside.
    const top = below ? Math.min(r.bottom + 6, Math.max(8, vh - 8 - h)) : Math.max(8, r.top - 6 - h)
    setPos({ left, top, width: w })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const el = pop.current
    // Top layer first (above a modal dialog), then measure and place.
    if (el && typeof el.showPopover === 'function' && !el.matches(':popover-open')) {
      try {
        el.showPopover()
      } catch {
        /* already shown, or not connected */
      }
    }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    const close = () => setOpen(false)
    // The page scrolling closes it; scrolling the panel's own reasons (a long list on a phone) does not.
    const scrolled = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scrolled, true)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  if (!check) {
    return loading ? <span aria-hidden className={`inline-block h-[22px] w-[92px] animate-[wShimmer_1.4s_linear_infinite] rounded-pill bg-[linear-gradient(90deg,var(--bg-sunken),var(--bg-muted),var(--bg-sunken))] bg-[length:200%_100%] ${className}`} /> : null
  }

  const own = wordsFor?.(check.status)
  const words = own ? { ...CHECK_WORDS[check.status], label: own, short: own } : CHECK_WORDS[check.status]
  const look = LOOK[check.status]
  // Mouse: open on hover, close shortly after leaving the chip and its panel (so the pointer can cross the gap).
  const hover = (on: boolean) => (e: RPointerEvent) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(closeTimer.current)
    if (on) {
      if (!open) hovered.current = true
      setOpen(true)
    } else closeTimer.current = window.setTimeout(() => {
        hovered.current = false
        setOpen(false)
      }, 160)
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${words.label}. Show why`}
        onClick={(e) => {
          e.stopPropagation()
          if (hovered.current) {
            hovered.current = false
            setOpen(true)
          } else setOpen((o) => !o)
        }}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        className={`hit44 inline-flex min-h-[24px] shrink-0 items-center gap-1.5 rounded-pill py-[3px] pr-2.5 pl-1 text-[12px] leading-none whitespace-nowrap transition-[transform,box-shadow] duration-200 ease-standard active:scale-[.96] ${open ? 'shadow-[0_0_0_1.5px_currentColor]' : ''} ${className}`}
        style={{ color: look.fg, background: look.bg }}
      >
        <span aria-hidden className="grid size-[17px] place-items-center rounded-full bg-white/70 text-[10.5px] font-semibold">
          {words.glyph}
        </span>
        {short ? words.short : words.label}
      </button>
      {open ? (
            <div
              ref={pop}
              id={id}
              popover="manual"
              role="dialog"
              aria-label={words.label}
              onPointerEnter={hover(true)}
              onPointerLeave={hover(false)}
              // Clicks inside (a source link) never reach a clickable row or sheet around the chip.
              onClick={(e) => e.stopPropagation()}
              className="fixed inset-auto z-[80] m-0 block max-h-[min(420px,70dvh)] overscroll-contain border-0 animate-[wWord_.22s_var(--ease-standard)_both] overflow-y-auto rounded-[20px] bg-surface p-3.5 text-left text-[13px] leading-[1.45] text-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,.45),inset_0_0_0_1px_rgba(18,18,18,.06)]"
              style={pos ?? { left: -9999, top: 0, width: POP_W }}
            >
              <p className="m-0 flex items-center gap-2 text-[14px]" style={{ color: look.fg }}>
                <span aria-hidden className="grid size-5 place-items-center rounded-full text-[11px] font-semibold" style={{ background: look.bg }}>
                  {words.glyph}
                </span>
                {words.label}
              </p>
              {check.flags.length ? (
                <ul className="m-0 mt-2.5 flex list-none flex-col gap-2.5 p-0">
                  {check.flags.map((f) => (
                    <li key={f.rule} className="rounded-[14px] bg-sunken px-3 py-2.5">
                      <p className="m-0 flex items-baseline justify-between gap-2">
                        <span className="text-[13.5px]">{f.title}</span>
                        <span className="shrink-0 font-mono text-[10px] tracking-[.06em]" style={{ color: LOOK[f.level].fg }}>
                          {f.level === 'avoid' ? '⊘ NOT ADVISED' : '! CHECK'}
                        </span>
                      </p>
                      <p className="m-0 mt-1 text-[12.5px] text-ink-2">{f.detail}</p>
                      {f.source ? (
                        <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                          {f.source.url ? (
                            <a href={f.source.url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                              {f.source.label}
                              <span aria-hidden> ↗</span>
                            </a>
                          ) : (
                            <span className="text-ink">{f.source.label}</span>
                          )}
                          {f.grade ? <span className="rounded-pill bg-white px-1.5 py-0.5 font-mono text-[10px]">Evidence grade {f.grade}</span> : null}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-1.5 text-[12.5px] text-ink-2">{noFlagsText(check)}</p>
              )}
              {check.regulatory ? (
                <p className="m-0 mt-2.5 text-[12px] text-ink-2">
                  {REGULATORY_WORDS[check.regulatory.class]}
                  {check.regulatory.market ? ` in ${marketWords(check.regulatory.market)}` : ''}.
                </p>
              ) : null}
              {profileComplete === false && check.status !== 'unknown' ? <p className="m-0 mt-1.5 text-[12px] text-ink-2">Checked against part of your profile. Answer the questions in Build a routine for a full check.</p> : null}
              <p className="m-0 mt-2.5 border-t border-line pt-2 text-[11.5px] text-ink-2">
                {check.status === 'unknown' ? 'Checks use the ingredient list, by fixed rules from published sources, not by AI.' : `${LABELS_NOTE} Checked by fixed rules from published sources, not by AI.`}{' '}
                <Link to="/checks" className="text-ink underline underline-offset-2">
                  How we check
                </Link>
              </p>
            </div>
      ) : null}
    </>
  )
}
