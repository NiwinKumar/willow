import { useState } from 'react'

import { Sheet } from '../../components/ui/Sheet'
import { useOwner } from '../../data/hooks'
import type { Session } from '../../data/types'
import { ChangesPanel } from '../checkin/ChangesPanel'

/**
 * On the day's result, under the verdicts: what the person said was different since their last check-in ("This
 * week: had a period, slept badly"), so a reading that moved is read in context. The owner can add or edit it; a
 * check-in without an answer asks once, plainly.
 */
export function ChangesRow({ session }: { session: Session }) {
  const owner = useOwner()
  const [open, setOpen] = useState(false)
  const c = session.changes
  if (!c && !owner) return null
  const said = c ? (c.nothing ? 'Nothing different' : [...c.words, ...(c.other ? [`“${c.other}”`] : [])].join(' · ')) : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[22px] bg-white/55 px-4 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12px] text-ink-2">Since your last check-in</span>
        <span className="text-[14.5px] leading-[1.4]">{said ?? 'What was different? Sleep, stress, your cycle, travel, food…'}</span>
      </span>
      {owner ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-pill bg-white px-3.5 text-[13.5px] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {c ? 'Edit' : 'Add what changed'}
        </button>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="What changed" variant="modal" size="md">
        {open ? <ChangesPanel sessionId={session.id} edit onDone={() => setOpen(false)} onSkip={() => setOpen(false)} /> : null}
      </Sheet>
    </div>
  )
}
