import { useEffect, useState } from 'react'

import { useData } from '../../data/useData'
import { api, type ChangePatterns } from '../../lib/api'
import { plural } from '../../lib/format'
import { useAuth } from '../../lib/useAuth'

/**
 * "What else moves your skin" (api GET /v1/patterns): what the person noted at their check-ins (period, stress,
 * sleep, travel…) against their readings. Code finds a pattern only with 3+ check-ins on each side and a gap beyond
 * their normal range; until then it says how many more noted weeks it needs. Always "lines up with", never a cause.
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

  if (mode !== 'live' || !got || (!got.patterns.length && !got.building.length)) return null
  return (
    <section aria-label="What else moves your skin" className="flex flex-col gap-3 rounded-[44px] bg-surface/70 p-[clamp(22px,3vw,32px)] squircle">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-ink-2">■ WHAT ELSE MOVES YOUR SKIN</span>
        <span className="text-[14px] leading-[1.45] text-ink-2">From what you noted at {plural(got.answered, 'check-in')}. These line up with your readings; they don’t prove a cause.</span>
      </div>
      {got.patterns.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {got.patterns.map((p) => (
            <li key={`${p.group}-${p.metric_id}`} className="rounded-[22px] bg-white/70 px-4 py-3 text-[15px] leading-[1.45]">
              {p.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[15px] leading-[1.45]">No clear pattern yet.</p>
      )}
      {got.building.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-[1.45] text-ink-2">
          {got.building.map((b) => (
            <li key={b.group}>
              {b.need ? `${b.about[0].toUpperCase()}${b.about.slice(1)}: noted ${plural(b.noted, 'time')}, ${b.need} more to compare.` : `${b.about[0].toUpperCase()}${b.about.slice(1)}: no clear difference so far.`}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
