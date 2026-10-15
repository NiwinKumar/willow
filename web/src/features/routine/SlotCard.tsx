import { toast } from 'sonner'

import { VerdictGlyph } from '../../components/willow/Verdict'
import { useSetRoutineUse } from '../../data/hooks'
import type { RoutineEntry, Session } from '../../data/types'
import { ApiError, localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { outcomeFor } from '../../lib/outcome'
import { CategoryOrb } from './productUi'
import { activeLabel, entryName, metaLine, OUTCOME_GLYPH } from './routineModel'

const THEME = {
  am: { name: 'Morning', when: 'this morning', bg: 'radial-gradient(90% 60% at 50% 0%, #FFF6D6 0%, var(--bg-surface) 60%)', fg: 'text-ink', card: 'rgba(255,255,255,.75)', track: 'var(--bg-sunken)', chip: 'var(--bg-canvas)', line: 'rgba(18,18,18,.18)', dark: false },
  pm: { name: 'Evening', when: 'this evening', bg: 'radial-gradient(90% 60% at 50% 0%, #3A2A6E 0%, #15122A 60%)', fg: 'text-inverse', card: 'rgba(255,255,255,.07)', track: 'rgba(255,255,255,.08)', chip: 'rgba(255,255,255,.14)', line: 'rgba(255,255,255,.25)', dark: true },
} as const

/**
 * One slot of the routine (design: Morning light card, Evening dark card). The product's orb is its
 * "used today" tick, as on Home: full colour with ✓ when ticked, faded when not.
 */
export function SlotCard({ slot, entries, ticked, sessions, faceMeasured, onOpen, onStop, onAdd }: { slot: 'am' | 'pm'; entries: RoutineEntry[]; ticked: (id: string) => boolean; sessions: Session[]; faceMeasured: boolean; onOpen: (e: RoutineEntry) => void; onStop: (e: RoutineEntry) => void; onAdd: () => void }) {
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

  return (
    <section aria-label={`${t.name} routine`} className={`flex flex-col gap-3 rounded-[34px] p-[clamp(14px,2vw,20px)] shadow-[0_40px_80px_-60px_rgba(0,0,0,.5)] squircle ${t.fg}`} style={{ background: t.bg }}>
      <div className="flex items-baseline justify-between gap-3 px-2 pt-1.5 pb-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-[26px] font-light tracking-[-0.02em]">{t.name}</h2>
          {entries.length ? <span className="text-[12px] opacity-75">Tap a circle when you use it</span> : null}
        </div>
        <span className="font-dot text-[28px] font-extrabold" aria-label={`${entries.length} products`}>
          {String(entries.length).padStart(2, '0')}
        </span>
      </div>
      {entries.length === 0 ? (
        <button type="button" onClick={onAdd} className="min-h-[110px] rounded-[30px] border-[1.5px] border-dashed text-[15px]" style={{ borderColor: t.line }}>
          Nothing here yet · add a product
        </button>
      ) : null}
      {entries.map((e) => {
        const on = ticked(e.id)
        const starts = e.started_at.slice(0, 10) > today
        const o = outcomeFor(e, sessions)
        // Until any face photo is measured, one page note says so instead of "Not measured yet" on every row.
        const showOutcome = faceMeasured || o.text !== 'Not measured yet'
        const name = entryName(e)
        return (
          <div key={e.id} className="flex items-center gap-3 rounded-[30px] p-3 sm:gap-4 sm:p-3.5" style={{ background: t.card, animation: 'wRise .45s both' }}>
            <button
              type="button"
              aria-pressed={on}
              disabled={starts}
              onClick={() => void toggle(e, on)}
              aria-label={starts ? `${name} starts ${fmtDate(e.started_at)}` : on ? `Used ${t.when}: ${name}` : `Mark as used ${t.when}: ${name}`}
              title={starts ? `Starts ${fmtDate(e.started_at)}` : on ? `Used ${t.when}` : `Mark as used ${t.when}`}
              className="group relative grid size-16 shrink-0 place-items-center rounded-[22px] transition-transform hover:scale-[1.04] active:scale-95 sm:size-[84px] sm:rounded-[26px]"
              style={{ background: t.track }}
            >
              <span className="sm:hidden">
                <CategoryOrb category={e.category} size={44} muted={!on} />
              </span>
              <span className="hidden sm:block">
                <CategoryOrb category={e.category} size={56} muted={!on} />
              </span>
              <span
                aria-hidden
                className="absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-selected text-[10px] text-inverse transition-[opacity,scale] duration-300 ease-bounce sm:right-2.5 sm:bottom-2.5"
                style={{ opacity: on ? 1 : 0, scale: on ? '1' : '.4', boxShadow: `0 0 0 2px ${t.dark ? '#17143D' : '#FAFAF8'}` }}
              >
                ✓
              </span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-[13px] opacity-75">{metaLine(e.brand, e.category)}</span>
              <button type="button" onClick={() => onOpen(e)} className="text-left text-[17px] leading-[1.25] underline-offset-4 hover:underline sm:text-[18px]">
                {name}
              </button>
              <span className="flex flex-wrap gap-[5px]">
                {e.key_actives.slice(0, 3).map((a) => (
                  <span key={a.name} className="rounded-pill bg-lime px-2.5 py-1 text-[12px] text-ink">
                    {activeLabel(a)}
                  </span>
                ))}
                <span className="rounded-pill px-2.5 py-1 text-[12px]" style={{ background: t.chip }}>
                  {starts ? 'from' : 'since'} {fmtDate(e.started_at)}
                </span>
                {e.recent_use ? (
                  <span className="rounded-pill px-2.5 py-1 text-[12px]" style={{ background: t.chip }} title="From your ticks over the last two weeks">
                    used {e.recent_use.days_used} of {e.recent_use.of_days} days
                  </span>
                ) : null}
              </span>
              {showOutcome ? (
                <span className="flex flex-col gap-0.5 text-[13px] leading-[1.4]">
                  <span className="flex items-center gap-1.5 opacity-90">
                    <VerdictGlyph kind={OUTCOME_GLYPH[o.kind]} onDark={t.dark} />
                    {o.text}
                    {o.kind === 'real' ? ' · an association, not proof' : ''}
                  </span>
                  <span className="text-[12px] opacity-70">{o.detail}</span>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onStop(e)}
              aria-label={`Stop using ${name}`}
              title="Stop using (you can undo)"
              className="grid size-11 shrink-0 place-items-center self-start rounded-full border transition-colors hover:bg-[rgba(255,107,74,.18)]"
              style={{ borderColor: t.line }}
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
        )
      })}
    </section>
  )
}
