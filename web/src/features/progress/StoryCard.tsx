import { useEffect, useState } from 'react'

import type { Session } from '../../data/types'
import { useData } from '../../data/useData'
import { api, type MetricStory } from '../../lib/api'
import { unitOf } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { areaStatus, productLine, productStatus, sentence, spotLine, typicalLine, type Status } from './storyParts'

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
  const m = session.result?.metrics.find((x) => x.id === metricId)
  const unit = m ? unitOf(m) : ''
  const state: 'loading' | 'ready' | 'none' = mode !== 'live' ? 'none' : got?.key !== key ? 'loading' : story ? 'ready' : 'none'
  if (state === 'none') return null
  return (
    <section aria-label="How it moved" aria-busy={state === 'loading'} className="flex flex-col gap-3 rounded-[28px] bg-sunken px-5 py-[18px]">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[17px]">How it moved</span>
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
          <StoryDetails story={story} unit={unit} />
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

const TONE: Record<Status['tone'], string> = { good: 'text-ink', away: 'text-ink', quiet: 'text-ink-2' }

function StatusText({ s }: { s: Status }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-[13px] ${TONE[s.tone]}`}>
      <span aria-hidden className={s.tone === 'good' ? 'text-[#FF6A1A]' : ''}>
        {s.glyph}
      </span>
      {s.text}
    </span>
  )
}

/**
 * The story's facts as rows: each area against the same area of your baseline (its own normal range), spots by
 * area since the last check-in, and each routine product since it started. Shown only when the api has them.
 */
function StoryDetails({ story, unit }: { story: MetricStory; unit: string }) {
  const areas = story.areas ?? []
  const spots = story.spots?.areas ?? []
  const products = story.products.filter((p) => p.since_start || p.use)
  const block = 'flex flex-col gap-2 border-t border-ink/10 pt-3'
  const head = 'text-[13px] text-ink-2'
  const row = 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[15px]'
  const num = (v: number | undefined) => (v === undefined ? '' : `${v}${unit && unit !== '°' ? (unit === '%' ? '%' : ` ${unit}`) : unit}`)
  return (
    <>
      {areas.length > 1 ? (
        <div className={block}>
          <span className={head}>By area · each against the same area at your start</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {areas.map((a) => (
              <li key={a.area} className={row}>
                <span>
                  <span>{sentence(a.label)}</span>
                  <span className="text-ink-2">
                    {' '}
                    {num(a.value)}
                    {a.baseline_value !== undefined ? ` (start ${num(a.baseline_value)})` : ''}
                  </span>
                </span>
                <StatusText s={areaStatus(a)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {spots.length ? (
        <div className={block}>
          <span className={head}>Spots by area · since your last check-in</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {spots.map((r) => (
              <li key={r.area} className="flex flex-col text-[15px]">
                <span className={row}>
                  <span>{sentence(r.label)}</span>
                  <span className="text-[13px] text-ink-2">{spotLine(r)}</span>
                </span>
                {typicalLine(r) ? <span className="text-[13px] text-ink-2">{typicalLine(r)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {products.length ? (
        <div className={block}>
          <span className={head}>Your routine for this · timing is an association, not proof</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {products.map((p) => {
              const st = productStatus(p)
              return (
                <li key={`${p.brand} ${p.name}`} className="flex flex-col gap-0.5">
                  <span className={row}>
                    <span>{`${p.brand} ${p.name}`.trim()}</span>
                    {st ? <StatusText s={st} /> : null}
                  </span>
                  <span className="text-[13px] text-ink-2">{productLine(p)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
}
