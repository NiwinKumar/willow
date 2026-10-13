import { Check } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { DemoBar } from '../components/DemoBar'
import { Stage } from '../components/Stage'
import { useData } from '../data/useData'
import type { Site } from '../data/types'
import { DUR, EASE_OUT } from '../lib/motion'

const STAGES = [
  { label: 'Checking photo quality', result: (n: number) => `${n} of ${n} frames passed` },
  { label: 'Correcting colours', result: () => 'Colour card found, ΔE 2.4' },
  { label: 'Measuring', result: () => '11 metrics against your baseline' },
  { label: 'Explaining', result: () => 'Numbers verified, nothing invented' },
]

/**
 * Lab-notebook processing: frames arrive on the stage, each stage label morphs into its result.
 * Live mode will drive this from POST /v1/sessions/{id}/analyze (M2); until then the stages play
 * on a timer and land on the sample journey, and the page says so.
 */
export function Processing() {
  const { sessionId } = useParams()
  const [params] = useSearchParams()
  const data = useData()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const site = (params.get('site') as Site) ?? 'face_full'
  const n = Number(params.get('n') ?? '3')
  const [done, setDone] = useState(0)
  const series = data.series(site)
  const last = series ? series.sessions.length - 1 : -1

  useEffect(() => {
    const timers = STAGES.map((_, i) => window.setTimeout(() => setDone(i + 1), (reduce ? 400 : 1100) * (i + 1)))
    const finish = window.setTimeout(() => {
      if (series) navigate(`/s/${site}?demo=1&t=${last}&layer=1${site === 'face_full' ? '&m=pigment_spots' : '&m=tone_ita'}`, { replace: true })
    }, (reduce ? 400 : 1100) * (STAGES.length + 1))
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(finish)
    }
  }, [navigate, reduce, series, site, last])

  return (
    <div className="flex min-h-dvh flex-col">
      {data.mode === 'demo' ? <DemoBar /> : null}
      <div className="h-[40dvh]">
        <Stage site={site} session={series?.sessions[last] ?? null} baseline={null} metricId={null} layer={false} className="h-full" caption={`${n} frames`} />
      </div>
      <div className="mx-auto w-full max-w-[36rem] px-5 py-6 sm:px-8">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{done < STAGES.length ? 'Measuring…' : 'Done'}</h1>
        <ol className="mt-4 space-y-3" aria-live="polite">
          {STAGES.map((s, i) => {
            const state = i < done ? 'done' : i === done ? 'active' : 'pending'
            return (
              <li key={s.label} className="flex items-center gap-3">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${state === 'done' ? 'border-willow-500 bg-willow-100 text-willow-700' : state === 'active' ? 'border-text' : 'border-border'}`} aria-hidden>
                  {state === 'done' ? (
                    <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
                      <Check size={14} />
                    </motion.span>
                  ) : state === 'active' ? (
                    <motion.span className="h-2 w-2 rounded-full bg-text" animate={reduce ? {} : { opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                  ) : null}
                </span>
                <span className={`text-[15px] ${state === 'pending' ? 'text-text-3' : state === 'active' ? 'text-text' : 'text-text-2'}`}>
                  {state === 'done' ? s.result(n) : s.label}
                </span>
              </li>
            )
          })}
        </ol>
        {!series ? <p className="mt-6 text-[13px] text-text-2">Your photos are uploaded and kept (session {sessionId}). The measurement engine connects on Thursday; this page will then show your real results.</p> : null}
        {data.mode === 'demo' ? <p className="mt-6 text-[12px] text-text-3">Demo: the stages are played, then the sample journey opens.</p> : null}
      </div>
    </div>
  )
}
