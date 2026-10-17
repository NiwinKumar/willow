import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Scrubber, type ScrubberTick } from '../../components/charts'
import { useShell } from '../../components/shell/ShellContext'
import { Button, ButtonLink } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { WillowLoader } from '../../components/willow/WillowLoader'
import { useOwner, useSpots } from '../../data/hooks'
import { SITE_ORDER, stalled } from '../../data/live'
import type { CaptureMode, Metric, MetricId, Session, Site } from '../../data/types'
import { useData } from '../../data/useData'
import type { SpotTrack } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { METRIC_META, SITE_LABEL, qualityCopy } from '../../lib/metrics'
import { ExplanationCard, NextAction } from './ExplanationCard'
import { MetricCard } from './MetricCard'
import { MetricSheet } from './MetricSheet'
import { MODE_LABEL, REASON_SHORT, bandOf, canBeBaseline, baselineFor, counts, referenceFor, dayOf, deltaText, metricQuestion, optionLabel, orderMetrics, retryable, sessionState, shortWhen, usableLine } from './model'
import { Crumb, Page, Pills, StatusCard, TomorrowSheet } from './parts'
import { PhotoPanel, type DiaryFocus } from './PhotoPanel'
import { heroFor } from './hero'
import { ResultHero } from './ResultHero'
import { ZONE_NAME, statusText, tagText } from './diaryText'
import { SpotDiary } from './SpotDiary'
import { useSessionView } from './useSessionView'

type SitePill = Site | 'forearm'
const isSite = (v: string | null): v is Site => v !== null && (SITE_ORDER as string[]).includes(v)
const isMode = (v: string | null): v is CaptureMode => v === 'calibrated_raw' || v === 'uncalibrated'
const TOMORROW_KEY = 'willow.tomorrowShown'

/**
 * Result (design "Session results"). /result is the latest analysed face check-in (?site= and ?mode= pick
 * another), /result/:sessionId one check-in; ?metric= opens a metric's detail, ?track= puts a spot-diary mark
 * on the photo, #spot-diary scrolls to the diary.
 */
export default function Result() {
  const { sessionId } = useParams()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const data = useData()
  const shell = useShell()
  const owner = useOwner()

  const qSite = params.get('site')
  const qMode = params.get('mode')
  const byId = sessionId ? (data.all.find((s) => s.id === sessionId) ?? null) : null
  const site: Site = byId?.site ?? (isSite(qSite) ? qSite : 'face_full')
  const siteSessions = useMemo(() => data.series(site)?.sessions ?? [], [data, site])
  // Without an id: the latest analysed check-in of the site (and mode, if asked); else the latest of any state.
  const latest = useMemo(() => {
    const pool = siteSessions.filter((s) => !isMode(qMode) || s.capture_mode === qMode)
    return [...pool].reverse().find((s) => s.status === 'done') ?? pool[pool.length - 1] ?? null
  }, [siteSessions, qMode])
  const session = sessionId ? byId : latest
  const mode: CaptureMode = session?.capture_mode ?? (isMode(qMode) ? qMode : 'uncalibrated')
  const modeSessions = useMemo(() => siteSessions.filter((s) => s.capture_mode === mode), [siteSessions, mode])
  const baseline = useMemo(() => baselineFor(session, siteSessions), [session, siteSessions])
  const state = session ? sessionState(session) : null
  const ordered = useMemo(() => orderMetrics(session?.result?.metrics ?? [], data.goals), [session, data.goals])
  const order = useMemo(() => ordered.map((m) => m.id), [ordered])
  // The single-session view signs what the list does not: the redness overlay, every frame, the spot crops.
  const view = useSessionView(session && state !== 'pending' ? session.id : null)
  // The scrubber: this place's check-ins in this capture mode, oldest first.
  const ticks = useMemo<ScrubberTick[]>(
    () =>
      modeSessions.map((s) => {
        const st = sessionState(s)
        return { id: s.id, short: shortWhen(s, modeSessions), label: optionLabel(s, modeSessions), kind: st === 'baseline' ? 'baseline' : st === 'rejected' ? 'rejected' : st === 'compared' || st === 'former' ? 'measured' : 'unfinished' }
      }),
    [modeSessions],
  )
  const tickIndex = session ? modeSessions.findIndex((s) => s.id === session.id) : -1

  // Still measuring: read again every few seconds until the api answers (no made-up progress). A session
  // stuck for 30 min will not move by waiting, so polling stops there.
  const pending = state === 'pending'
  const polling = pending && session !== null && !stalled(session)
  const { refresh } = data
  useEffect(() => {
    if (!polling) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 6000)
    return () => window.clearInterval(t)
  }, [polling, refresh])

  // A newer check-in of this site that did not finish measuring (photos saved): offer to try again.
  const unfinished = useMemo(() => {
    const after = session?.created_at ?? ''
    return [...siteSessions].reverse().find((s) => retryable(s) && s.id !== session?.id && s.created_at > after) ?? null
  }, [siteSessions, session])

  // Spot diary (face only, live only).
  const diaryOn = site === 'face_full' && Boolean(owner) && Boolean(session) && state !== 'pending'
  const spots = useSpots()
  const trackId = params.get('track')
  const track = diaryOn && spots.data?.enough_data ? (spots.data.tracks.find((t) => t.id === trackId) ?? null) : null
  const stageRef = useRef<HTMLElement>(null)
  const diaryReady = spots.status === 'ready'
  useEffect(() => {
    if (location.hash !== '#spot-diary' || !diaryReady) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => document.getElementById('spot-diary')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }))
  }, [location.hash, diaryReady, session?.id])
  useEffect(() => {
    if (!trackId || !track) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = stageRef.current
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: reduce ? 'auto' : 'smooth' })
  }, [trackId, track])

  const pickTrack = (t: SpotTrack) => {
    if (t.id === trackId) return backFromTrack()
    const last = t.observations[t.observations.length - 1]
    // Remember where the diary was opened from, so "Back to {date}" can walk back to it.
    const from = (location.state as { from?: string } | null)?.from ?? session?.id
    navigate(`/result/${last.session_id}?track=${t.id}`, { state: { from } })
  }
  const backFromTrack = () => {
    const from = (location.state as { from?: string } | null)?.from
    if (from) navigate(-1)
    else
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('track')
          return n
        },
        { replace: true },
      )
  }

  // Metric detail in the URL (?metric=); opening pushes, so Back closes it.
  const metricId = params.get('metric')
  const openMetric = ordered.find((m) => m.id === metricId) ?? null
  const showMetric = (id: MetricId) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('metric', id)
        return n
      },
      { state: { ...(location.state as object | null), sheet: true } },
    )
  const closeMetric = () => {
    if ((location.state as { sheet?: boolean } | null)?.sheet) navigate(-1)
    else
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('metric')
          return n
        },
        { replace: true },
      )
  }

  // "Same time tomorrow?" once after a face check-in (the check-in flow lands on ?from=check-in).
  const [tomorrow, setTomorrow] = useState(false)
  const fromCheckIn = params.get('from') === 'check-in'
  useEffect(() => {
    if (!fromCheckIn || !session) return
    let shown: string[] = []
    try {
      shown = JSON.parse(sessionStorage.getItem(TOMORROW_KEY) ?? '[]') as string[]
    } catch {
      /* private mode */
    }
    const t = window.setTimeout(() => {
      if (session.site === 'face_full' && sessionState(session) !== 'pending' && !shown.includes(session.id)) {
        setTomorrow(true)
        try {
          sessionStorage.setItem(TOMORROW_KEY, JSON.stringify([...shown.slice(-20), session.id]))
        } catch {
          /* private mode */
        }
      }
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('from')
          return n
        },
        { replace: true },
      )
    }, 1400)
    return () => window.clearTimeout(t)
  }, [fromCheckIn, session, setParams])

  // ---- loading / empty ----
  if ((data.status === 'loading' || data.status === 'idle') && !data.all.length) return <WillowLoader inline label="Loading your results" />
  if (data.status === 'error' && !data.all.length)
    return (
      <Page label="Result">
        <EmptyState title="Your results did not load" body="Check your connection, then try again. Nothing was lost." action={<Button onClick={() => void data.refresh()}>Try again</Button>} />
      </Page>
    )
  if (sessionId && !byId)
    return (
      <Page label="Result">
        <Crumb to="/progress" back="Progress" here="Result" />
        <EmptyState title="This check-in isn’t in your account" body="The link may be old, or it belongs to someone else." action={<ButtonLink to="/result">See your latest result</ButtonLink>} />
      </Page>
    )

  // ---- header controls ----
  const sitesWith = SITE_ORDER.filter((s) => (data.series(s)?.sessions.length ?? 0) > 0)
  const siteOptions: { value: SitePill; label: string }[] = [
    ...(['face_full', 'cheek_macro', 'nose_macro'] as Site[]).filter((s) => s === 'face_full' || sitesWith.includes(s) || s === site).map((s) => ({ value: s as SitePill, label: SITE_LABEL[s] })),
    ...(sitesWith.some((s) => s.startsWith('forearm')) || site.startsWith('forearm') ? [{ value: 'forearm' as SitePill, label: 'Forearms' }] : []),
  ]
  const sitePill: SitePill = site.startsWith('forearm') ? 'forearm' : site
  const pickSite = (v: SitePill) => (v === 'forearm' ? navigate('/test') : navigate(`/result?site=${v}`))
  const pickMode = (m: CaptureMode) => navigate(`/result?site=${site}&mode=${m}`)
  const headerDate = session ? fmtDate(session.created_at) : SITE_LABEL[site]
  const header = (
    <>
      <Crumb to={`/progress?site=${site.startsWith('forearm') ? 'face_full' : site}`} back="Progress" here={`Result · ${headerDate}`} />
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 pt-[clamp(6px,1.4vw,16px)] pb-1">
        <h1 className="m-0 font-serif text-[clamp(34px,3.5vw,52px)] leading-[.9] font-normal tracking-[-0.015em]">
          Your <span className="italic">result</span>
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Pills label="Place" options={siteOptions} value={sitePill} onChange={pickSite} />
          <div className="flex flex-wrap justify-end gap-1.5">
            <Pills
              label="Capture mode"
              tone="white"
              options={(['calibrated_raw', 'uncalibrated'] as CaptureMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
              value={session ? mode : isMode(qMode) ? qMode : null}
              onChange={pickMode}
            />
            {modeSessions.length ? (
              <label className="flex min-h-12 items-center gap-2 rounded-pill bg-white/55 py-0 pr-1.5 pl-4 text-[13px] text-ink-2">
                Check-in
                <select
                  value={session?.id ?? ''}
                  onChange={(e) => navigate(`/result/${e.target.value}`)}
                  className="min-h-[38px] max-w-[min(62vw,280px)] cursor-pointer rounded-pill border-0 bg-white px-3 text-[14px] text-ink"
                >
                  {[...modeSessions].reverse().map((s) => (
                    <option key={s.id} value={s.id}>
                      {optionLabel(s, modeSessions)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      </div>
      {tickIndex >= 0 && ticks.length > 1 ? (
        <section aria-label={`Your ${MODE_LABEL[mode]} check-ins`} className="flex flex-col gap-1 rounded-[28px] bg-white/55 px-3 pt-2.5 pb-2 squircle">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <span className="font-mono text-[11px] tracking-[.08em] whitespace-nowrap text-ink-2">■ {MODE_LABEL[mode].toUpperCase()} CHECK-INS · {ticks.length}</span>
            <span className="text-[12px] text-ink-2">Drag, or use ← →</span>
          </div>
          <Scrubber ticks={ticks} index={tickIndex} label={`${SITE_LABEL[site]} check-in`} onChange={(i) => navigate(`/result/${modeSessions[i].id}`, { replace: true })} />
        </section>
      ) : null}
    </>
  )

  const retry = unfinished ? (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] bg-surface px-[22px] py-4 text-[15px] squircle">
      <span className="text-ink-2">Your check-in from {fmtDate(unfinished.created_at)} did not finish measuring. The photos are saved.</span>
      <Button variant="ink" onClick={() => navigate(`/check-in?session=${unfinished.id}`, { state: { background: location } })}>
        Try again
      </Button>
    </div>
  ) : null

  if (!session)
    return (
      <Page label="Result">
        {header}
        {retry}
        <StatusCard
          eyebrow="NO CHECK-INS YET"
          title={`Your first ${isMode(qMode) ? MODE_LABEL[qMode] + ' ' : ''}check-in of your ${SITE_LABEL[site].toLowerCase()} becomes your baseline.`}
          body="Follow the light and distance checklist. With 3 or more usable photos, Willow measures how much your readings wobble on their own. Results appear here."
          action={
            <Button variant="ink" size="lg" onClick={() => shell.startCheckIn(site, isMode(qMode) ? qMode : 'uncalibrated')}>
              Start my baseline
            </Button>
          }
        />
        <Disclaimer />
      </Page>
    )

  // ---- the session ----
  const st = state!
  const day = dayOf(session)
  const measured = st === 'compared' || st === 'baseline' || st === 'former'
  const c = counts(session)
  const ask = () => {
    const changed = ordered.filter((m) => m.verdict === 'real_change').map((m) => `${METRIC_META[m.id].label} ${deltaText(m)}`)
    const q =
      st === 'rejected'
        ? `My ${SITE_LABEL[site].toLowerCase()} check-in on ${fmtDate(session.created_at)} could not be measured (${(session.result?.quality.reasons ?? []).map((r) => qualityCopy(r, site)?.text ?? r).join(' ')}). How do I take better photos next time?`
        : `Help me read my ${SITE_LABEL[site].toLowerCase()} result from ${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}: ${c.changed} changed${changed.length ? ` (${changed.join(', ')})` : ''}, ${c.normal} within normal range. What could explain it?`
    shell.openAdvisor(q, `${SITE_LABEL[site]} · ${fmtDate(session.created_at)}`)
  }
  const checkIn = () => shell.startCheckIn(site, mode)
  const actions = {
    compared: [
      <NextAction key="a" onClick={ask}>Ask the advisor about this result</NextAction>,
      <NextAction key="t" to={`/progress?site=${site}&mode=${mode}`}>See this on your timeline</NextAction>,
      ...(session.baseline_ref && !session.baseline_ref.has_noise_band && canBeBaseline(session) && (session.result?.frames_used ?? 0) >= 3
        ? [<NextAction key="b" to={`/progress/${day}?site=${site}&session=${session.id}`}>Make this check-in your baseline</NextAction>]
        : [<NextAction key="c" onClick={checkIn}>Check in again, same light and distance</NextAction>]),
    ],
    baseline: [
      <NextAction key="c" onClick={checkIn}>{(session.result?.frames_used ?? 0) >= 3 ? 'Next check-in: same light and distance' : 'Check in again with more photos'}</NextAction>,
      <NextAction key="r" to="/routine">Add the products you’re starting</NextAction>,
    ],
    former: [
      <NextAction key="l" to={`/result?site=${site}&mode=${mode}`}>Go to your latest check-in</NextAction>,
      <NextAction key="b" to={`/progress/${day}?site=${site}&session=${session.id}`}>Change your baseline</NextAction>,
    ],
    rejected: [<NextAction key="c" onClick={checkIn}>Retake this check-in</NextAction>, <NextAction key="a" onClick={ask}>Ask the advisor how to retake it</NextAction>],
    unmeasured: [<NextAction key="f" onClick={() => shell.startCheckIn('face_full', mode)}>Take a face check-in instead</NextAction>],
  } as Record<string, ReactNode[]>

  // Spot diary focus on the photo stage.
  const diary = spots.data
  const sIdx = diary ? diary.sessions.findIndex((x) => x.id === session.id) : -1
  const obs = track?.observations.find((o) => o.session_id === session.id) ?? null
  const fromId = (location.state as { from?: string } | null)?.from
  const fromSession = fromId ? data.all.find((s) => s.id === fromId) : null
  const focus: DiaryFocus | null =
    track && diary
      ? {
          bbox: obs?.bbox ?? null,
          candidateId: obs?.candidate_id ?? null,
          tag: tagText(track, sIdx, diary),
          area: track.zone ? ZONE_NAME[track.zone] : 'Spot',
          status: statusText(track, diary),
          backLabel: fromSession ? fmtDate(fromSession.created_at) : 'this check-in',
          onBack: backFromTrack,
        }
      : null

  return (
    <Page label="Result">
      {header}
      {retry}
      {st === 'pending' && stalled(session) ? (
        // Home's "didn't finish" links here: waiting longer will not change this one (polling has stopped).
        <StatusCard
          eyebrow="DID NOT FINISH"
          title="This check-in did not finish."
          body={<>{session.status === 'uploading' ? 'The photos never finished uploading, so nothing was measured.' : 'Measuring stopped before a result came back. The photos are saved, so it can be measured again.'}</>}
          action={
            session.status === 'uploading' ? (
              <Button variant="ink" size="lg" onClick={() => shell.startCheckIn(session.site, session.capture_mode)}>
                Take a new check-in
              </Button>
            ) : (
              <Button variant="ink" size="lg" onClick={() => navigate(`/check-in?session=${session.id}`, { state: { background: location } })}>
                Measure again
              </Button>
            )
          }
        />
      ) : st === 'pending' ? (
        <StatusCard
          busy
          eyebrow="STILL MEASURING"
          title="This check-in is still being measured."
          body={<>Your photos are uploaded. Results show here as soon as the measurement finishes; this page checks again on its own.</>}
          action={
            <Button variant="outline" onClick={() => void data.refresh()}>
              Check now
            </Button>
          }
        />
      ) : st === 'failed' ? (
        <StatusCard
          eyebrow="DID NOT FINISH"
          title="This check-in did not finish measuring."
          body={<>{retryable(session) ? 'The photos are saved, so it can be measured again.' : (session.error?.message ?? 'The photos could not be read.')}</>}
          action={
            retryable(session) ? (
              <Button variant="ink" size="lg" onClick={() => navigate(`/check-in?session=${session.id}`, { state: { background: location } })}>
                Try again
              </Button>
            ) : (
              <Button variant="ink" size="lg" onClick={checkIn}>
                Take new photos
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <ResultHero hero={heroFor(session, baseline, ordered)} photos={usableLine(session)} />
            <ExplanationCard key={session.id} session={session} measured={measured} actions={actions[st] ?? null} />
          </div>

          {measured && ordered.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-5">
                <h2 className="m-0 text-[clamp(26px,3vw,36px)] font-normal tracking-[-0.02em]">Measurements</h2>
                <span className="text-[14px] text-ink-2">Ordered by your goals · tap a card for detail</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,270px),1fr))] gap-3.5">
                {ordered.map((m: Metric, i) => (
                  <MetricCard key={m.id} metric={m} session={session} band={session.is_baseline ? m.mdc95 : bandOf(referenceFor(m.id, session, baseline, siteSessions), m.id)} compared={st === 'compared'} onOpen={() => showMetric(m.id)} delay={i * 60} />
                ))}
              </div>
            </>
          ) : null}

          {st === 'unmeasured' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3.5">
              {Array.from({ length: session.n_frames }, (_, i) => (
                <div key={i} className="relative flex aspect-square flex-col justify-between overflow-hidden rounded-[36px] p-[18px] squircle" style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
                  <FrameThumb url={view?.session.frame_urls?.[i]} alt={`${SITE_LABEL[site]}, photo ${i + 1} (saved, not measured)`} />
                  <span className="relative self-start rounded-pill bg-white/80 px-2 py-0.5 font-mono text-[11px] text-ink-2 uppercase">
                    {SITE_LABEL[site]} · photo {i + 1}
                  </span>
                  <span className="relative self-start rounded-pill bg-white px-3 py-2 text-[13px]">✓ Saved · — not measured</span>
                </div>
              ))}
            </div>
          ) : null}

          {st === 'rejected' ? <RejectedPhotos session={session} frameUrls={view?.session.frame_urls} /> : null}

          {measured ? <PhotoPanel ref={stageRef} session={session} focus={focus} baseline={st === 'compared' ? baseline : null} view={view} order={order} onOpenMetric={showMetric} /> : null}

          {diaryOn ? (
            <SpotDiary
              status={spots.status}
              diary={spots.data}
              onRetry={() => void spots.refetch()}
              stageSessionId={session.id}
              selected={track?.id ?? null}
              onPick={pickTrack}
              onTake={() => shell.startCheckIn('face_full', mode)}
            />
          ) : null}
        </>
      )}
      <p className="m-0 pt-6 text-caption text-ink-2">
        Photos delete 30 days after upload; measurements stay in your account until you delete them.{' '}
        <Link to={`/progress/${day}?site=${site}&session=${session.id}`} className="text-ink">
          Open this day in Progress
        </Link>
      </p>
      <Disclaimer />
      <MetricSheet metric={openMetric} session={session} baseline={session.is_baseline ? session : openMetric ? referenceFor(openMetric.id, session, baseline, siteSessions) : baseline} sessions={siteSessions} onClose={closeMetric} onAsk={(m) => {
          // The sheet is a modal <dialog> (top layer): close it, or the advisor opens hidden behind it.
          closeMetric()
          shell.openAdvisor(metricQuestion(m, session, baseline), `${METRIC_META[m.id].label} · ${fmtDate(session.created_at)}`)
        }} />
      <TomorrowSheet open={tomorrow} onClose={() => setTomorrow(false)} />
    </Page>
  )
}

/** A saved photo as a tile background (signed per frame by GET /v1/sessions/{id}); nothing for RAW, missing or unreadable files. */
function FrameThumb({ url, alt }: { url: string | null | undefined; alt: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!url || failed === url) return null
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(url)} className="absolute inset-0 size-full object-cover" />
}

/** One card per photo that did not pass, with the reason and the fix; the photo itself when the api signed it. */
function RejectedPhotos({ session, frameUrls }: { session: Session; frameUrls?: (string | null)[] }) {
  const frames = session.result?.quality.per_frame?.length ? session.result.quality.per_frame : [{ index: 0, passed: false, reasons: session.result?.quality.reasons ?? [] }]
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3.5">
      {frames
        .filter((f) => !f.passed)
        .map((f) => {
          const copy = f.reasons.map((r) => qualityCopy(r, session.site)).filter(Boolean)
          return (
            <div key={f.index} className="flex flex-col gap-3 rounded-[36px] bg-surface p-3.5 squircle">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[26px]" style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
                <FrameThumb url={frameUrls?.[f.index]} alt={`Photo ${f.index + 1}, not used: ${f.reasons.length ? f.reasons.map((r) => REASON_SHORT[r] ?? r).join(', ').toLowerCase() : 'did not pass the quality check'}`} />
                <span className="absolute top-3.5 left-3.5 rounded-pill bg-white/80 px-2 py-0.5 font-mono text-[11px] text-ink-2">PHOTO {f.index + 1}</span>
                <span aria-hidden className="absolute top-3.5 right-3.5 grid size-[34px] place-items-center rounded-full bg-[var(--aura-coral)] text-white">
                  !
                </span>
              </div>
              <span className="px-1.5 text-[17px]">{f.reasons.length ? f.reasons.map((r) => REASON_SHORT[r] ?? r).join(' · ') : 'Did not pass the quality check'}</span>
              <span className="px-1.5 pb-1.5 text-[14px] leading-[1.45] text-ink-2">{copy.map((x) => x!.text).join(' ') || 'Retake in the same light and position.'}</span>
            </div>
          )
        })}
    </div>
  )
}
