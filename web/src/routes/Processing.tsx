import { Check, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Button } from '../components/Button'
import { DemoBar } from '../components/DemoBar'
import { Stage } from '../components/Stage'
import { toSession } from '../data/live'
import type { Session, Site } from '../data/types'
import { useData } from '../data/useData'
import { ApiError, api, type SessionView } from '../lib/api'
import { QUALITY_COPY } from '../lib/metrics'
import { DUR, EASE_OUT } from '../lib/motion'
import { useAuth } from '../lib/useAuth'
import { DEMO_SERIES } from '../mock/series'

const LABELS = ['Checking photo quality', 'Correcting colours', 'Measuring', 'Explaining']

/** What each stage turned out to be, written from the real result. */
function outcomes(view: SessionView): string[] {
  const r = view.result
  if (!r) return LABELS
  const q = r.quality
  const quality = q.passed ? `${r.frames_used} of ${view.session.n_frames} frames passed` : (q.reasons.map((x) => QUALITY_COPY[x]?.text).filter(Boolean)[0] ?? 'Photo quality too low to compare')
  const colour =
    r.capture_mode === 'uncalibrated'
      ? 'No colour card: results are a trend'
      : q.card_detected
        ? `Colour card found${q.card_delta_e_mean != null ? `, ΔE ${q.card_delta_e_mean}` : ''}`
        : 'Colour card not found'
  const first = r.metrics.every((m) => m.verdict === 'no_baseline')
  const count = `${r.metrics.length} ${r.metrics.length === 1 ? 'metric' : 'metrics'}`
  const measured = first ? `${count}, your first reading` : `${count} against your baseline`
  const explained = view.session.explanation_source === 'gemini' ? 'Numbers verified, nothing invented' : 'Written from your numbers'
  return [quality, colour, measured, explained]
}

const ERROR_COPY: Record<string, string> = {
  frames_missing: 'Some photos have not finished uploading. Go back and let the upload finish.',
  engine_timeout: 'The measurement took too long. Your photos are safe; try again.',
  engine_unreachable: 'The measurement service did not answer. Your photos are safe; try again.',
  frame_unreadable: 'One of the files could not be read. Check that it is the original DNG or JPEG.',
  unsupported_format: 'One of the files is in a format Willow cannot read.',
}

/**
 * Lab-notebook processing: frames arrive on the stage, each stage label morphs into its result.
 * Live: POST /v1/sessions/{id}/analyze, then the stages land on what the result actually says.
 * Demo and sample runs play the stages on a timer and open the sample journey.
 */
export function Processing() {
  const { sessionId = '' } = useParams()
  const [params] = useSearchParams()
  const data = useData()
  const { getIdToken } = useAuth()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const site = (params.get('site') as Site) ?? 'face_full'
  const n = Number(params.get('n') ?? '3')
  const scripted = data.mode === 'demo' || sessionId === 'sample'
  const step = reduce ? 400 : 1100

  const [done, setDone] = useState(0)
  const [view, setView] = useState<SessionView | null>(null)
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const ran = useRef(-1)

  // Demo and samples: the scripted run.
  const demoSeries = scripted ? (data.mode === 'demo' ? data.series(site) : (DEMO_SERIES[site] ?? null)) : null
  const demoLast = demoSeries ? demoSeries.sessions.length - 1 : -1
  useEffect(() => {
    if (!scripted) return
    const timers = LABELS.map((_, i) => window.setTimeout(() => setDone(i + 1), step * (i + 1)))
    const finish = window.setTimeout(() => {
      if (demoSeries) navigate(`/s/${site}?demo=1&t=${demoLast}&layer=1${site === 'face_full' ? '&m=pigment_spots' : '&m=tone_ita'}`, { replace: true })
    }, step * (LABELS.length + 1))
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(finish)
    }
  }, [scripted, navigate, step, demoSeries, site, demoLast])

  // Live: one analyze call per attempt; the first two stages tick while it runs.
  useEffect(() => {
    if (scripted || ran.current === attempt) return
    ran.current = attempt
    let alive = true
    const ticks = [window.setTimeout(() => alive && setDone((d) => Math.max(d, 1)), step), window.setTimeout(() => alive && setDone((d) => Math.max(d, 2)), step * 2)]
    void (async () => {
      try {
        const token = await getIdToken()
        const dev = params.get('dev') === '1'
        const note = params.get('note')
        if (dev || note) await api.patchSession(token, sessionId, { deviation: dev, note: note || null })
        const v = await api.analyze(token, sessionId)
        if (!alive) return
        setView(v)
        data.upsert(v)
        ticks.forEach(clearTimeout)
        for (let i = 0; i <= LABELS.length; i++) window.setTimeout(() => alive && setDone((d) => Math.max(d, i)), (reduce ? 120 : 380) * i)
      } catch (e) {
        if (!alive) return
        ticks.forEach(clearTimeout)
        const code = e instanceof ApiError ? e.code : null
        setError({ code, message: (code && ERROR_COPY[code]) || 'Something went wrong while measuring. Your photos are safe; try again.' })
      }
    })()
    return () => {
      alive = false
      ticks.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripted, attempt, sessionId])

  // Live: once every stage shows its result, open the report on this session.
  useEffect(() => {
    if (scripted || !view || done < LABELS.length) return
    const t = window.setTimeout(() => {
      const series = data.series(site)
      const index = series ? series.sessions.filter((s) => s.status === 'done').findIndex((s) => s.id === view.session.id) : -1
      navigate(`/s/${view.session.site}${index >= 0 ? `?t=${index}` : ''}`, { replace: true })
    }, reduce ? 200 : 700)
    return () => clearTimeout(t)
  }, [scripted, view, done, data, site, navigate, reduce])

  const results = view ? outcomes(view) : null
  const stageSession: Session | null = view ? toSession(view) : (demoSeries?.sessions[demoLast] ?? null)
  const failed = Boolean(view?.result && !view.result.quality.passed)

  return (
    <div className="flex min-h-dvh flex-col">
      {data.mode === 'demo' ? <DemoBar /> : null}
      <div className="h-[40dvh]">
        <Stage site={site} session={stageSession} baseline={null} metricId={null} layer={false} className="h-full" caption={`${view?.session.n_frames ?? n} frames`} />
      </div>
      <div className="mx-auto w-full max-w-[36rem] px-5 py-6 sm:px-8">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{error ? 'Measuring stopped' : done < LABELS.length ? 'Measuring…' : failed ? 'Done, with a photo problem' : 'Done'}</h1>
        <ol className="mt-4 space-y-3" aria-live="polite">
          {LABELS.map((label, i) => {
            const state = i < done ? 'done' : error ? 'stopped' : i === done ? 'active' : 'pending'
            const text = state === 'done' ? (results?.[i] ?? (scripted ? scriptedResult(i, n) : label)) : label
            return (
              <li key={label} className="flex items-center gap-3">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${state === 'done' ? 'border-willow-500 bg-willow-100 text-willow-700' : state === 'active' ? 'border-text' : 'border-border'}`} aria-hidden>
                  {state === 'done' ? (
                    <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
                      <Check size={14} />
                    </motion.span>
                  ) : state === 'active' ? (
                    <motion.span className="h-2 w-2 rounded-full bg-text" animate={reduce ? {} : { opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                  ) : state === 'stopped' && i === done ? (
                    <X size={14} className="text-text-3" />
                  ) : null}
                </span>
                <span className={`text-[15px] ${state === 'pending' || state === 'stopped' ? 'text-text-3' : state === 'active' ? 'text-text' : 'text-text-2'}`}>{text}</span>
              </li>
            )
          })}
        </ol>
        {error ? (
          <div className="mt-6 space-y-3">
            <p className="text-[15px] text-text-2">{error.message}</p>
            <div className="flex flex-wrap gap-3">
              {error.code === 'frames_missing' ? (
                <Button onClick={() => navigate(-1)}>Back to the upload</Button>
              ) : (
                <Button
                  onClick={() => {
                    setError(null)
                    setDone(0)
                    setAttempt((a) => a + 1)
                  }}
                >
                  Try again
                </Button>
              )}
            </div>
          </div>
        ) : null}
        {data.mode === 'demo' ? <p className="mt-6 text-[12px] text-text-3">Demo: the stages are played, then the sample journey opens.</p> : null}
        {data.mode === 'live' && sessionId === 'sample' ? <p className="mt-6 text-[12px] text-text-3">Sample run: the stages are played, then the sample journey opens. Hosted sample sessions run the real pipeline once the engine is connected.</p> : null}
      </div>
    </div>
  )
}

function scriptedResult(i: number, n: number): string {
  return [`${n} of ${n} frames passed`, 'Colour card found, ΔE 2.4', '11 metrics against your baseline', 'Numbers verified, nothing invented'][i]
}
