import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import { DUR, EASE_OUT } from '../lib/motion'
import { prefs } from '../lib/prefs'

const TIPS = ['Drag the handle to move through time.', 'Grey band = your normal photo-to-photo variation.', 'Hold the photo to flicker to your baseline.']

/** Three tips, once, dismissable. Never a tour longer than this. */
export function CoachMarks({ id }: { id: string }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(() => (prefs.coachSeen(id) ? TIPS.length : 0))
  if (i >= TIPS.length) return null
  const next = () => {
    if (i + 1 >= TIPS.length) prefs.setCoachSeen(id)
    setI(i + 1)
  }
  return (
    <AnimatePresence>
      <motion.div
        key={i}
        role="status"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DUR.base, ease: EASE_OUT }}
        className="pointer-events-auto absolute inset-x-5 bottom-[92px] z-20 flex items-center justify-between gap-3 rounded-(--radius-tile) bg-text px-3 py-2 text-[13px] text-surface shadow-lg lg:inset-x-auto lg:left-6 lg:bottom-24 lg:max-w-sm"
      >
        <span>
          <span className="mr-2 font-mono text-[11px] opacity-70">{i + 1}/{TIPS.length}</span>
          {TIPS[i]}
        </span>
        <button type="button" onClick={next} aria-label={i + 1 >= TIPS.length ? 'Dismiss tips' : 'Next tip'} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) hover:bg-surface/10">
          {i + 1 >= TIPS.length ? <X size={16} aria-hidden /> : <span className="text-[13px] font-medium">Next</span>}
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
