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
import { plural } from '../lib/format'
import { QUALITY_COPY, SITE_LABEL } from '../lib/metrics'
import { DUR, EASE_OUT } from '../lib/motion'
import { useAuth } from '../lib/useAuth'
import { DEMO_SERIES } from '../mock/series'

const LABELS = ['Checking photo quality', 'Correcting colours', 'Measuring', 'Explaining']

/** What each stage turned out to be, written from the real result. */
function outcomes(view: SessionView): string[] {
  const r = view.result
  const n = view.session.n_frames
  if (view.session.measured === false || !r) {
    return [`${n} ${n === 1 ? 'photo' : 'photos'} received and saved`, `${SITE_LABEL[view.session.site]} is not measured yet`, 'Nothing measured, so no numbers', 'Nothing to explain']
  }
  const q = r.quality
  const quality = q.passed ? `${r.frames_used} of ${n} ${n === 1 ? 'photo' : 'photos'} passed the quality check` : (q.reasons.map((x) => QUALITY_COPY[x]?.text).filter(Boolean)[0] ?? 'Photo quality too low to compare')
  const warnings = r.warnings ?? []
  const paper = warnings.some((w) => w.includes('white paper')) && !warnings.some((w) => w.includes('no white reference'))
  const colour =
    r.capture_mode === 'uncalibrated'
      ? 'No colour card: results are a trend'
      : q.card_detected
        ? `Colour card found${q.card_delta_e_mean != null ? `, ΔE ${q.card_delta_e_mean}` : ''}`
        : paper
          ? 'Colours corrected with the white paper'
          : 'No colour reference found: colours not corrected'
  const count = `${r.metrics.length} ${r.metrics.length === 1 ? 'metric' : 'metrics'}`
  const measured = view.session.is_baseline
    ? `${count} measured. This is your baseline`
    : view.session.baseline?.has_noise_band === false
      ? `${count} compared with your baseline (no noise band yet)`
      : `${count} compared with your baseline`
  const explained = view.session.explanation_source === 'gemini' ? 'Numbers verified, nothing invented' : 'Written from your numbers'
  return [quality, colour, measured, explained]
}

/**
 * Analyze a session exactly once, whatever page reloads happen: a finished session is shown as it
 * is, a session another tab (or a refresh) is analysing is waited for, anything else is analysed.
 */
async function analyzeOnce(token: string, sessionId: string): Promise<SessionView> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let current = await api.getSession(token, sessionId)
  for (let i = 0; current.session.status === 'processing' && i < 60; i++) {
    await wait(3000)
    current = await api.getSession(token, sessionId)
  }
  if (current.session.status === 'done') return current
  try {
    return await api.analyze(token, sessionId)
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'conflict') return analyzeOnce(token, sessionId)
    throw e
  }
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
  const [elapsed, setElapsed] = useState(0)
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

  // Live: one analyze call per attempt; the first two stages tick while it runs. The call is
  // guarded by `ran` and is never cancelled by an effect cleanup (React runs effects twice in
  // development, which used to drop the result); only unmounting stops state updates.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (scripted || ran.current === attempt) return
    ran.current = attempt
    const later = (ms: number, f: () => void) => window.setTimeout(() => mounted.current && f(), ms)
    // No stage is ticked before the engine answers: progress shown is real or not shown at all.
    const started = Date.now()
    const clock = window.setInterval(() => mounted.current && setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    const ticks = [clock]
    void (async () => {
      try {
        const token = await getIdToken()
        const dev = params.get('dev') === '1'
        const note = params.get('note')
        if (dev || note) await api.patchSession(token, sessionId, { deviation: dev, note: note || null })
        const v = await analyzeOnce(token, sessionId)
        if (!mounted.current) return
        ticks.forEach(clearInterval)
        setView(v)
        data.upsert(v)
        for (let i = 0; i <= LABELS.length; i++) later((reduce ? 120 : 380) * i, () => setDone((d) => Math.max(d, i)))
      } catch (e) {
        if (!mounted.current) return
        ticks.forEach(clearInterval)
        const code = e instanceof ApiError ? e.code : null
        setError({ code, message: (code && ERROR_COPY[code]) || (e instanceof ApiError && e.message) || 'Something went wrong while measuring. Your photos are safe; try again.' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripted, attempt, sessionId])

  // Live: once every stage shows its result, open the report on this session (unless nothing
  // was measured; then this page says what happened and offers what works today).
  useEffect(() => {
    if (scripted || !view || done < LABELS.length || view.session.measured === false) return
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
  const unmeasured = view?.session.measured === false

  return (
    <div className="flex min-h-dvh flex-col">
      {data.mode === 'demo' ? <DemoBar /> : null}
      <div className="h-[40dvh]">
        <Stage site={site} session={stageSession} baseline={null} metricId={null} layer={false} className="h-full" caption={plural(view?.session.n_frames ?? n, 'frame', 'frames')} />
      </div>
      <div className="mx-auto w-full max-w-[36rem] px-5 py-6 sm:px-8">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{error ? 'Measuring stopped' : done < LABELS.length ? 'Measuring…' : unmeasured ? 'Saved, not measured yet' : failed ? 'Done, with a photo problem' : 'Done'}</h1>
        {!scripted && !view && !error ? (
          <p className="mt-1 font-mono text-[13px] text-text-2" aria-live="off">
            {elapsed} s · usually 10 to 30 s, longer for the first photo of the day
          </p>
        ) : null}
        <ol className="mt-4 space-y-3" aria-live="polite">
          {LABELS.map((label, i) => {
            const state = unmeasured && i > 0 && i < done ? 'skipped' : i < done ? 'done' : error ? 'stopped' : i === done ? 'active' : 'pending'
            const text = state === 'done' || state === 'skipped' ? (results?.[i] ?? (scripted ? scriptedResult(i, n) : label)) : label
            return (
              <li key={label} className="flex items-center gap-3">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${state === 'done' ? 'border-willow-500 bg-willow-100 text-willow-700' : state === 'active' ? 'border-text' : 'border-border'}`} aria-hidden>
                  {state === 'done' ? (
                    <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
                      <Check size={14} />
                    </motion.span>
                  ) : state === 'active' ? (
                    <motion.span className="h-2 w-2 rounded-full bg-text" animate={reduce ? {} : { opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                  ) : state === 'skipped' ? (
                    <span className="h-px w-2.5 bg-text-3" />
                  ) : state === 'stopped' && i === done ? (
                    <X size={14} className="text-text-3" />
                  ) : null}
                </span>
                <span className={`text-[15px] ${state === 'pending' || state === 'stopped' ? 'text-text-3' : state === 'active' ? 'text-text' : 'text-text-2'}`}>{text}</span>
              </li>
            )
          })}
        </ol>
        {unmeasured && done >= LABELS.length ? (
          <div className="mt-6 space-y-3">
            <p className="text-[15px] text-text-2">
              Willow measures forearm photos today. {SITE_LABEL[view!.session.site]} measurement is still being built, so this session has no numbers. Your photos are kept and can be measured when it is ready.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/capture?site=forearm_control')}>Photograph a forearm</Button>
              <Button variant="secondary" onClick={() => navigate('/')}>Done</Button>
            </div>
          </div>
        ) : null}
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
