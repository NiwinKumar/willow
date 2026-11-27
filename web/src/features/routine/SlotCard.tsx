import { MoreHorizontal, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { useSetRoutineUse } from '../../data/hooks'
import type { RoutineEntry, Session } from '../../data/types'
import { ApiError, localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { METRIC_META } from '../../lib/metrics'
import { outcomeFor } from '../../lib/outcome'
import { CHANGE_WORDS } from '../../lib/verdict'
import { ProductImage } from './productUi'
import { compactName, entryName, imageOf, metaLine } from './routineModel'
import { dayNote, restsOn, scheduleWords } from './schedule'
import { verdictDue, type EvidenceClock } from './actives'
import { ProductChecked, type ChecksMap } from './checked'

const THEME = {
  am: { name: 'Morning', when: 'this morning', bg: 'radial-gradient(90% 55% at 50% 0%, #FFF6D6 0%, var(--bg-surface) 70%)', fg: 'text-ink', card: 'rgba(255,255,255,.78)', track: 'var(--bg-sunken)', chip: 'var(--bg-canvas)', line: 'rgba(18,18,18,.18)', dark: false },
  pm: { name: 'Evening', when: 'this evening', bg: 'radial-gradient(90% 55% at 50% 0%, #3A2A6E 0%, #15122A 70%)', fg: 'text-inverse', card: 'rgba(255,255,255,.07)', track: 'rgba(255,255,255,.08)', chip: 'rgba(255,255,255,.14)', line: 'rgba(255,255,255,.25)', dark: true },
} as const

/**
 * One slot of the routine as a compact list: the product's photo is its "used today" tick (full colour with ✓
 * when ticked, faded when not, fainter still on a day its schedule rests it), then its name, brand and category,
 * and only what changes how you use it today (a schedule note, or a ◆ when your readings moved after you
 * started it). Everything else about a product lives in its sheet.
 */
export function SlotCard({ slot, entries, ticked, sessions, clock = null, checks = {}, onOpen, onStop, onMore, onAdd }: { slot: 'am' | 'pm'; entries: RoutineEntry[]; ticked: (id: string) => boolean; sessions: Session[]; clock?: EvidenceClock | null; checks?: ChecksMap; onOpen: (e: RoutineEntry) => void; onStop: (e: RoutineEntry) => void; /** The row's ⋯: test it, log a reaction, details. */ onMore?: (e: RoutineEntry) => void; onAdd: () => void }) {
  const t = THEME[slot]
  const setUse = useSetRoutineUse()
  const today = localDay()

  const toggle = async (e: RoutineEntry, on: boolean) => {
    const saving = setUse(today, e.id, slot, !on)
    try {
      await saving
    } catch (err) {
      toast(err instanceof ApiError && err.status === 409 ? err.message : `Couldn't save that tick for ${entryName(e)}. Try again.`)
    }
  }

  // Today's progress counts the products due now: started, and not resting on their schedule.
  const due = entries.filter((e) => e.started_at.slice(0, 10) <= today && !restsOn(e, today))
  const done = due.filter((e) => ticked(e.id)).length

  return (
    <section aria-label={`${t.name} routine`} className={`flex flex-col gap-2 rounded-[26px] p-3 shadow-[0_30px_60px_-50px_rgba(0,0,0,.5)] squircle ${t.fg}`} style={{ background: t.bg }}>
      <div className="flex items-center justify-between gap-3 pt-1 pr-1 pl-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[22px] font-light tracking-[-0.02em]">{t.name}</h2>
          {due.length ? (
            <span className="font-mono text-[12px] opacity-75" aria-label={`${done} of ${due.length} used today`}>
              {/* the count rises into place when a tick changes it */}
              <span key={done} className="inline-block motion-safe:animate-[wRise_.32s_var(--ease-standard)_both]">{done}</span>/{due.length} today
            </span>
          ) : null}
        </div>
        <button type="button" onClick={onAdd} aria-label={`Add a product to your ${t.name.toLowerCase()} routine`} title="Add a product" className="hit44 grid size-9 place-items-center rounded-full transition-colors hover:bg-[rgba(128,128,128,.18)]" style={{ boxShadow: `inset 0 0 0 1px ${t.line}` }}>
          <Plus size={15} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      {entries.length === 0 ? (
        <button type="button" onClick={onAdd} className="min-h-[72px] rounded-[22px] border-[1.5px] border-dashed text-[15px]" style={{ borderColor: t.line }}>
          Nothing here yet · add a product
        </button>
      ) : null}
      {entries.map((e, i) => {
        const on = ticked(e.id)
        const starts = e.started_at.slice(0, 10) > today
        const o = outcomeFor(e, sessions)
        const name = entryName(e)
        const short = compactName(e)
        const rest = restsOn(e, today)
        const note = starts ? `From ${fmtDate(e.started_at)}` : dayNote(e, slot, today)
        // Evidence clock: only products with a clocked active (basics never get a verdict date).
        const due = verdictDue(e, clock)
        const dueDay = due ? localDay(due.due) : null
        const check = e.product_id ? checks[e.product_id] : undefined
        return (
          <div key={e.id} className="flex items-center gap-2.5 rounded-[20px] py-1.5 pr-1.5 pl-1.5" style={{ background: t.card, animation: `wRise .4s var(--ease-standard) ${Math.min(i, 6) * 45}ms both` }}>
            <button
              type="button"
              aria-pressed={on}
              disabled={starts}
              onClick={() => void toggle(e, on)}
              aria-label={starts ? `${name} starts ${fmtDate(e.started_at)}` : on ? `Used ${t.when}: ${name}` : `Mark as used ${t.when}: ${name}${rest ? ' (it rests today)' : ''}`}
              title={starts ? `Starts ${fmtDate(e.started_at)}` : on ? `Used ${t.when}` : rest ? 'Rests today on its schedule' : `Mark as used ${t.when}`}
              className="group relative grid size-[46px] shrink-0 place-items-center rounded-[16px] transition-transform hover:scale-[1.04] active:scale-95"
              style={{ background: t.track }}
            >
              <ProductImage product={imageOf(e)} size={34} muted={!on} rest={rest} />
              <span
                aria-hidden
                className="absolute -right-0.5 -bottom-0.5 grid size-[17px] place-items-center rounded-full bg-selected text-[9px] text-inverse transition-[opacity,scale] duration-300 ease-bounce"
                style={{ opacity: on ? 1 : 0, scale: on ? '1' : '.4', boxShadow: `0 0 0 2px ${t.dark ? '#17143D' : '#FAFAF8'}` }}
              >
                ✓
              </span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <button type="button" onClick={() => onOpen(e)} title={name} className="hit44 block max-w-full truncate text-left text-[15px] leading-[1.3] underline-offset-4 hover:underline">
                {short}
              </button>
              <span className="flex min-w-0 items-center gap-2 text-[12px] leading-[1.4]">
                <span className="truncate opacity-70">{metaLine(e.brand, e.category)}</span>
                {note ? (
                  <span className={`shrink-0 text-[11.5px] ${rest ? 'opacity-60' : ''}`} title={scheduleWords(e.schedule, !e.slots.includes('am'))}>
                    {note}
                  </span>
                ) : null}
                {o.kind === 'real' ? (
                  <span className="shrink-0 text-[11.5px]" title={`${o.text}, an association and not proof. ${o.detail}`}>
                    <span aria-hidden>{CHANGE_WORDS[o.way].glyph} </span>
                    {METRIC_META[o.metric].label}
                    <span className="sr-only">: {o.text}, an association, not proof</span>
                  </span>
                ) : null}
              </span>
              {check || dueDay ? (
                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-[1.3]">
                  {/* on the evening panel the chip's translucent colours sit on white, so they read the same as in the morning */}
                  {check ? <span className={`inline-flex rounded-pill ${t.dark ? 'bg-white' : ''}`}><ProductChecked check={check} /></span> : null}
                  {dueDay ? (
                    <span className="opacity-75" title={`A ${due!.weeks}-week window for ${due!.active.toLowerCase()}, from the start date.`}>
                      {dueDay <= today ? 'Verdict window passed' : `Verdict due ${fmtDate(dueDay)}`}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            {onMore ? (
              <button
                type="button"
                onClick={() => onMore(e)}
                aria-label={`More for ${name}: test it, log a reaction`}
                title="Test it, log a reaction"
                className="hit44 grid size-9 shrink-0 place-items-center rounded-full opacity-60 transition-[opacity,background] hover:bg-[rgba(128,128,128,.18)] hover:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onStop(e)}
              aria-label={`Stop using ${name}`}
              title="Stop using (you can undo)"
              className="hit44 grid size-9 shrink-0 place-items-center rounded-full opacity-60 transition-[opacity,background] hover:bg-[rgba(255,107,74,.18)] hover:opacity-100 focus-visible:opacity-100"
            >
              <X size={16} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
        )
      })}
    </section>
  )
}
