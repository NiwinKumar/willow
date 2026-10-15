import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import type { Site } from '../../data/types'
import type { SessionView } from '../../lib/api'
import { qualityCopy } from '../../lib/metrics'
import { failureReasons } from '../../lib/warnings'
import { plural, siteLower } from './model'
import { Orb, type OrbState } from './parts'
import { outcomeOf } from './outcome'
import type { AnalysisState } from './useAnalysis'

const ERROR_COPY: Record<string, string> = {
  frame_unreadable: 'One of the files could not be read. Check that it is the original DNG or JPEG.',
  unsupported_format: 'One of the files is in a format Willow cannot read.',
  network: 'Could not reach Willow. Check your connection; your photos are saved.',
}

const LEFT_OUT_WORD: Partial<Record<string, string>> = {
  blurry: 'soft',
  overexposed: 'too bright',
  underexposed: 'too dark',
  pose_out_of_range: 'face turned',
  face_not_found: 'no face found',
  occlusion_suspected: 'skin covered',
  card_not_found: 'no colour card',
  card_delta_e_high: 'card colours off',
}

/** The four engine stages, written from what the result actually says (the old outcomes()). */
function resultLines(view: SessionView): [string, string, string, string] {
  const r = view.result
  const n = view.session.n_frames
  if (view.session.measured === false || !r) return [`${view.session.site.startsWith('forearm') ? 'Forearm' : 'These'} photos were not measured this time`, 'Skipped', 'Saved only · no numbers', 'Nothing to explain']
  const q = r.quality
  const left = (q.per_frame ?? []).filter((f) => !f.passed)
  const why = [...new Set(left.flatMap((f) => f.reasons.map((x) => LEFT_OUT_WORD[x]).filter(Boolean)))]
  const quality = q.passed ? `${r.frames_used} of ${n} usable${left.length ? ` · ${left.length} not used${why.length ? `: ${why.join(', ')}` : ''}` : ''}` : `Stopped · ${failureReasons(r)[0] ?? 'photo quality too low to compare'}`
  const warnings = r.warnings ?? []
  const paper = warnings.some((w) => w.includes('white paper')) && !warnings.some((w) => w.includes('no white reference'))
  const colour = !q.passed
    ? 'Skipped'
    : r.capture_mode === 'uncalibrated'
      ? 'Skipped · quick photos have no colour reference'
      : q.card_detected
        ? q.reasons.includes('card_delta_e_high')
          ? 'Card found, but its colours read off'
          : `Card found${q.card_delta_e_mean != null ? ` · residual ΔE ${q.card_delta_e_mean.toFixed(1)}` : ''}`
        : paper
          ? 'Corrected with the white paper'
          : 'No colour reference found · colours as the camera saw them'
  const usable = r.metrics.filter((m) => m.value !== null).length
  const indicative = r.metrics.filter((m) => m.value !== null && m.confidence === 'indicative').length
  const count = plural(usable, 'reading')
  const measured =
    usable === 0
      ? 'Nothing measured'
      : view.session.is_baseline
        ? `${count} measured · this is your baseline`
        : view.session.baseline?.has_noise_band === false
          ? `${count} compared with your baseline · no normal range yet`
          : `${count} compared with your baseline${indicative ? ` · ${indicative} indicative` : ''}`
  const named = Object.keys(view.session.label_details ?? {}).length
  const spots = named ? ` · ${plural(named, 'spot')} named by AI` : ''
  const explained = usable === 0 ? 'Nothing to explain' : (view.session.explanation_source === 'gemini' ? 'Written by Gemini · every number checked' : 'Written from your numbers') + spots
  return [quality, colour, measured, explained]
}

/** "Photo 1: no face found. Photo 2: too bright." from the engine's per-photo reasons. */
function perPhoto(view: SessionView): string | null {
  const frames = (view.result?.quality.per_frame ?? []).filter((f) => !f.passed && f.reasons.length)
  if (!frames.length) return null
  return frames.map((f) => `Photo ${f.index + 1}: ${[...new Set(f.reasons.map((x) => LEFT_OUT_WORD[x] ?? x))].join(', ')}`).join('. ') + '.'
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Step "processing" (CAP 08). Stages advance only on real events: "Upload received" when the photos are
 * stored (upload finished, sample copied, or the session read back), the engine stages when analyze
 * answers, each written from the result. While the one analyze call runs, nothing pretends to progress.
 */
export function ProcessingStep(props: {
  state: AnalysisState
  site: Site | null
  n: number | null
  received: boolean
  sample: boolean
  onRetry: () => void
  onRetake: () => void
  onUploadAgain: () => void
  onSeeResult: () => void
  onClose: () => void
  onFaceCheckIn: () => void
}) {
  const { state, site, n, received, sample } = props
  const reduce = useReducedMotion()
  const outcome = outcomeOf(state)
  const [now, setNow] = useState(() => Date.now())
  // Reveal the answered stages one after another (real results, shown in order); instant with reduced motion.
  const [shown, setShown] = useState(0)
  const answered = state.kind === 'done'

  useEffect(() => {
    if (state.kind !== 'running' && state.kind !== 'offline') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [state.kind])
  const [shownFor, setShownFor] = useState(answered)
  if (shownFor !== answered) {
    setShownFor(answered)
    setShown(answered && reduce ? 4 : 0)
  }
  useEffect(() => {
    if (!answered || reduce) return
    const timers = [1, 2, 3, 4].map((i) => window.setTimeout(() => setShown(i), 260 * i))
    return () => timers.forEach(clearTimeout)
  }, [answered, reduce])

  const startedAt = 'startedAt' in state ? state.startedAt : now
  const endedAt = state.kind === 'done' || state.kind === 'error' ? state.endedAt : now
  const elapsed = Math.max(0, (endedAt - startedAt) / 1000)
  const view = state.kind === 'done' ? state.view : null
  const frames = view?.session.n_frames ?? n
  const lines = view ? resultLines(view) : null
  const failedRun = outcome !== 'run' && outcome !== 'success' && outcome !== 'unmeasured' && outcome !== 'rejected'
  const orb: OrbState = outcome === 'run' || (answered && shown < 4) ? 'run' : outcome === 'success' || outcome === 'unmeasured' ? 'done' : 'fail'
  const where = site ? siteLower(site) : null

  const title =
    outcome === 'run' || (answered && shown < 4)
      ? `Analysing ${where ? `${where} ` : ''}photos`
      : {
          success: view?.session.is_baseline ? 'Your baseline is ready' : 'Your results are ready',
          rejected: 'No usable photos',
          unmeasured: 'Photos saved',
          timeout: 'Analysis timed out',
          offline: 'Connection lost',
          limit: 'Measuring paused for today',
          missing: 'Some photos didn’t arrive',
          gone: 'This check-in no longer exists',
          failed: 'Measuring stopped',
          run: '',
        }[outcome]

  const stage1 = sample ? (frames ? `${plural(frames, 'sample photo')} copied into your account` : 'Sample photos copied into your account') : frames ? `${plural(frames, 'photo')} stored privately` : 'Photos stored privately'
  type St = { name: string; detail: string; glyph: string; tone: 'done' | 'run' | 'wait' | 'fail' }
  const engine = ['Quality checks', 'Colour correction', 'Measurement', 'Explanation']
  const stages: St[] = [
    outcome === 'missing'
      ? { name: 'Upload received', detail: 'Stopped · some photos never reached Willow', glyph: '!', tone: 'fail' }
      : received || answered
        ? { name: 'Upload received', detail: stage1, glyph: '✓', tone: 'done' }
        : { name: 'Upload received', detail: 'Checking the photos are stored…', glyph: '◌', tone: 'run' },
    ...engine.map((name, i): St => {
      if (lines && i < shown) {
        const skipped = outcome === 'rejected' && i > 0
        const stopped = outcome === 'rejected' && i === 0
        return { name, detail: skipped ? 'Skipped' : lines[i], glyph: stopped ? '!' : skipped ? '·' : '✓', tone: stopped ? 'fail' : skipped ? 'wait' : 'done' }
      }
      if (failedRun && outcome !== 'missing' && i === 0) return { name, detail: outcome === 'offline' ? 'Paused · waiting for the connection' : 'Stopped · no result', glyph: '!', tone: 'fail' }
      if ((outcome === 'run' || answered) && i === 0 && (received || state.kind === 'running')) return { name, detail: 'On the measurement engine now · every stage lands when it answers', glyph: '◌', tone: 'run' }
      return { name, detail: 'Waiting', glyph: '·', tone: 'wait' }
    }),
  ]

  const rejectedText = view
    ? [
        'None of the photos could be used.',
        perPhoto(view) ?? failureReasons(view.result).join(' '),
        sample || view.session.is_baseline ? '' : 'Your baseline is unchanged.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  const tips = view && outcome === 'rejected' ? [...new Set((view.result?.quality.reasons ?? []).map((r) => qualityCopy(r, view.session.site)?.text).filter((t): t is string => Boolean(t)))].slice(0, 3) : []
  const errorText =
    state.kind === 'error'
      ? {
          timeout: 'Analysis didn’t finish in time. Your photos are uploaded, so retrying won’t send them again.',
          limit: `${state.message || 'That is enough for today.'} Your photos are saved; try again tomorrow.`,
          missing: 'Some photos never reached Willow, so there is nothing to measure yet. Photos can’t be added to this check-in later; start a new one.',
          gone: 'It was deleted, so there is nothing to measure.',
          failed: (state.code && ERROR_COPY[state.code]) || 'Something went wrong while measuring. Your photos are safe; try again.',
        }[outcome as 'timeout' | 'limit' | 'missing' | 'gone' | 'failed']
      : outcome === 'offline'
        ? 'The connection dropped while waiting for the result. Nothing was lost: Willow keeps measuring, and this page picks it up when you’re back online.'
        : ''
  const slow = state.kind === 'running' && elapsed > 45

  return (
    <div className="relative mx-auto grid min-h-[80%] max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-center gap-6 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-col items-center gap-[22px] text-center">
        <Orb state={orb} />
        <div aria-live="polite" className="flex flex-col items-center gap-1.5">
          <h1 id="ck-title" tabIndex={-1} className="m-0 text-[clamp(24px,3vw,34px)] font-light tracking-[-0.02em] outline-none">
            {title}
          </h1>
          <span className="font-dot text-[34px]" aria-hidden>
            {mmss(elapsed)}
          </span>
          <span className="font-mono text-[12px] text-ink-2">ELAPSED · {outcome === 'run' ? 'USUALLY 10–30 S, LONGER FOR THE FIRST OF THE DAY' : failedRun || outcome === 'rejected' ? 'STOPPED' : 'FINISHED'}</span>
          {slow ? <p className="m-0 mt-2 max-w-[340px] text-[14px] leading-[1.45] text-ink-2">Taking longer than usual (the engine may be waking up). Your photos are saved; you can leave, and the result lands in Home.</p> : null}
          {outcome === 'run' && !slow ? <p className="m-0 mt-2 text-[13px] text-ink-2">You can leave; the measurement keeps going and the result lands in Home.</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-[36px] bg-surface/90 p-[clamp(20px,3vw,30px)] shadow-[0_30px_60px_-44px_rgba(0,0,0,.35)] backdrop-blur-[20px] squircle">
        <ol aria-label="Stages" className="m-0 list-none p-0">
          {stages.map((st) => (
            <li key={st.name} className="flex items-start gap-3.5 border-b border-ink/[.06] px-1.5 py-3">
              <span
                aria-hidden
                className="grid size-[30px] flex-none place-items-center rounded-full text-[14px] transition-[background] duration-[400ms]"
                style={{ background: st.tone === 'fail' ? 'var(--aura-coral)' : st.tone === 'done' ? 'var(--text-primary)' : st.tone === 'run' ? 'var(--aura-lilac)' : '#E4E3DE', color: st.tone === 'done' || st.tone === 'fail' ? '#fff' : 'var(--text-primary)' }}
              >
                {st.glyph}
              </span>
              <span className="flex flex-col gap-[3px]">
                <span className="text-[17px]">{st.name}</span>
                <span className="text-[14px] leading-[1.4] text-ink-2">{st.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        {outcome === 'rejected' && shown >= 4 ? (
          <div role="alert" className="mt-3 flex flex-col gap-2.5">
            <p className="m-0 leading-normal">{rejectedText}</p>
            {tips.length ? (
              <ul className="m-0 flex flex-col gap-1 rounded-[18px] bg-caution-bg py-3 pr-3 pl-7 text-[14px] leading-[1.45] text-caution">
                {tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
            {sample ? (
              // Sample photos can't be retaken: offer the person's own check-in instead.
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={props.onFaceCheckIn} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-inverse">
                  Take your own photo
                </button>
                <button type="button" onClick={props.onClose} className="min-h-[52px] rounded-pill border border-ink/15 bg-white px-[22px]">
                  Done
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={props.onRetake} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-inverse">
                  Retake photos
                </button>
                <button type="button" onClick={props.onUploadAgain} className="min-h-[52px] rounded-pill border border-ink/15 bg-white px-[22px]">
                  Upload different files
                </button>
              </div>
            )}
          </div>
        ) : null}

        {outcome === 'unmeasured' && shown >= 4 ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <p className="m-0 leading-normal">These photos were not measured this time, so this check-in has no numbers. Your photos are kept and can be measured later.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={props.onFaceCheckIn} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-inverse">
                Take a face photo
              </button>
              <button type="button" onClick={props.onClose} className="min-h-[52px] rounded-pill border border-ink/15 bg-white px-[22px]">
                Done
              </button>
            </div>
          </div>
        ) : null}

        {failedRun ? (
          <div role="alert" className="mt-3 flex flex-col gap-2.5">
            <p className="m-0 leading-normal">{errorText}</p>
            <div className="flex flex-wrap gap-2">
              {outcome === 'missing' ? (
                // A new attempt: the camera for quick photos, the file picker for RAW.
                <button type="button" onClick={props.onRetake} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-inverse">
                  {received ? 'Take the photos again' : 'Start a new check-in'}
                </button>
              ) : outcome === 'limit' || outcome === 'gone' ? null : (
                <button type="button" onClick={props.onRetry} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-inverse">
                  {outcome === 'timeout' ? 'Retry analysis' : 'Try again'}
                </button>
              )}
              <button type="button" onClick={props.onClose} className="min-h-[52px] rounded-pill border border-ink/15 bg-white px-[22px]">
                {outcome === 'limit' || outcome === 'gone' ? 'Done' : 'Come back later'}
              </button>
            </div>
          </div>
        ) : null}

        {outcome === 'success' && shown >= 4 ? (
          <button type="button" onClick={props.onSeeResult} className="mt-3 flex min-h-[60px] animate-rise items-center justify-center rounded-[24px] bg-selected text-[17px] text-inverse">
            {view?.session.is_baseline ? 'See your baseline' : 'See your results'} →
          </button>
        ) : null}
      </div>
    </div>
  )
}
