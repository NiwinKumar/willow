import { useState } from 'react'

import type { RoutineEntry } from '../../data/types'
import { shortName } from '../home/derive'
import { ProductImage } from './productUi'
import { imageOf, type Finding } from './routineModel'
import { alternatesWith, restsOn } from './schedule'

/**
 * The routine check's aura cards, shared by Routine ("Suggested today") and Home (the routine check card):
 * tonight's alternating pair, a missing step, and two products that are best kept apart.
 */

export const CHECK_CARD = 'relative isolate flex min-h-[230px] flex-[1_1_260px] flex-col gap-3 overflow-hidden rounded-[32px] p-5 squircle'

export type Tonight = { on: RoutineEntry; off: RoutineEntry; done: boolean; finding?: Finding }

/**
 * Tonight's pair: two evening products already alternating (done), else the first conflict the check says to
 * alternate. In a new pair the product not used last night goes tonight.
 */
export function tonightOf(findings: Finding[], entries: RoutineEntry[], usedLastNight: (id: string) => boolean): Tonight | null {
  const pm = entries.filter((e) => e.slots.includes('pm') && !e.ended_at)
  for (const a of pm)
    for (const b of pm)
      if (a.id < b.id && alternatesWith(a, b)) {
        const [on, off] = restsOn(a) ? [b, a] : [a, b]
        return { on, off, done: true }
      }
  const f = findings.find((x) => x.kind === 'Conflict' && x.alternate && x.entries.length === 2 && x.entries.every((e) => e.slots.includes('pm')))
  if (!f) return null
  const [a, b] = f.entries
  const [on, off] = usedLastNight(b.id) && !usedLastNight(a.id) ? [a, b] : [b, a]
  return { on, off, done: false, finding: f }
}

const INDIGO = '#1A1745'

/** "■ TONIGHT": which of the pair goes tonight and which rests, with the one-tap "Alternate nights" fix. */
export function TonightCard({ tonight, usedLastNight, onAlternate, onAsk, className = '', delay = 0 }: {
  tonight: Tonight
  usedLastNight: (id: string) => boolean
  onAlternate: (on: RoutineEntry, off: RoutineEntry) => Promise<void>
  onAsk?: () => void
  className?: string
  delay?: number
}) {
  const [busy, setBusy] = useState(false)
  const { on, off, done, finding } = tonight
  const alternate = async () => {
    setBusy(true)
    try {
      await onAlternate(on, off)
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      className={`${CHECK_CARD} text-inverse ${className}`}
      style={{ background: `radial-gradient(90% 80% at 80% 0%, #6B5BFF 0%, transparent 60%), radial-gradient(70% 70% at 0% 100%, #F25FA8 0%, transparent 65%), ${INDIGO}`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -30px 60px rgba(122,92,255,.25), 0 30px 60px -40px rgba(29,35,122,.8)', animation: `wRise .5s ${delay}s both` }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <span aria-hidden className="relative h-[58px] w-[84px]">
          <span className="absolute top-0 left-0 motion-safe:animate-breathe">
            <ProductImage product={imageOf(on)} size={56} />
          </span>
          <span className="absolute top-[18px] left-[44px] rounded-full shadow-[0_0_0_2px_#1A1745]">
            <ProductImage product={imageOf(off)} size={38} muted rest />
          </span>
          <span className="absolute top-3 left-[66px] grid size-[18px] place-items-center rounded-full bg-[#1A1745] text-[10px]">☾</span>
        </span>
        <span className="font-mono text-[10.5px] tracking-[.08em] text-[#C9CFFF]">■ TONIGHT</span>
      </div>
      <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">{done ? `${shortName(on)} tonight. ${shortName(off)} rests.` : `${shortName(on)} and ${shortName(off)} on the same night.`}</span>
      <span className="text-[12.5px] leading-[1.45] text-pretty text-[#D5D8FF]">
        {done
          ? `${usedLastNight(off.id) ? `You used ${shortName(off).toLowerCase()} last night. ` : ''}Alternating the two lowers the chance of irritation.`
          : `${finding?.title ?? ''} Alternating nights lowers the chance of irritation: ${shortName(on).toLowerCase()} tonight, ${shortName(off).toLowerCase()} tomorrow.`}
      </span>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {done ? (
          <span className="inline-flex min-h-9 items-center rounded-pill bg-white/15 px-3.5 text-[13px]">✓ Alternating nights</span>
        ) : (
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => void alternate()} className="min-h-11 rounded-pill bg-white/92 px-4 text-[13px] text-ink transition-transform hover:-translate-y-px disabled:opacity-60">
            {busy ? 'Saving…' : 'Alternate nights'}
          </button>
        )}
        {onAsk ? (
          <button type="button" onClick={onAsk} className="min-h-11 rounded-pill bg-white/15 px-4 text-[13px] transition-colors hover:bg-white/25">
            Ask Wisp
          </button>
        ) : null}
      </div>
    </article>
  )
}

const PEACH = { background: 'radial-gradient(90% 90% at 100% 0%, #FFF3A8 0%, transparent 60%), radial-gradient(80% 80% at 0% 100%, #FFB27A 0%, transparent 65%), #FFE2CF', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 30px 60px -44px rgba(255,107,74,.6)' }

/** "■ MISSING STEP": a gap in the routine, with a way to find a product that fills it. */
export function GapCard({ finding, onFind, onAsk, className = '', delay = 0 }: { finding: Finding; onFind: () => void; onAsk?: () => void; className?: string; delay?: number }) {
  const sun = finding.find?.category === 'sunscreen'
  return (
    <article className={`${CHECK_CARD} text-ink ${className}`} style={{ ...PEACH, animation: `wRise .5s ${delay}s both` }}>
      <div className="flex items-start justify-between gap-2.5">
        <span aria-hidden className="relative grid size-[58px] place-items-center rounded-full border-[1.5px] border-dashed border-ink/40 bg-white/35 font-mono text-[11px] tracking-[.06em]">
          <span className="absolute -inset-[9px] -z-10 rounded-full motion-safe:animate-breathe" style={{ background: 'radial-gradient(circle, rgba(255,243,168,.9), transparent 70%)' }} />
          {sun ? 'SPF' : '+'}
        </span>
        <span className="font-mono text-[10.5px] tracking-[.08em]">■ {sun ? 'MORNING · MISSING' : 'MISSING STEP'}</span>
      </div>
      <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">{sun ? 'Add a sunscreen to your mornings.' : finding.title}</span>
      <span className="text-[12.5px] leading-[1.45] text-pretty text-[#3E3C38]">{finding.fix}</span>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onFind} className="min-h-11 rounded-pill bg-selected px-4 text-[13px] text-inverse transition-transform hover:-translate-y-px">
          Find one
        </button>
        {onAsk ? (
          <button type="button" onClick={onAsk} className="min-h-11 rounded-pill bg-white/60 px-4 text-[13px] transition-colors hover:bg-white/85">
            Ask Wisp
          </button>
        ) : null}
      </div>
    </article>
  )
}

/** "■ KEEP APART" / "■ WORTH KNOWING": two products the check says do not suit each other, shown side by side. */
export function ApartCard({ finding, onRoutine, onAsk, className = '', delay = 0 }: { finding: Finding; onRoutine: () => void; onAsk?: () => void; className?: string; delay?: number }) {
  const [a, b] = finding.entries
  const info = finding.severity === 'Low'
  return (
    <article className={`${CHECK_CARD} text-ink ${className}`} style={{ ...PEACH, animation: `wRise .5s ${delay}s both` }}>
      <div className="flex items-start justify-between gap-2.5">
        <span aria-hidden className="flex items-center">
          {a ? <ProductImage product={imageOf(a)} size={52} /> : null}
          {b ? (
            <span className="-ml-3 rounded-full shadow-[0_0_0_2px_#FFE2CF]">
              <ProductImage product={imageOf(b)} size={52} />
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[10.5px] tracking-[.08em]">■ {info ? 'WORTH KNOWING' : 'KEEP APART'}</span>
      </div>
      <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">{finding.title}</span>
      <span className="text-[12.5px] leading-[1.45] text-pretty text-[#3E3C38]">{finding.fix}</span>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onRoutine} className="min-h-11 rounded-pill bg-selected px-4 text-[13px] text-inverse transition-transform hover:-translate-y-px">
          Look at routine
        </button>
        {onAsk ? (
          <button type="button" onClick={onAsk} className="min-h-11 rounded-pill bg-white/60 px-4 text-[13px] transition-colors hover:bg-white/85">
            Ask Wisp
          </button>
        ) : null}
      </div>
    </article>
  )
}
