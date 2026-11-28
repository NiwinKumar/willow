import { useEffect, useState } from 'react'

import { useData } from '../../data/useData'
import { api, type ChangePatterns } from '../../lib/api'
import { plural } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'

const listOf = (w: string[]) => (w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`)

/**
 * "What else moves your skin" (api GET /v1/patterns): what the person noted at their check-ins (period, stress,
 * sleep, travel…) against their readings. Code finds a pattern only with 3+ check-ins on each side and a gap beyond
 * their normal range. Without one: "No clear difference in…" when there were enough check-ins to compare, else one
 * plain line of what Willow is still learning about (no counts). Always "lines up with", never a cause.
 * Live accounts only; hidden when nothing has been noted yet or the call fails.
 */
export function PatternsCard() {
  const { getIdToken } = useAuth()
  const { mode } = useData()
  const [got, setGot] = useState<ChangePatterns | null>(null)

  useEffect(() => {
    if (mode !== 'live') return
    let alive = true
    getIdToken()
      .then((t) => api.patterns(t))
      .then((p) => alive && setGot(p))
      .catch(() => alive && setGot(null))
    return () => {
      alive = false
    }
  }, [mode, getIdToken])

  if (mode !== 'live' || !got || (!got.patterns.length && !got.same.length && !got.learning.length)) return null
  const learning = got.learning.map((l) => l.about)
  return (
    <section aria-label="What else moves your skin" className="flex flex-col gap-3 rounded-[44px] bg-surface/70 p-[clamp(22px,3vw,32px)] squircle">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-ink-2">■ WHAT ELSE MOVES YOUR SKIN</span>
        <span className="text-[14px] leading-[1.45] text-ink-2">From what you noted at {plural(got.answered, 'check-in')}.{got.patterns.length ? ' These line up with your readings; they don’t prove a cause.' : ''}</span>
      </div>
      {got.patterns.length || got.same.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {got.patterns.map((p) => (
            <li key={`${p.group}-${p.metric_id}`} className="rounded-[22px] bg-white/70 px-4 py-3 text-[15px] leading-[1.45]">
              {p.text}
            </li>
          ))}
          {got.same.map((s) => (
            <li key={s.group} className="rounded-[22px] bg-white/40 px-4 py-3 text-[15px] leading-[1.45]">
              {s.text}
            </li>
          ))}
        </ul>
      ) : null}
      {learning.length ? (
        <p className="m-0 text-[14px] leading-[1.45] text-ink-2">
          Still learning how {listOf(learning)} {learning.length === 1 ? 'lines' : 'line'} up with your skin. Keep noting them at check-ins and Willow will tell you once it can compare.
        </p>
      ) : null}
    </section>
  )
}
