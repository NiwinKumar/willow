import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import { DUR, EASE_OUT } from '../lib/motion'
import { prefs } from '../lib/prefs'

const TIPS = {
  scrub: 'Drag the handle to move through time.',
  band: 'Grey band = your normal photo-to-photo variation.',
  flicker: 'Hold the photo to flicker to your baseline.',
} as const

/** Up to three tips, once, dismissable, and only the ones that apply to what is on screen. */
export function CoachMarks({ id, tips }: { id: string; tips: (keyof typeof TIPS)[] }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(() => (prefs.coachSeen(id) ? Infinity : 0))
  const TIPS_SHOWN = tips.map((t) => TIPS[t])
  if (i >= TIPS_SHOWN.length) return null
  const next = () => {
    if (i + 1 >= TIPS_SHOWN.length) prefs.setCoachSeen(id)
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
          <span className="mr-2 font-mono text-[11px] opacity-70">{i + 1}/{TIPS_SHOWN.length}</span>
          {TIPS_SHOWN[i]}
        </span>
        <button type="button" onClick={next} aria-label={i + 1 >= TIPS_SHOWN.length ? 'Dismiss tips' : 'Next tip'} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) hover:bg-surface/10">
          {i + 1 >= TIPS_SHOWN.length ? <X size={16} aria-hidden /> : <span className="text-[13px] font-medium">Next</span>}
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
