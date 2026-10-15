import { ArrowLeft, ChevronDown, Link2 } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { CoachMarks } from '../components/CoachMarks'
import { ControlCompare } from '../components/ControlCompare'
import { DemoBar } from '../components/DemoBar'
import { JudgeBar } from '../components/JudgeBar'
import { MetricRow } from '../components/MetricRow'
import { NumberValue } from '../components/NumberValue'
import { Scrubber } from '../components/Scrubber'
import { Sheet } from '../components/Sheet'
import { Stage } from '../components/Stage'
import { baselineFor, isSampleEngine, isUnmeasured, matchControl } from '../data/live'
import type { Metric, MetricGroup, MetricId, Session, Site } from '../data/types'
import { useData } from '../data/useData'
import { missingBaselines } from '../lib/baselineGuide'
import { MOLE_NOTE, NOT_SKIN, type SpotLabel, summarizeSpots } from '../lib/spotLabels'
import { failureReasons, leftOutPhotos, photosUsed, readableWarnings } from '../lib/warnings'
import { fmtDate, fmtHours, plural } from '../lib/format'
import { GROUP_META, METRIC_META, SITE_LABEL, VERDICT_RANK, isCloseUp, orderedGroups, qualityCopy } from '../lib/metrics'
import { ApiError, api } from '../lib/api'
import { useViewState } from '../lib/url'
import { useAuth } from '../lib/useAuth'
import { authErrorText } from '../lib/authErrors'
import { useJudgeOn } from '../lib/useJudge'
import { useMediaQuery } from '../lib/useMediaQuery'
import { fresh } from './lazy'

// The chart library is large and only needed when a metric is opened.
const MetricDetail = lazy(() => fresh(() => import('../components/MetricDetail'))().then((m) => ({ default: m.MetricDetail })))

const SNAPS = ['peek', 'half', 'full'] as const
const SNAP_NAME = { peek: 'collapsed', half: 'half open', full: 'open' } as const
type Snap = (typeof SNAPS)[number]

export function Report() {
  const { site: siteParam } = useParams()
  const site = (siteParam ?? 'face_full') as Site
  const data = useData()
  const judging = useJudgeOn()
  const navigate = useNavigate()
  // Opened from a shared link, or straight after measuring (back would reopen the camera or the
  // upload), the arrow goes home instead.
  const location = useLocation()
  // Fixed at mount: scrubbing or picking a metric replaces the URL (new key, no state).
  const [backHome] = useState(() => location.key === 'default' || Boolean((location.state as { fromProcessing?: boolean } | null)?.fromProcessing))
  const reduce = useReducedMotion()
  // One layout mounted at a time (Tailwind lg), so the panel's ids, heading and charts exist once.
  const wide = useMediaQuery('(min-width: 1024px)')
  const series = data.series(site)
  const sessions = useMemo(() => series?.sessions.filter((s) => s.status === 'done') ?? [], [series])
  // A session that failed after its photos were uploaded (engine down, a crash) can be measured
  // again: offer it while it is newer than the latest result.
  const unfinished = useMemo(() => {
    const last = sessions[sessions.length - 1]?.created_at ?? ''
    // Only failures a second try can fix (a busy or unreachable engine), never an unreadable file.
    const retryable = (s: Session) => !s.error?.code || ['engine_timeout', 'engine_unreachable', 'internal'].includes(s.error.code)
    return [...(series?.sessions ?? [])].reverse().find((s) => s.status === 'failed' && s.created_at > last && retryable(s)) ?? null
  }, [series, sessions])
  const retry = unfinished ? (
    <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-(--radius-tile) border border-border bg-surface p-3 text-[13px] sm:mx-6">
      <span className="text-text-2">Your session from {fmtDate(unfinished.created_at)} did not finish measuring. The photos are saved.</span>
      <Link to={`/processing/${unfinished.id}?site=${unfinished.site}&n=${unfinished.n_frames}`} className="inline-flex min-h-11 shrink-0 items-center rounded-(--radius-control) border border-border px-3 font-medium hover:bg-surface-2">
        Try again
      </Link>
    </div>
  ) : null
  const view = useViewState()
  const index = Math.min(sessions.length - 1, Math.max(0, view.t ?? sessions.length - 1))
  const session: Session | null = sessions[index] ?? null
  const baseline = useMemo(() => baselineFor(session, sessions), [session, sessions])
  const { getIdToken, loading: authLoading, user, continueAsGuest, signInWithGoogle } = useAuth()
  const [settingBaseline, setSettingBaseline] = useState(false)
  const [confirmBaseline, setConfirmBaseline] = useState(false)
  const unmeasured = isUnmeasured(session)
  const qualityFailed = Boolean(session?.result && !session.result.quality.passed)
  const nothingMeasured = Boolean(session?.result && session.result.metrics.every((m) => m.value === null))
  const controlSessions = useMemo(() => data.series('forearm_control')?.sessions ?? [], [data])
  // The illustrative journey is aligned by index; real sessions pair the nearest control photo in time.
  const controlSession = session?.live ? matchControl(session, controlSessions) : (controlSessions[index] ?? null)
  const missing = session?.is_baseline ? missingBaselines(data.series, session.capture_mode, data.goals).filter((m) => m !== site) : []
  const noBand = Boolean(session && !session.is_baseline && session.baseline_ref && !session.baseline_ref.has_noise_band)
  // Passed, not the baseline, compared with nothing: it was the baseline before another was chosen.
  const formerBaseline = Boolean(session?.live && !session.is_baseline && session.baseline_ref === null && session.result?.quality.passed && !unmeasured)

  const makeBaseline = async () => {
    if (!session) return
    setSettingBaseline(true)
    try {
      await api.setBaseline(await getIdToken(), session.site, session.id)
      await data.refresh()
      setConfirmBaseline(false)
      toast('This session is now your baseline. Later sessions are compared with it.')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change the baseline. Try again.')
    } finally {
      setSettingBaseline(false)
    }
  }
  // A shared link may carry a garbled ?m=: only known metric ids select anything.
  const metricId = view.m && view.m in METRIC_META ? (view.m as MetricId) : null
  const [expanded, setExpanded] = useState<MetricId | null>(null)
  const [snap, setSnap] = useState<Snap>('half')
  const [siteSheet, setSiteSheet] = useState(false)
  const [keys, setKeys] = useState(false)

  const metrics = session?.result?.metrics ?? []
  const allLowQuality = metrics.length > 0 && metrics.every((m) => m.verdict === 'low_quality')
  // Passed the quality check yet every value is empty: never "0 real changes" over an empty list.
  const noReadings = nothingMeasured && !allLowQuality
  const spots = useMemo(() => summarizeSpots(session?.label_details), [session])
  // The spots list selection belongs to one session: scrubbing to another clears it.
  const [focus, setFocus] = useState<{ sid: string; label: SpotLabel } | null>(null)
  const spotFocus = focus && focus.sid === session?.id ? focus.label : null
  const setSpotFocus = (label: SpotLabel | null) => setFocus(label && session ? { sid: session.id, label } : null)
  const ringsShown = Boolean(session?.preview)
  // With several photos the engine counts only spots seen in at least two of them, so the
  // Blemishes and Dark spots numbers can be lower than this list: say why.
  const confirmed = useMemo(() => {
    const r = session?.result
    const frames = r?.frames_used ?? 0
    const cands = (r?.candidates ?? []).filter((c) => session?.label_details?.[c.id])
    if (frames < 2 || !cands.length || cands.every((c) => c.features?.seen_in_fraction === undefined)) return null
    const twice = cands.filter((c) => Math.round((c.features?.seen_in_fraction ?? 0) * frames) >= 2).length
    return `${twice} of these ${cands.length} show up in more than one of your ${frames} photos. Only those count toward Blemishes and Dark spots${ringsShown ? '; the others have fainter rings' : ''}.`
  }, [session, ringsShown])
  const baselineMetric = useCallback((id: MetricId) => baseline?.result?.metrics.find((m) => m.id === id) ?? null, [baseline])
  // Quick selfies and RAW sessions are never compared, so charts and band scales use one mode.
  const sameMode = useMemo(() => sessions.filter((s) => s.capture_mode === session?.capture_mode && s.measured !== false), [sessions, session])
  const reach = useMemo(() => {
    const r: Partial<Record<MetricId, number>> = {}
    for (const s of sameMode) for (const m of s.result?.metrics ?? []) r[m.id] = Math.max(r[m.id] ?? 0, Math.abs(m.delta ?? 0))
    return r
  }, [sameMode])
  const realCount = metrics.filter((m) => m.verdict === 'real_change').length
  const groups = orderedGroups(data.goals)
  const grouped = groups
    .map((g) => ({ group: g, items: metrics.filter((m) => m.group === g).sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]) }))
    .filter((g) => g.items.length > 0)

  const outsideCount = useCallback((s: Session) => (s.result?.metrics ?? []).filter((m) => m.verdict === 'real_change').length, [])
  const onScrub = useCallback((i: number) => view.set({ t: i }), [view])

  // Keyboard: arrows scrub, Home/End jump to the baseline/latest, L toggles the layer, ? lists keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (document.querySelector('[role="dialog"]')) return // a sheet is open: keys belong to it
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') view.set({ t: Math.max(0, index - 1) })
      else if (e.key === 'ArrowRight') view.set({ t: Math.min(sessions.length - 1, index + 1) })
      else if (e.key === 'Home') view.set({ t: 0 })
      else if (e.key === 'End') view.set({ t: Math.max(0, sessions.length - 1) })
      else if (e.key.toLowerCase() === 'l') view.set({ layer: !view.layer })
      else if (e.key === '?') setKeys(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, sessions.length, view])

  if (data.mode === 'live' && !authLoading && !user) {
    return (
      <div className="mx-auto max-w-[36rem] px-5 py-12">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Sign in to see your results</h1>
        <p className="mt-3 text-[15px] text-text-2">Your sessions belong to your account. A guest account keeps them on this device; Google keeps them across devices.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => continueAsGuest().catch(() => toast.error('Could not sign in. Check your connection and try again.'))}>Continue as guest</Button>
          <Button variant="secondary" onClick={() => signInWithGoogle().catch((e) => { const t = authErrorText(e); if (t) toast.error(t) })}>Sign in with Google</Button>
        </div>
      </div>
    )
  }

  if (data.mode === 'live' && (data.status === 'loading' || data.status === 'idle') && sessions.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
        <p className="text-[15px] text-text-2">{data.status === 'idle' ? 'Signing in…' : 'Loading your sessions…'}</p>
      </div>
    )
  }

  if (data.mode === 'live' && data.status === 'error' && sessions.length === 0) {
    return (
      <div className="mx-auto max-w-[36rem] px-5 py-12">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Could not load your sessions</h1>
        <p className="mt-3 text-[15px] text-text-2">Check your connection, then try again. Nothing was lost.</p>
        <Button className="mt-6" onClick={() => void data.refresh()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!series || sessions.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col">
        {judging ? <JudgeBar /> : data.mode === 'demo' ? <DemoBar /> : null}
        <div className="mx-auto max-w-[36rem] px-5 py-12">
          {retry ? <div className="-mx-5 mb-6 sm:-mx-6">{retry}</div> : null}
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">No sessions yet for {SITE_LABEL[site] ?? 'this place'}</h1>
          <p className="mt-3 text-[15px] text-text-2">Take a baseline of five photos to start. Every later session is compared to it.</p>
          {/* Face and close-ups start with the phone camera; RAW is opt-in from the guide. */}
          <Link to={`/capture?site=${site}${site === 'face_full' || isCloseUp(site) ? '&mode=quick' : ''}`} className="mt-6 inline-flex min-h-11 items-center rounded-(--radius-control) bg-text px-4 text-[15px] font-medium text-surface">
            Start a baseline
          </Link>
        </div>
      </div>
    )
  }

  const titleDate = session ? (session.hours_since_baseline !== undefined && session.hours_since_baseline > 0 ? fmtHours(session.hours_since_baseline) : fmtDate(session.created_at)) : ''

  const baselineButton =
    data.mode === 'live' && session && !session.is_baseline && session.measured !== false && session.result?.quality.passed ? (
      confirmBaseline ? (
        <div className="mt-3 rounded-(--radius-tile) border border-border bg-surface p-3">
          <p className="text-[13px] text-text-2">
            Choose this only if it was taken before you started a product, for example when your first session had poor light. Later sessions are compared with this one; earlier comparisons stay as they are.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button className="!min-h-11" disabled={settingBaseline} onClick={() => void makeBaseline()}>
              {settingBaseline ? 'Saving…' : 'Make this my baseline'}
            </Button>
            <Button variant="quiet" className="!min-h-11" disabled={settingBaseline} onClick={() => setConfirmBaseline(false)}>
              Keep the current one
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3 !min-h-11" onClick={() => setConfirmBaseline(true)}>
          Make this my baseline
        </Button>
      )
    ) : null

  const sheetBody = (
    <>
      <header className="px-5 pb-3 pt-1 sm:px-6">
        {unmeasured && session ? (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">Saved, not measured yet</h1>
            <p className="mt-2 text-[15px] text-text-2">
              {fmtDate(session.created_at)} · {plural(session.n_frames, 'photo', 'photos')}. {SITE_LABEL[session.site]} photos were not measured when this session was saved, so it has no numbers yet. Your photos are kept and can be measured later.
            </p>
            <Link to="/capture?site=face_full&mode=quick" className="mt-4 inline-flex min-h-11 items-center rounded-(--radius-control) bg-text px-4 text-[15px] font-medium text-surface">
              Take a face photo
            </Link>
          </>
        ) : qualityFailed && session ? (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">These photos could not be measured</h1>
            <p className="mt-1 text-[13px] text-text-2">
              {fmtDate(session.created_at)} · {plural(session.n_frames, 'photo', 'photos')} · {session.result?.frames_used ?? 0} passed the quality check
            </p>
            <ul className="mt-3 space-y-1 text-[15px] text-text-2">
              {failureReasons(session.result).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Link to={`/capture?site=${session.site}${session.capture_mode === 'uncalibrated' ? '&mode=quick' : ''}`} className="mt-4 inline-flex min-h-11 items-center rounded-(--radius-control) bg-text px-4 text-[15px] font-medium text-surface">
              Retake
            </Link>
          </>
        ) : formerBaseline && session ? (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">Your earlier baseline</h1>
            <p className="mt-1 text-[13px] text-text-2">
              {fmtDate(session.created_at)} · {photosUsed(session)} · this was your baseline until you chose another one, so it is not compared with it
            </p>
            {baselineButton}
          </>
        ) : session?.is_baseline ? (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">Your baseline</h1>
            <p className="mt-1 text-[13px] text-text-2">
              {fmtDate(session.created_at)} · {photosUsed(session)} · {session.capture_mode === 'uncalibrated' ? 'phone camera' : 'RAW'} · later {session.capture_mode === 'uncalibrated' ? 'phone photos are' : 'RAW photos are'} compared to this
            </p>
            {leftOutPhotos(session.result) ? <p className="mt-1 text-[13px] text-text-2">{leftOutPhotos(session.result)}</p> : null}
            {(session.result?.frames_used ?? session.n_frames) < 3 ? (
              <p className="mt-2 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] text-text-2">
                {(session.result?.frames_used ?? session.n_frames) === 1 ? (session.n_frames > 1 ? 'Only one photo passed' : 'One photo') : session.n_frames > 2 ? 'Only two photos passed' : 'Two photos'}, so there is no noise band yet: Willow cannot tell a real change from normal photo-to-photo variation. Take a session of 5 photos and make it your baseline.
              </p>
            ) : null}
            {data.mode === 'live' && missing.length ? (
              <p className="mt-2 text-[13px] text-text-2">
                Still without a baseline:{' '}
                {missing.map((m, i) => (
                  <span key={m}>
                    {i === 0 ? '' : i === missing.length - 1 ? ' and ' : '; '}
                    <Link to={`/capture?site=${m}${session.capture_mode === 'uncalibrated' ? '&mode=quick' : ''}`} className="font-medium text-willow-700 underline-offset-2 hover:underline">
                      {SITE_LABEL[m]}
                    </Link>
                  </span>
                ))}
                .
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">
              {allLowQuality ? (
                'Nothing could be compared this time'
              ) : noReadings ? (
                'No readings came out of these photos'
              ) : noBand ? (
                'Compared with your baseline'
              ) : (
                <>
                  <NumberValue value={realCount} decimals={0} size="lg" className="text-[28px] align-baseline" /> real {realCount === 1 ? 'change' : 'changes'} since your baseline
                </>
              )}
            </h1>
            <p className="mt-1 text-[13px] text-text-2">
              {baseline ? `Baseline ${fmtDate(baseline.created_at)} · ${photosUsed(baseline)} · ` : ''}{session ? photosUsed(session) : ''} this session
              {session?.deviation ? <Chip tone="warn" className="ml-2">something was different</Chip> : null}
            </p>
            {leftOutPhotos(session?.result) ? <p className="mt-1 text-[13px] text-text-2">{leftOutPhotos(session?.result)}</p> : null}
            {session && noReadings ? (
              <Link to={`/capture?site=${session.site}${session.capture_mode === 'uncalibrated' ? '&mode=quick' : ''}`} className="mt-3 inline-flex min-h-11 items-center rounded-(--radius-control) bg-text px-4 text-[15px] font-medium text-surface">
                Retake
              </Link>
            ) : null}
            {noBand ? (
              <p className="mt-2 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] text-text-2">
                Your baseline has fewer than 3 usable photos, so changes are shown but none can be called real yet.{' '}
                {session && (session.result?.frames_used ?? 0) >= 3 ? 'This session has several usable photos: make it your baseline to get a noise band.' : 'Take 5 photos and make that session your baseline.'}
              </p>
            ) : null}
            {baselineButton}
          </>
        )}
      </header>
      {retry}
      {!unmeasured && session?.live && isSampleEngine(session) ? (
        <div className="mx-5 mb-3 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] sm:mx-6">
          <span className="font-semibold">Sample numbers.</span> Your photos are saved. Until the measurement engine is connected, these readings come from a fixed sample, not from your skin.
        </div>
      ) : null}
      {data.mode === 'live' && readableWarnings(session?.result).length ? (
        <div className="mx-5 mb-3 rounded-(--radius-tile) border border-border p-3 text-[13px] sm:mx-6">
          <p className="font-semibold">Notes from the measurement</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-2">
            {readableWarnings(session?.result).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {session?.result && session.result.quality.passed && session.result.quality.reasons.length > 0 && session.result.metrics.some((m) => m.verdict === 'low_quality') ? (
        <div className="mx-5 mb-3 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] sm:mx-6">
          <span className="font-semibold text-warn-text">Photo quality differed from your reference.</span>{' '}
          {session.result.quality.reasons.map((r) => qualityCopy(r, session.site)?.text).join(' ')}
        </div>
      ) : null}
      {site === 'forearm_treated' && session && !session.is_baseline ? (
        <div className="mx-5 mb-3 sm:mx-6">
          <ControlCompare
            treated={session}
            control={controlSession}
            treatedBaseline={baseline}
            controlBaseline={baselineFor(controlSession, controlSessions)}
            metricId={(metricId === 'redness' ? 'redness' : 'tone_ita') as 'tone_ita' | 'redness'}
          />
        </div>
      ) : null}
      {(nothingMeasured ? [] : grouped).map(({ group, items }) => (
        <section key={group} aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`} className="border-b border-border px-5 pb-1 pt-4 text-[15px] font-semibold text-text-2 sm:px-6">
            {GROUP_META[group as MetricGroup].label}
          </h2>
          <ul>
            {items.map((m: Metric) => {
              const bm = baselineMetric(m.id)
              return (
                <MetricRow
                  key={m.id}
                  metric={m}
                  baselineValue={session?.is_baseline ? null : (bm?.value ?? null)}
                  baselineMdc={session?.is_baseline ? null : (bm?.mdc95 ?? null)}
                  reach={reach[m.id] ?? 0}
                  selected={metricId === m.id}
                  expanded={expanded === m.id}
                  stamp
                  noBand={noBand && m.verdict === 'no_baseline' && m.delta !== null}
                  later={Boolean(session && !session.is_baseline)}
                  onSelect={() => view.set({ m: metricId === m.id ? null : m.id, layer: metricId !== m.id })}
                  onToggle={() => {
                    setExpanded(expanded === m.id ? null : m.id)
                    if (snap === 'peek') setSnap('full')
                  }}
                >
                  <Suspense fallback={<div className="h-44" aria-hidden />}>
                    <MetricDetail metricId={m.id} sessions={sameMode} current={m} baseline={baseline} />
                  </Suspense>
                </MetricRow>
              )
            })}
          </ul>
        </section>
      ))}
      {spots.length ? (
        <section aria-labelledby="spots" className="mx-5 my-5 rounded-(--radius-tile) border border-border p-4 sm:mx-6">
          <div className="flex items-center justify-between gap-2">
            <h2 id="spots" className="text-[17px] font-semibold">Spots on this photo</h2>
            <Chip tone="neutral">AI-suggested</Chip>
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            The engine found these spots; Gemini looked at each one twice and kept a name only when both looks agreed. Names describe appearance, not a diagnosis.
            {ringsShown ? ' Rings mark them on the photo (hair and artefacts hidden); choose a name to see just those.' : ''}
          </p>
          <ul className="mt-3 divide-y divide-border">
            {spots.map((s) => (
              <li key={s.label}>
                {ringsShown ? (
                  <button
                    type="button"
                    aria-pressed={spotFocus === s.label}
                    onClick={() => setSpotFocus(spotFocus === s.label ? null : s.label)}
                    className={`-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-(--radius-control) px-2 text-left text-[15px] hover:bg-surface-2 ${spotFocus === s.label ? 'bg-surface-2 font-medium' : ''} ${NOT_SKIN.includes(s.label) ? 'text-text-2' : ''}`}
                  >
                    <span>{s.name}</span>
                    <span className="font-mono text-[15px]">{s.n}</span>
                  </button>
                ) : (
                  <div className={`flex min-h-11 items-center justify-between gap-3 text-[15px] ${NOT_SKIN.includes(s.label) ? 'text-text-2' : ''}`}>
                    <span>{s.name}</span>
                    <span className="font-mono text-[15px]">{s.n}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {confirmed ? <p className="mt-2 text-[13px] text-text-2">{confirmed}</p> : null}
          {spots.some((s) => s.label === 'mole') ? <p className="mt-2 text-[13px] font-medium">{MOLE_NOTE}</p> : null}
        </section>
      ) : null}
      {session?.explanation ? (
        <section className="mx-5 my-5 rounded-(--radius-tile) bg-surface p-4 sm:mx-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">Why this matters</h2>
            {session.explanation_source === 'gemini' ? <Chip tone="neutral">AI-written, numbers verified</Chip> : session.explanation_source === 'template' ? <Chip tone="neutral">written from your numbers</Chip> : data.mode === 'demo' ? <Chip tone="neutral">sample explanation</Chip> : <Chip tone="neutral">written from your numbers</Chip>}
          </div>
          <p className="mt-2 text-[15px] font-medium">{session.explanation.headline}</p>
          <ul className="mt-2 space-y-2 text-[15px] leading-relaxed text-text-2">
            {session.explanation.items.map((it) => (
              <li key={it.metric_id}>{it.summary}</li>
            ))}
          </ul>
          {session.explanation.next_steps.length ? (
            <>
              <h3 className="mt-3 text-[13px] font-semibold text-text-2">What to do next</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] text-text-2">
                {session.explanation.next_steps.slice(0, 3).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          {session.explanation.disclaimer.startsWith('Cosmetic appearance tracking, not a diagnosis') ? null : <p className="mt-3 text-[12px] text-text-3">{session.explanation.disclaimer}</p>}
        </section>
      ) : null}
      <p className="px-5 pb-6 text-[12px] text-text-3 sm:px-6">Cosmetic appearance tracking, not a diagnosis. Photos delete 30 days after upload; measurements stay in your account until you delete them.</p>
    </>
  )

  const topBar = (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-6">
      <button type="button" onClick={() => (backHome ? navigate('/') : navigate(-1))} className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-control) hover:bg-surface-2" aria-label={backHome ? 'Home' : 'Back'}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      <button type="button" onClick={() => setSiteSheet(true)} className="inline-flex min-h-11 items-center gap-1 rounded-(--radius-control) px-2 text-[15px] font-semibold hover:bg-surface-2" aria-haspopup="dialog">
        {SITE_LABEL[site]} <span className="font-mono text-[13px] font-normal text-text-2">· {titleDate}</span> <ChevronDown size={16} aria-hidden className="text-text-2" />
      </button>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href)
            toast('Link to this view copied')
          } catch {
            toast.error('Could not copy the link')
          }
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-control) hover:bg-surface-2"
        aria-label="Copy link to this view"
      >
        <Link2 size={20} aria-hidden />
      </button>
    </div>
  )

  const stage = (
    <Stage
      site={site}
      session={session}
      baseline={baseline}
      metricId={metricId}
      layer={view.layer}
      onSelectMetric={(id) => view.set({ m: id, layer: id !== null })}
      caption={session && !session.is_baseline && session.hours_since_baseline !== undefined ? fmtHours(session.hours_since_baseline) : undefined}
      spotFocus={spotFocus}
      className="h-full w-full"
    />
  )

  const scrubber = (
    <div className="shrink-0 border-t border-border bg-bg pb-[max(8px,env(safe-area-inset-bottom))] pt-1">
      <Scrubber sessions={sessions} index={index} onChange={onScrub} outsideCount={outsideCount} />
    </div>
  )

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      {judging ? <JudgeBar /> : data.mode === 'demo' ? <DemoBar /> : null}
      {topBar}
      {wide ? (
        /* Desktop: stage + scrubber left, panel right */
        <div className="grid min-h-0 flex-1 grid-cols-[58%_42%]">
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1">{stage}</div>
            {scrubber}
          </div>
          <div className="min-h-0 overflow-y-auto border-l border-border">{sheetBody}</div>
        </div>
      ) : (
        /* Phone: stage, draggable sheet, scrubber */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">{stage}</div>
          <SnapSheet snap={snap} onSnap={setSnap} reduce={Boolean(reduce)}>
            {sheetBody}
          </SnapSheet>
          {scrubber}
        </div>
      )}
      <CoachMarks
        id="lens"
        tips={[
          ...(sessions.length > 1 ? (['scrub'] as const) : []),
          ...(metrics.some((m) => m.mdc95 !== null) ? (['band'] as const) : []),
          ...(baseline && session && baseline.id !== session.id && baseline.preview && session.preview ? (['flicker'] as const) : []),
        ]}
      />
      <Sheet open={keys} onOpenChange={setKeys} title="Keyboard">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          {[['← →', 'Move through sessions'], ['Home / End', 'Baseline / latest'], ['L', 'Toggle the layer on the photo'], ['Hold B', 'Flicker to the baseline'], ['?', 'This list']].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[13px] text-text-2">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Sheet>
      <Sheet open={siteSheet} onOpenChange={setSiteSheet} title="Choose a site">
        <ul className="divide-y divide-border">
          {data.sites.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setSiteSheet(false)
                  navigate(`/s/${s}${view.demo ? '?demo=1' : ''}`)
                }}
                className={`flex min-h-12 w-full items-center justify-between text-left text-[15px] ${s === site ? 'font-semibold' : ''}`}
              >
                {SITE_LABEL[s]}
                <span className="font-mono text-[12px] text-text-3">{plural(data.series(s)?.sessions.filter((x) => x.status === 'done').length ?? 0, 'session', 'sessions')}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}

/** In-page sheet over the stage with three snap heights; drag the grabber, release snaps by projected momentum. */
function SnapSheet({ snap, onSnap, reduce, children }: { snap: Snap; onSnap: (s: Snap) => void; reduce: boolean; children: React.ReactNode }) {
  const heights: Record<Snap, string> = { peek: '96px', half: '46dvh', full: '82dvh' }
  const y = useMotionValue(0)
  return (
    <motion.section
      aria-label="Results"
      initial={false}
      animate={{ height: heights[snap] }}
      transition={reduce ? { duration: 0 } : { type: 'spring', visualDuration: 0.3, bounce: 0 }}
      style={{ y }}
      // May shrink: on a short phone "full" plus the bars and scrubber would pass the screen height.
      className="relative z-10 flex min-h-0 shrink flex-col rounded-t-(--radius-sheet) bg-bg shadow-[0_-8px_24px_oklch(0.24_0.018_130/0.1)]"
    >
      <motion.button
        type="button"
        aria-label={`Results panel, ${SNAP_NAME[snap]}. Press to ${snap === 'full' ? 'make it smaller' : 'make it larger'}, or drag.`}
        onPanEnd={(_, info) => {
          const projected = info.offset.y + (info.velocity.y / 1000) * 120
          const i = SNAPS.indexOf(snap)
          if (projected < -40) onSnap(SNAPS[Math.min(2, i + 1)])
          else if (projected > 40) onSnap(SNAPS[Math.max(0, i - 1)])
          animate(y, 0, { type: 'spring', visualDuration: 0.3, bounce: 0 })
        }}
        onClick={() => onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half')}
        className="flex h-11 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-noise-500/60" aria-hidden />
      </motion.button>
      <div className={`min-h-0 flex-1 ${snap === 'peek' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{children}</div>
    </motion.section>
  )
}
