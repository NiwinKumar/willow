import type { ReactNode } from 'react'

import { Sheet } from '../../components/ui/Sheet'
import type { RoutineEntry } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { ProductImage } from './productUi'
import { entryName, imageOf, metaLine, slotWords } from './routineModel'
import { scheduleWords } from './schedule'

/**
 * "Your products": everything in the routine now and everything stopped before, with the dates, in one sheet.
 * Tapping a product opens its information sheet. Stopped products keep their dates, so their link to the
 * readings stays.
 */
export function RoutineHistory({ open, onClose, current, stopped, onOpen }: { open: boolean; onClose: () => void; current: RoutineEntry[]; stopped: RoutineEntry[]; onOpen: (e: RoutineEntry) => void }) {
  const byStart = (a: RoutineEntry, b: RoutineEntry) => b.started_at.localeCompare(a.started_at)
  const byEnd = (a: RoutineEntry, b: RoutineEntry) => (b.ended_at ?? '').localeCompare(a.ended_at ?? '')
  return (
    <Sheet open={open} onClose={onClose} title="Your products" size="sm">
      <div className="flex flex-col gap-5">
        <Group title="In your routine" count={current.length} empty="Nothing in your routine right now.">
          {[...current].sort(byStart).map((e) => (
            <Row key={e.id} e={e} onOpen={onOpen} when={`${slotWords(e.slots)} · since ${fmtDate(e.started_at)}${e.schedule && e.schedule.kind !== 'daily' ? ` · ${scheduleWords(e.schedule, !e.slots.includes('am')).toLowerCase()}` : ''}`} />
          ))}
        </Group>
        <Group title="Stopped" count={stopped.length} empty="Nothing stopped yet. A product you stop using will be listed here.">
          {[...stopped].sort(byEnd).map((e) => (
            <Row key={e.id} e={e} onOpen={onOpen} muted when={`${fmtDate(e.started_at)} to ${fmtDate(e.ended_at!)}`} />
          ))}
        </Group>
        {stopped.length ? <p className="text-[12px] leading-[1.5] text-ink-2">Stopped products keep their dates, so their link to your readings stays.</p> : null}
      </div>
    </Sheet>
  )
}

function Group({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-baseline gap-2 text-[15px] font-normal">
        {title}
        <span className="font-mono text-[11px] tracking-[.06em] text-ink-2">{count}</span>
      </h3>
      {count ? <ul className="flex flex-col">{children}</ul> : <p className="py-2 text-[13px] text-ink-2">{empty}</p>}
    </section>
  )
}

function Row({ e, when, muted, onOpen }: { e: RoutineEntry; when: string; muted?: boolean; onOpen: (e: RoutineEntry) => void }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={() => onOpen(e)} className="flex min-h-14 w-full items-center gap-3 rounded-[14px] py-2 text-left transition-colors hover:bg-ink/5">
        <ProductImage product={imageOf(e)} size={38} muted={muted} decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14.5px]">{entryName(e)}</span>
          <span className="truncate text-[12px] text-ink-2">{metaLine(e.brand, e.category)}</span>
          <span className="truncate text-[12px] text-ink-2">{when}</span>
        </span>
      </button>
    </li>
  )
}
