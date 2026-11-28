import { useNavigate } from 'react-router-dom'
import { ArrowRight, Lightbulb } from 'lucide-react'

import { LogoMark } from '../../components/willow/Logo'
import { ProductImage } from '../../components/willow/ProductImage'
import type { RoutineEntry } from '../../data/types'
import { imageOf } from '../routine/routineModel'
import { dayNote, restsOn } from '../routine/schedule'
import { isSample } from '../routine/actives'
import { orbColours, shortName } from './derive'
import { HomeCard } from './cards'
import { Pill } from './parts'

type Slot = 'am' | 'pm'

const PANEL: Record<Slot, { name: string; bg: string; fg: string; line: string; ring: string; badgeRing: string }> = {
  am: {
    name: 'Morning',
    bg: 'radial-gradient(90% 100% at 50% 0%, #FFF3A8 0%, transparent 62%), radial-gradient(80% 90% at 100% 100%, #FFD9C2 0%, transparent 70%), #F6F3EC',
    fg: 'text-ink',
    line: 'rgba(18,18,18,.14)',
    ring: 'rgba(18,18,18,.18)',
    badgeRing: '#F6F3EC',
  },
  pm: {
    name: 'Evening',
    bg: 'radial-gradient(90% 100% at 50% 0%, #4A3FB0 0%, transparent 65%), radial-gradient(70% 80% at 0% 100%, rgba(242,95,168,.45) 0%, transparent 70%), #17143D',
    fg: 'text-inverse',
    line: 'rgba(255,255,255,.2)',
    ring: 'rgba(255,255,255,.5)',
    badgeRing: '#17143D',
  },
}

/**
 * How a slot's products fit its panel: up to four share one row; more wrap into two (three past ten) so the
 * card keeps the height of its neighbour however many products are added, and the orbs shrink with the columns.
 * Past ten the names drop (they stay in the tooltip and the accessible label) so three rows still fit.
 */
function fit(n: number): { rows: number; cols: number; px: number } {
  const rows = n <= 4 ? 1 : n <= 10 ? 2 : 3
  const cols = Math.max(1, Math.ceil(n / rows))
  const px = rows === 3 ? 32 : cols <= 3 ? 48 : cols === 4 ? 42 : 36
  return { rows, cols, px }
}

/**
 * Routine today: the products in today's morning and evening routine, as their photos (or orbs for products
 * without one). Tapping one ticks it as used today (saved to the api, optimistic). A product its schedule
 * rests today is drawn fainter with "RESTS ☾" and is not counted as due. A dashed Sunscreen slot appears only
 * when the routine check found that gap; the conflict chip is the check's first finding.
 */
/** "Alternate nights for Retinol and Skin Perfecting"; without a short fix, "Retinol and Skin Perfecting: see how to pair them". */
function tipText(c: { names: string[]; fix: string | null }): string {
  const names = c.names.length > 1 ? `${c.names.slice(0, -1).join(', ')} and ${c.names.at(-1)}` : (c.names[0] ?? '')
  return c.fix ? `${c.fix.charAt(0).toUpperCase()}${c.fix.slice(1)} for ${names}` : `${names}: see how to pair them`
}

export function RoutineToday({ am, pm, used, onToggle, missingSunscreen, conflict, onRoutine, className }: {
  am: RoutineEntry[]
  pm: RoutineEntry[]
  used: (entryId: string, slot: Slot) => boolean
  onToggle: (entry: RoutineEntry, slot: Slot, on: boolean) => void
  missingSunscreen: boolean
  conflict: { names: string[]; fix: string | null; title: string } | null
  onRoutine: () => void
  className?: string
}) {
  const navigate = useNavigate()
  // The guest starter routine (api demo.py marks it): say so, and offer a real one.
  const sample = [...am, ...pm].some(isSample)
  return (
    <HomeCard label="Routine today" className={`gap-3 p-4 ${className ?? ''}`} delay={160}>
      {/* Title and hint on the left; the routine check's first finding as quiet text in the right corner. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h2 className="m-0 text-h3 font-normal">Routine today</h2>
          <span className="text-caption text-ink-2">Tap a product when you use it</span>
        </div>
        {conflict ? (
          // The routine check's first finding, said as the tip it is ("Alternate nights for Retinol and Skin
          // Perfecting"): two products that are better not used together, and how to space them.
          <button type="button" onClick={onRoutine} title={conflict.title} className="hit44 flex items-center gap-1.5 rounded-pill bg-sunken px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-muted sm:ml-auto">
            <Lightbulb size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-ink-2" />
            <span className="text-pretty"><span className="sr-only">Routine tip: </span>{tipText(conflict)}</span>
          </button>
        ) : null}
      </div>
      {sample ? (
        // The guest starter routine, said kindly and with the way out: a soft aura card (the app's own hues, not a
        // warning colour), a Willow bud, and the one action on the right.
        <button
          type="button"
          onClick={() => navigate('/plan')}
          className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[22px] py-2.5 pr-2.5 pl-3 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,.7),0_10px_24px_-18px_rgba(122,92,255,.45)] transition-[scale,box-shadow] duration-200 ease-standard hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,.9),0_14px_28px_-16px_rgba(122,92,255,.5)] active:scale-[.985]"
          style={{ background: 'linear-gradient(115deg, #FFF0E4 0%, #FCE8F3 48%, #ECE6FF 100%)', animation: 'wRise .5s .2s both' }}
        >
          <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,.9)] transition-transform duration-300 ease-standard group-hover:-translate-y-0.5">
            <LogoMark size={26} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-medium text-ink">This is a sample</span>
            <span className="text-[12.5px] leading-[1.4] text-ink-2 text-pretty">Let Willow build yours</span>
          </span>
          <span className="flex min-h-10 items-center gap-1.5 rounded-pill bg-selected px-3.5 text-[13px] text-inverse transition-[gap] duration-200 ease-standard group-hover:gap-2">
            Build mine
            <ArrowRight size={14} strokeWidth={1.8} aria-hidden />
          </span>
        </button>
      ) : null}
      <div className="flex flex-1 flex-wrap gap-2.5">
        {(['am', 'pm'] as const).map((slot) => {
          const list = slot === 'am' ? am : pm
          const p = PANEL[slot]
          const ticked = list.filter((e) => used(e.id, slot)).length
          // Due today: everything not resting on its schedule (a resting product used anyway counts too).
          const due = list.filter((e) => !restsOn(e) || used(e.id, slot)).length
          const { rows, cols, px } = fit(list.length + (slot === 'am' && missingSunscreen ? 1 : 0))
          return (
            <div key={slot} className={`relative flex min-w-0 flex-[1_1_250px] flex-col gap-2.5 overflow-hidden rounded-[24px] squircle px-3.5 pt-3.5 pb-3 ${p.fg}`} style={{ background: p.bg }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="font-dot text-[17px]" aria-label={`${ticked} of ${due} used today`}>
                  {ticked}/{due}
                </span>
              </div>
              {list.length === 0 && !(slot === 'am' && missingSunscreen) ? (
                <button type="button" onClick={onRoutine} className="min-h-11 self-start text-left text-[13px] underline-offset-4 hover:underline">
                  Nothing in your {slot === 'am' ? 'morning' : 'evening'} routine yet
                </button>
              ) : (
                <div className="relative my-auto grid justify-items-center gap-x-1 gap-y-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {rows === 1 ? <span aria-hidden className="absolute h-[1.5px]" style={{ background: p.line, top: px / 2 - 1, left: `${50 / cols}%`, right: `${50 / cols}%` }} /> : null}
                  {list.map((e) => (
                    <Orb key={e.id} entry={e} slot={slot} on={used(e.id, slot)} px={px} named={rows < 3} ring={p.ring} badgeRing={p.badgeRing} onToggle={(on) => onToggle(e, slot, on)} />
                  ))}
                  {slot === 'am' && missingSunscreen ? (
                    <button type="button" onClick={onRoutine} aria-label="Sunscreen missing in Morning. Find one" title="Add a sunscreen" className="relative flex w-full min-w-0 flex-col items-center gap-1.5 p-0 text-inherit">
                      <span aria-hidden className="grid place-items-center rounded-full border-[1.5px] border-dashed border-ink/35 bg-white/50 text-[16px]" style={{ width: px, height: px }}>
                        +
                      </span>
                      <span className="text-center text-[11px] leading-[1.2]">Sunscreen</span>
                      <span className="text-[10.5px] leading-none opacity-75">Missing</span>
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </HomeCard>
  )
}

function Orb({ entry, slot, on, px, named, ring, badgeRing, onToggle }: { entry: RoutineEntry; slot: Slot; on: boolean; px: number; named: boolean; ring: string; badgeRing: string; onToggle: (on: boolean) => void }) {
  const [c0, c1, c2] = orbColours(entry)
  const full = [entry.custom_name, entry.brand].filter(Boolean).join(' · ')
  const rest = restsOn(entry)
  const note = dayNote(entry, slot)
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      aria-label={`${on ? 'Used today' : 'Mark used today'}: ${full}${rest && !on ? ' (rests today)' : ''}`}
      title={full}
      className="group relative flex w-full min-w-0 flex-col items-center gap-1.5 p-0 text-inherit"
    >
      <span
        aria-hidden
        className="relative rounded-full transition-[box-shadow,scale] duration-[350ms] ease-bounce group-hover:scale-[1.08] group-active:scale-[.92]"
        style={{ width: px, height: px, outline: `1.5px solid ${on ? ring : 'transparent'}`, outlineOffset: 3 }}
      >
        <ProductImage
          product={imageOf(entry)}
          size={px}
          muted={!on}
          rest={rest}
          fallback={
            <span
              className="block rounded-full transition-[opacity,filter,box-shadow] duration-[350ms]"
              style={{
                width: px,
                height: px,
                background: `radial-gradient(circle at 34% 28%, #FFFFFF 0%, ${c0} 34%, ${c1} 72%, ${c2} 100%)`,
                opacity: on ? 1 : rest ? 0.32 : 0.55,
                filter: on ? 'none' : 'saturate(.35)',
                boxShadow: on ? `0 12px 22px -8px ${c1}` : 'none',
              }}
            />
          }
        />
        <span
          className="absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-selected text-[9px] text-inverse transition-[opacity,scale] duration-[400ms] ease-bounce"
          style={{ width: Math.max(14, Math.round(px * 0.4)), height: Math.max(14, Math.round(px * 0.4)), boxShadow: `0 0 0 2px ${badgeRing}`, opacity: on ? 1 : 0, scale: on ? '1' : '.4' }}
        >
          ✓
        </span>
      </span>
      {named ? <span className={`line-clamp-2 text-center leading-[1.2] ${px >= 42 ? 'text-[11.5px]' : 'text-[10.5px]'}`}>{shortName(entry)}</span> : null}
      {note && named ? <span className="min-h-[11px] font-mono text-[9.5px] tracking-[.05em] opacity-75">{note}</span> : null}
    </button>
  )
}

/**
 * No products yet: the design's "Add your routine" card. Above the words, a faint preview of what will be here
 * (three empty product rings on the morning line, as Routine today draws them), so the empty card says what it
 * becomes instead of standing blank.
 * Four tests: it shows the shape of the tracker before it exists (1); dashed rings read as "empty slots" (2); it
 * is behind nothing and takes no clicks (3); the same rings, line and type as the filled card (4).
 */
export function RoutineEmpty({ onRoutine, className }: { onRoutine: () => void; className?: string }) {
  const navigate = useNavigate()
  return (
    <HomeCard label="Routine" className={`justify-between gap-5 ${className ?? ''}`} delay={160}>
      <div aria-hidden className="relative mx-auto grid w-full max-w-[300px] flex-1 grid-cols-3 place-items-center content-center gap-y-2 pt-2">
        <span className="absolute top-[calc(50%-11px)] right-[16.6%] left-[16.6%] h-[1.5px] bg-[repeating-linear-gradient(90deg,rgba(18,18,18,.18)_0_4px,transparent_4px_8px)]" />
        {['Cleanse', 'Treat', 'Protect'].map((t, i) => (
          <span key={t} className="relative flex animate-[wRise_.5s_both] flex-col items-center gap-1.5" style={{ animationDelay: `${260 + i * 70}ms` }}>
            <span className="grid size-11 place-items-center rounded-full border-[1.5px] border-dashed border-ink/25 bg-surface text-[15px] text-ink/35">+</span>
            <span className="text-[11.5px] text-ink-2">{t}</span>
          </span>
        ))}
      </div>
      <div className="flex max-w-[380px] flex-col gap-1">
        <h2 className="m-0 text-h3 font-normal">Add your routine</h2>
        <span className="text-[13px] leading-[1.45] text-ink-2">Add what you use, or let Willow build a three-step routine around your skin and budget, every product checked for you.</span>
      </div>
      <span className="flex flex-wrap gap-2">
        <Pill onClick={() => navigate('/plan')}>Build me a routine</Pill>
        <button type="button" onClick={onRoutine} className="min-h-11 rounded-pill px-3 text-[14px] text-ink-2 underline underline-offset-4 transition-colors hover:text-ink">
          Add a product
        </button>
      </span>
    </HomeCard>
  )
}
