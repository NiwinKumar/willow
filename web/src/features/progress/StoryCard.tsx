import { useEffect, useState } from 'react'

import type { Session } from '../../data/types'
import { useData } from '../../data/useData'
import { api, type MetricStory } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'

/**
 * "What changed" for one metric, in points (api GET /v1/sessions/{id}/story/{metric}): Gemini reads the metric's
 * whole history and the routine products aimed at it and writes how it looked before, what changed and how often
 * each product was used, plus up to two possible reasons; every number is checked against the measurements. Live
 * accounts only (sample data has no stories); hidden when it fails.
 */
export function StoryCard({ session, metricId }: { session: Session; metricId: string }) {
  const { getIdToken } = useAuth()
  const { mode } = useData()
  const key = `${session.id}/${metricId}`
  // The answer for one session and metric; anything else (a different key) means still loading.
  const [got, setGot] = useState<{ key: string; story: MetricStory | null } | null>(null)

  useEffect(() => {
    if (mode !== 'live') return
    let alive = true
    getIdToken()
      .then((t) => api.metricStory(t, session.id, metricId))
      .then((story) => alive && setGot({ key, story }))
      .catch(() => alive && setGot({ key, story: null }))
    return () => {
      alive = false
    }
  }, [mode, getIdToken, session.id, metricId, key])

  const story = got?.key === key ? got.story : null
  const state: 'loading' | 'ready' | 'none' = mode !== 'live' ? 'none' : got?.key !== key ? 'loading' : story ? 'ready' : 'none'
  if (state === 'none') return null
  return (
    <section aria-label="What changed" aria-busy={state === 'loading'} className="flex flex-col gap-3 rounded-[28px] bg-sunken px-5 py-[18px]">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[17px]">What changed</span>
        {story?.source === 'gemini' ? <span className="font-mono text-[11px] tracking-[.04em] text-ink-2 uppercase">AI-written · numbers checked against your measurements</span> : null}
      </span>
      {state === 'loading' ? (
        <span className="text-[14px] text-ink-2">Comparing with your last check-in…</span>
      ) : story ? (
        <>
          <ul className="m-0 flex flex-col gap-2 pl-5 text-[15px] leading-[1.5]">
            {story.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {story.reasons.length ? (
            <div className="flex flex-col gap-1.5 border-t border-ink/10 pt-3">
              <span className="text-[13px] text-ink-2">Possible reasons · not a diagnosis</span>
              {story.reasons.map((r) => (
                <p key={r} className="m-0 text-[15px] leading-[1.5]">
                  {r}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
