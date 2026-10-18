import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import type { MetricId } from '../../data/types'
import { METRIC_META } from '../../lib/metrics'

/**
 * The design's pill radiogroups: `ink` = black selected pill (site, history mode), `white` = white selected
 * pill with a soft shadow (capture mode). Arrow keys move between options.
 */
export function Pills<T extends string>({ label, options, value, onChange, tone = 'ink', size = 'md' }: { label: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; tone?: 'ink' | 'white'; size?: 'md' | 'lg' }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d || !options.length) return
    e.preventDefault()
    const el = e.currentTarget
    const i = Math.max(0, options.findIndex((o) => o.value === value))
    const next = options[(i + d + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => el.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={move} className="flex flex-wrap gap-[3px] rounded-pill bg-white/55 p-1">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === null && o === options[0]) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`hit44 rounded-pill px-3.5 whitespace-nowrap transition-[background,color] duration-200 ${size === 'lg' ? 'min-h-11 px-[18px] text-[15px]' : 'min-h-10 text-[14px]'} ${
              on ? (tone === 'ink' ? 'bg-selected text-inverse' : 'bg-white text-ink shadow-[0_1px_4px_rgba(0,0,0,.08)]') : 'text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** "← Progress / Result · 14 Oct" */
export function Crumb({ to, back, here }: { to: string; back: string; here: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 pt-1.5 text-[13px] text-ink-2">
      <Link to={to} className="flex min-h-11 items-center gap-1.5 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden>←</span>
        {back}
      </Link>
      <span aria-hidden className="opacity-50">
        /
      </span>
      <span className="text-ink">{here}</span>
    </nav>
  )
}

/** The page column every screen in this area uses (design max 1240px, fluid side padding). */
export function Page({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main aria-label={label} className="relative mx-auto flex max-w-[1240px] flex-col gap-4 px-[clamp(16px,4vw,40px)] pt-2 pb-10">
      {children}
    </main>
  )
}

/** A calm status card (still measuring, did not finish, no sessions) with one action. */
export function StatusCard({ eyebrow, title, body, action, busy }: { eyebrow: string; title: string; body: ReactNode; action?: ReactNode; busy?: boolean }) {
  return (
    <section aria-busy={busy || undefined} className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-center gap-7 overflow-hidden rounded-[44px] bg-surface p-[clamp(28px,5vw,64px)] squircle">
      <div className="flex flex-col gap-4">
        <span className="font-mono text-[12px] text-ink-2">■ {eyebrow}</span>
        <span className="text-[clamp(28px,3.4vw,44px)] leading-[1.1] tracking-[-0.02em]">{title}</span>
        <div className="max-w-[460px] leading-[1.55] text-ink-2">{body}</div>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
      <div aria-hidden className="flex justify-center gap-3">
        {['0s', '-.8s', '-1.6s', '-2.4s', '-3.2s'].map((d) => (
          <span key={d} className="h-[58px] w-11 animate-[wBreathe_4s_ease-in-out_infinite] rounded-full border-[1.5px] border-dashed border-ink/25" style={{ animationDelay: d }} />
        ))}
      </div>
    </section>
  )
}

/**
 * "Same time tomorrow?" (design tomorrow sheet), shown once after a face check-in. No reminder: Willow has
 * none to set.
 */
export function TomorrowSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
  return (
    <Sheet open={open} onClose={onClose} title="Same time tomorrow?" hideTitle variant="modal" size="sm">
      <div className="relative flex flex-col gap-[18px]">
        <span aria-hidden className="pointer-events-none absolute -top-[90px] -right-[80px] size-[220px] animate-[wBreathe_6s_ease-in-out_infinite] rounded-full opacity-75 blur-[18px]" style={{ background: 'radial-gradient(circle at 40% 40%, var(--aura-apricot), var(--aura-coral) 45%, transparent 70%)' }} />
        <span className="relative font-mono text-[11px] tracking-[.08em] text-ink-2">■ AFTER YOUR FACE PHOTO</span>
        <h2 className="relative m-0 font-serif text-[clamp(28px,3.9vw,36px)] leading-[.95] font-normal">Same time tomorrow?</h2>
        <p className="relative m-0 text-[16px] leading-[1.55] text-ink-2">The spot diary compares one day with the next, so tomorrow’s photo works best taken the same way:</p>
        <ol className="relative m-0 flex list-none flex-col gap-2 p-0">
          {['Same room and light, facing the window', 'Clean face, nothing applied', 'Hair back, face the camera straight on'].map((t, i) => (
            <li key={t} className="flex animate-[wRise_.45s_both] items-center gap-3.5 rounded-[20px] bg-sunken px-4 py-3 text-[15px]" style={{ animationDelay: `${200 + i * 80}ms` }}>
              <span aria-hidden className="font-dot text-[20px] font-extrabold">
                0{i + 1}
              </span>
              {t}
            </li>
          ))}
        </ol>
        {fine ? <p className="relative m-0 text-[13px] leading-normal text-ink-2">Phone photos work better than laptop cameras: laptop photos miss more spots, so more rows read “Not seen last time”.</p> : null}
        <Button variant="primary" size="lg" onClick={onClose} className="relative">
          See today’s report
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * Which measure the over-time chart shows: the measure's name as the title with a chevron (a native select, so
 * it is keyboard, screen-reader and phone friendly) and small previous / next arrows, instead of a pill for
 * every measure. The measures arrive in the person's goal order, so their goals are the first steps.
 */
export function MetricSwitcher({ ids, value, label, onChange }: { ids: MetricId[]; value: MetricId | null; label: string; onChange: (id: MetricId) => void }) {
  const i = value ? ids.indexOf(value) : -1
  const step = (d: number) => {
    const next = ids[i + d]
    if (next) onChange(next)
  }
  const arrow = 'hit44 grid size-9 shrink-0 place-items-center rounded-full text-white transition-colors enabled:hover:bg-white/12 disabled:opacity-30'
  return (
    <div className="flex items-center gap-1.5">
      <label className="relative flex min-w-0 items-center">
        <span className="sr-only">Measure shown over time</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value as MetricId)}
          aria-label="Measure shown over time"
          className="min-h-11 max-w-full cursor-pointer appearance-none truncate field-sizing-content rounded-pill border-0 bg-transparent py-0 pr-9 pl-0 text-[24px] font-normal text-inherit outline-offset-4"
        >
          {ids.map((id) => (
            <option key={id} value={id} className="text-ink">
              {METRIC_META[id].label}
            </option>
          ))}
          {value === null ? <option value="">{label}</option> : null}
        </select>
        <ChevronDown aria-hidden size={18} strokeWidth={1.8} className="pointer-events-none absolute right-2.5 text-white/70" />
      </label>
      <span className="ml-auto flex gap-1">
        <button type="button" onClick={() => step(-1)} disabled={i <= 0} aria-label="Previous measure" className={arrow}>
          <ChevronLeft aria-hidden size={18} strokeWidth={1.8} />
        </button>
        <button type="button" onClick={() => step(1)} disabled={i < 0 || i >= ids.length - 1} aria-label="Next measure" className={arrow}>
          <ChevronRight aria-hidden size={18} strokeWidth={1.8} />
        </button>
      </span>
    </div>
  )
}
