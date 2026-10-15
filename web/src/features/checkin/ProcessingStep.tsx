import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import type { Quality, QualityRegion, Site } from '../../data/types'
import type { AnalysisStage, SessionView } from '../../lib/api'
import { qualityCopy } from '../../lib/metrics'
import { failureReasons } from '../../lib/warnings'
import { pad2, plural, siteLower } from './model'
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

/** Face regions the engine can name in a per-photo reason ("whole" names none). */
const REGION_WORD: Record<QualityRegion, string | null> = {
  forehead: 'forehead',
  left_cheek: 'left cheek',
  right_cheek: 'right cheek',
  nose: 'nose',
  chin: 'chin',
  under_eyes: 'under the eyes',
  whole: null,
}

type FrameQuality = NonNullable<Quality['per_frame']>[number]

/** One photo's reasons in words, with the face region when the engine names one ("forehead too bright"). */
function frameReasons(f: FrameQuality): string[] {
  return [
    ...new Set(
      f.reasons.map((x) => {
        const word = LEFT_OUT_WORD[x] ?? x
        const where = [...new Set((f.regions ?? []).filter((r) => r.reason === x).map((r) => REGION_WORD[r.region]).filter((w): w is string => Boolean(w)))]
        return where.length ? `${where.join(' and ')} ${word}` : word
      }),
    ),
  ]
}

/** "Photo 1: no face found. Photo 2: forehead too bright." from the engine's per-photo reasons. */
function perPhoto(view: SessionView): string | null {
  const frames = (view.result?.quality.per_frame ?? []).filter((f) => !f.passed && f.reasons.length)
  if (!frames.length) return null
  return frames.map((f) => `Photo ${f.index + 1}: ${frameReasons(f).join(', ')}`).join('. ') + '.'
}

/** The person's own photos the engine left out, from the signed frame URLs (JPEG/HEIC only). */
function leftOutPhotos(view: SessionView): { n: number; url: string; why: string }[] {
  const urls = view.session.frame_urls ?? []
  return (view.result?.quality.per_frame ?? [])
    .filter((f) => !f.passed && urls[f.index])
    .map((f) => ({ n: f.index + 1, url: urls[f.index]!, why: frameReasons(f).join(', ') }))
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Step "processing" (CAP 08). Stages advance only on real events: "Upload received" when the photos are
 * stored (upload finished, sample copied, or the session read back); quality, colour and measuring
 * together when the api's live stage says the engine answered ("explaining"); the explanation when
 * analyze answers. Each is then written from the result. Nothing ticks on a timer.
 */
export function ProcessingStep(props: {
  state: AnalysisState
  /** The api's live analysis stage (polled every 2 s while analyze runs). */
  stage: AnalysisStage | null
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
  const stage = state.kind === 'running' ? props.stage : null
  // The engine answered while analyze was still running: its three stages already stand ticked.
  // (per run: a retry starts its stages again)
  const run = 'startedAt' in state ? state.startedAt : null
  const [engineDoneIn, setEngineDoneIn] = useState<number | null>(null)
  if (stage === 'explaining' && run !== null && engineDoneIn !== run) setEngineDoneIn(run)
  const engineDone = run !== null && engineDoneIn === run

  useEffect(() => {
    if (state.kind !== 'running' && state.kind !== 'offline') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [state.kind])
  const first = engineDone ? 3 : 0
  const [shownFor, setShownFor] = useState(answered)
  if (shownFor !== answered) {
    setShownFor(answered)
    setShown(answered && reduce ? 4 : first)
  }
  useEffect(() => {
    if (!answered || reduce) return
    const timers = [1, 2, 3, 4].filter((i) => i > first).map((i, k) => window.setTimeout(() => setShown(i), 260 * (k + 1)))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `first` is read once, when the answer lands
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
      const live = outcome === 'run' || answered
      if (live && engineDone) {
        // The api says the engine answered: its three stages ran (their outcome lands with the result).
        if (i < 3) return { name, detail: i === 0 ? 'Checked · the outcome lands with the result' : 'Done', glyph: '✓', tone: 'done' }
        return { name, detail: 'Writing the explanation · every number is checked against your measurement', glyph: '◌', tone: 'run' }
      }
      if (live && i === 0 && (received || state.kind === 'running'))
        return {
          name,
          detail: stage === 'engine' ? 'On the measurement engine now · quality, colour and measuring land together when it answers' : stage === 'received' ? 'Starting the measurement…' : 'On the measurement engine now · every stage lands when it answers',
          glyph: '◌',
          tone: 'run',
        }
      if (live && stage === 'engine' && (i === 1 || i === 2)) return { name, detail: 'On the engine · lands with the quality checks', glyph: '◌', tone: 'run' }
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
          missing: 'Some photos never reached Willow, so there is nothing to measure yet. Take them again in a new check-in.',
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
            {view && leftOutPhotos(view).length ? (
              <ul aria-label="Photos that were left out" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5 p-0">
                {leftOutPhotos(view).map((p) => (
                  <li key={p.n} className="flex flex-col gap-1.5">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-[16px] bg-muted">
                      <img src={p.url} alt={`Photo ${p.n}`} loading="lazy" className="size-full object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <span aria-hidden className="absolute top-2 left-2 font-dot text-[14px] text-white [text-shadow:0_1px_6px_rgba(0,0,0,.5)]">
                        {pad2(p.n)}
                      </span>
                    </div>
                    <span className="text-[12.5px] leading-[1.35] text-ink-2">{p.why || 'left out'}</span>
                  </li>
                ))}
              </ul>
            ) : null}
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
