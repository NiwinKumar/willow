import { Images, StickyNote } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { CompareSplit } from '../../components/charts'
import { useShell } from '../../components/shell/ShellContext'
import { Button, ButtonLink } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Sheet } from '../../components/ui/Sheet'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { VerdictGlyph } from '../../components/willow/Verdict'
import { useOwner } from '../../data/hooks'
import { SITE_ORDER, stalled } from '../../data/live'
import type { MetricId, RoutineEntry, Session } from '../../data/types'
import { useData } from '../../data/useData'
import { ApiError, api } from '../../lib/api'
import { clockOf, fmtDate, parseDate } from '../../lib/format'
import { METRIC_META, SITE_LABEL } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { CHANGE_WORDS, VERDICT_WORDS, changeCounts, changeLines, type ChangeWay, type VerdictKind } from '../../lib/verdict'
import { BaselineDialog } from './BaselineDialog'
import { InsightsCard, NextAction } from './ExplanationCard'
import { frameFor, photoSize } from './frame'
import { MetricTile } from './MetricCard'
import { MetricSheet } from './MetricSheet'
import { DAY_HERO, DAY_RANK, bandOf, baselineFor, referenceFor, canBeBaseline, counts, daySession, dayStatus, metricQuestion, optionLabel, orderMetrics, photoExpired, retryable, sessionState, usableLine, usedFrames } from './model'
import { Page, StatusCard, TomorrowSheet } from './parts'
import { PhotoFrame } from './PhotoFrame'
import { PhotoPanel } from './PhotoPanel'
import { RejectedPhotos, UnmeasuredPhotos } from './photos'
import { useAnyPhotoLoads } from './useImageStatus'
import { NOTE_DOT, productName, rejectNote, sessionNotes } from './timeline'
import { useSessionView } from './useSessionView'

const NONE: Session[] = []
const TOMORROW_KEY = 'willow.tomorrowShown'
const isMeasured = (st: string) => st === 'compared' || st === 'baseline' || st === 'former'

/**
 * A day's result (design "Day detail"), the one result page, for every place at once: one check-in per place
 * (?session= picks it for its place, else the place's latest analysed one), the insights, every reading in
 * one grid (tap one for its detail, ?metric= and ?place=), then each place's photo with its spots and areas.
 */
export function DayDetail({ day, byDay, entries }: { day: string; byDay: Map<string, Session[]>; entries: RoutineEntry[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const data = useData()
  const shell = useShell()
  const list = byDay.get(day) ?? NONE
  const picked = list.find((s) => s.id === params.get('session')) ?? null
  const qSite = params.get('site')
  const shown = SITE_ORDER.filter((p) => list.some((s) => s.site === p)).map((p) => (picked?.site === p ? picked : daySession(list.filter((s) => s.site === p))))
  const primary = picked ?? shown.find((s) => s.site === qSite) ?? shown[0] ?? null
  const multi = shown.length > 1
  // Each place's check-ins: a baseline and a comparison are always within one place.
  const seriesOf = (s: Session) => data.series(s.site)?.sessions ?? NONE
  const baseOf = (s: Session) => baselineFor(s, seriesOf(s))
  const daysSorted = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const di = daysSorted.indexOf(day)
  const prevDay = di > 0 ? daysSorted[di - 1] : null
  const nextDay = di >= 0 && di < daysSorted.length - 1 ? daysSorted[di + 1] : null
  const [asking, setAsking] = useState<Session | null>(null)
  const date = parseDate(day)

  // Still measuring: read again every few seconds until the api answers (no made-up progress). A session
  // stuck for 30 min will not move by waiting, so polling stops there.
  const polling = shown.some((s) => sessionState(s) === 'pending' && !stalled(s))
  const { refresh } = data
  useEffect(() => {
    if (!polling) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 6000)
    return () => window.clearInterval(t)
  }, [polling, refresh])

  // Metric detail in the URL (?metric= and the place it was read at, ?place=); opening pushes, so Back closes it.
  const metricId = params.get('metric') as MetricId | null
  const qPlace = params.get('place') ?? picked?.site ?? null
  const showMetric = (s: Session, id: MetricId) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('metric', id)
        n.set('place', s.site)
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
          n.delete('place')
          return n
        },
        { replace: true, state: location.state },
      )
  }

  // "Same time tomorrow?" once after a face check-in (the check-in flow lands on ?from=check-in).
  const [tomorrow, setTomorrow] = useState(false)
  const fromCheckIn = params.get('from') === 'check-in'
  const face = shown.find((s) => s.site === 'face_full') ?? null
  useEffect(() => {
    if (!fromCheckIn) return
    let seen: string[] = []
    try {
      seen = JSON.parse(sessionStorage.getItem(TOMORROW_KEY) ?? '[]') as string[]
    } catch {
      /* private mode */
    }
    const t = window.setTimeout(() => {
      if (face && sessionState(face) !== 'pending' && !seen.includes(face.id)) {
        setTomorrow(true)
        try {
          sessionStorage.setItem(TOMORROW_KEY, JSON.stringify([...seen.slice(-20), face.id]))
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
        { replace: true, state: location.state },
      )
    }, 1400)
    return () => window.clearTimeout(t)
  }, [fromCheckIn, face, setParams, location.state])
  // Forearm days have no calendar of their own: their page is the product test.
  const back = () => ((location.state as { fromCalendar?: boolean } | null)?.fromCalendar ? navigate(-1) : navigate(primary && !multi && primary.site.startsWith('forearm') ? '/test' : '/progress'))
  const go = (d: string) =>
    navigate(`/progress/${d}`, {
      replace: true,
      state: location.state,
    })

  const nav = (actions?: ReactNode) => (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5">
      <div className="flex min-w-0 items-center gap-3.5">
        <button type="button" onClick={back} className="flex min-h-11 items-center gap-2 rounded-pill bg-white/65 pr-[18px] pl-3.5 text-[14px] backdrop-blur-[12px] hover:bg-white">
          <span aria-hidden>←</span>
          {date.toLocaleDateString('en-GB', { month: 'long' })}
        </button>
        <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">
          HISTORY /{' '}
          {date
            .toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
            .toUpperCase()}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {actions}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => prevDay && go(prevDay)} disabled={!prevDay} aria-label="Previous check-in day" className="min-h-11 rounded-pill bg-white/65 px-4 text-[13px] disabled:opacity-40">
            ‹ {prevDay ? fmtDate(prevDay) : 'Earlier'}
          </button>
          <button type="button" onClick={() => nextDay && go(nextDay)} disabled={!nextDay} aria-label="Next check-in day" className="min-h-11 rounded-pill bg-white/65 px-4 text-[13px] disabled:opacity-40">
            {nextDay ? fmtDate(nextDay) : 'Later'} ›
          </button>
        </div>
      </div>
    </nav>
  )

  if (!primary)
    return (
      <Page label="Day detail">
        {nav()}
        <EmptyState title="No check-in on this day" body="Pick a coloured day in the calendar." action={<ButtonLink to="/progress">Back to the calendar</ButtonLink>} />
      </Page>
    )

  const placeOf = (s: Session) => SITE_LABEL[s.site]
  const states = shown.map((s) => ({ s, st: sessionState(s) }))
  const compared = states.filter((x) => x.st === 'compared').map((x) => x.s)
  const baselines = states.filter((x) => x.st === 'baseline').map((x) => x.s)
  const status = DAY_RANK.find((k) => shown.some((s) => dayStatus(s) === k)) ?? 'other'
  const [heroBg, heroGlow] = DAY_HERO[status]

  // The day's changes over every place, best news first.
  const ways: Record<ChangeWay, number> = { improved: 0, otherWay: 0, shifted: 0 }
  const kinds = { changed: 0, normal: 0, notEnough: 0, notCompared: 0 }
  for (const s of compared) {
    const w = changeCounts(s)
    for (const k of ['improved', 'otherWay', 'shifted'] as const) ways[k] += w[k]
    const c = counts(s)
    for (const k of ['changed', 'normal', 'notEnough', 'notCompared'] as const) kinds[k] += c[k]
  }
  const firstState = states[0].st
  const chips: { g: VerdictKind | null; t: string; way?: ChangeWay }[] = compared.length
    ? [
        ...(['improved', 'otherWay', 'shifted'] as const).filter((w) => ways[w]).map((w) => ({ g: 'changed' as const, way: w, t: `${ways[w]} ${CHANGE_WORDS[w].label.toLowerCase()}` })),
        ...(['normal', 'notEnough', 'notCompared'] as const).filter((k) => kinds[k]).map((k) => ({ g: k, t: `${kinds[k]} ${VERDICT_WORDS[k].label.toLowerCase()}` })),
        ...baselines.map((s) => ({ g: 'baseline' as const, t: `${placeOf(s)}: your starting point` })),
      ]
    : baselines.length
      ? [
          { g: 'baseline', t: multi && baselines.length < shown.length ? `${baselines.map(placeOf).join(', ')}: your starting point` : 'Your starting point' },
          { g: null, t: 'Later days compare with this one' },
        ]
      : states.every((x) => x.st === 'rejected')
        ? [{ g: 'notCompared', t: 'Not measured' }]
        : [{ g: 'notCompared', t: firstState === 'former' ? 'An earlier baseline, not compared' : firstState === 'pending' ? 'Still measuring' : firstState === 'failed' ? 'Did not finish measuring' : 'Not measured' }]
  const big = compared.length ? String(kinds.changed).padStart(2, '0') : baselines.length ? String(baselines.reduce((n, s) => n + usedFrames(s), 0)).padStart(2, '0') : states.every((x) => x.st === 'rejected') ? '00' : '—'
  const bigLabel = compared.length ? (kinds.changed === 1 ? 'reading moved beyond your normal range' : 'readings moved beyond your normal range') : baselines.length ? 'photos in your baseline' : states.every((x) => x.st === 'rejected') ? 'usable photos' : 'not compared'

  const started = entries.filter((e) => e.started_at.slice(0, 10) === day)
  const notes = [
    ...started.map((e) => ({
      text: `Started ${productName(e)}`,
      dot: NOTE_DOT.routine,
    })),
    ...shown.flatMap((s) =>
      sessionNotes(s)
        .filter((n) => n.kind !== 'note')
        .map((n) => (multi ? { ...n, text: `${placeOf(s)}: ${n.text}` } : n)),
    ),
  ]

  // Every reading of the day in one grid, in goal order; a metric read at two places is named with its place.
  const items = states.filter((x) => isMeasured(x.st)).flatMap((x) => (x.s.result?.metrics ?? []).map((m) => ({ m, s: x.s, st: x.st })))
  const ownerOf = new Map(items.map((i) => [i.m, i]))
  const byGoal = orderMetrics(
    items.map((i) => i.m),
    data.goals,
  ).map((m) => ownerOf.get(m)!)
  // The same metric at two places sits side by side, where it first comes in goal order.
  const firstAt = new Map<MetricId, number>()
  byGoal.forEach((i, k) => {
    if (!firstAt.has(i.m.id)) firstAt.set(i.m.id, k)
  })
  const ordered = [...byGoal].sort((a, b) => firstAt.get(a.m.id)! - firstAt.get(b.m.id)!)
  const twice = new Set(ordered.filter((i, k) => ordered.findIndex((j) => j.m.id === i.m.id) !== k).map((i) => i.m.id))
  const open = ordered.find((i) => i.m.id === metricId && i.s.site === qPlace) ?? ordered.find((i) => i.m.id === metricId) ?? null
  const sheetSession = open?.s ?? primary
  const sheetBase = baseOf(sheetSession)
  const sheetRef = sheetSession.is_baseline ? sheetSession : open ? referenceFor(open.m.id, sheetSession, sheetBase, seriesOf(sheetSession)) : sheetBase
  const sheetRefLabel = sheetRef && sheetRef !== sheetBase && sheetRef !== sheetSession ? `Check-in, ${fmtDate(sheetRef.created_at) === fmtDate(sheetSession.created_at) ? clockOf(sheetRef.created_at) : fmtDate(sheetRef.created_at)}` : 'Baseline'

  const checkIn = () => shell.openCheckIn()
  const measureAgain = (s: Session) => navigate(`/check-in?session=${s.id}`, { state: { background: location } })
  // Under the insights: what to do next. "Check in again" once for the day, not once per place.
  const nextFor = (s: Session, st: string, first: boolean): ReactNode[] => {
    const again = (text: string) =>
      first ? [
        <NextAction key="c" onClick={checkIn}>
          {text}
        </NextAction>,
      ] : []
    if (st === 'compared') return again('Check in again, same light and distance')
    if (st === 'baseline')
      return [
        ...again((s.result?.frames_used ?? 0) >= 3 ? 'Next check-in: same light and distance' : 'Check in again with more photos'),
        ...(first ? [
          <NextAction key="r" to="/routine">
            Add the products you’re starting
          </NextAction>,
        ] : []),
      ]
    if (st === 'rejected')
      return [
        <NextAction key="c" onClick={checkIn}>
          Retake this check-in
        </NextAction>,
      ]
    if (st === 'unmeasured')
      return [
        <NextAction key="f" onClick={checkIn}>
          Check in instead
        </NextAction>,
      ]
    return []
  }
  const told = states.filter((x) => x.st !== 'pending' && x.st !== 'failed')
  const describe = (s: Session, st: string) => (st === 'compared' ? [...changeLines(s).map((l) => l.text), `${counts(s).normal} within normal range`].join(', ') : st === 'baseline' ? 'it is my baseline' : st === 'rejected' ? 'the photos could not be measured' : 'it was not compared')
  const askWisp = (
    <button
      type="button"
      className="flex min-h-9 items-center px-1 text-[13px] underline underline-offset-4"
      onClick={() =>
        shell.openAdvisor(
          `Help me read my check-in from ${fmtDate(primary.created_at, { day: 'numeric', month: 'long' })}: ${states.map((x) => (multi ? `${placeOf(x.s).toLowerCase()}: ${describe(x.s, x.st)}` : describe(x.s, x.st))).join('; ')}${started.length ? `. I started ${started.map(productName).join(' and ')} that day` : ''}.`,
          `Check-in · ${fmtDate(primary.created_at)}`,
        )
      }
    >
      Ask Wisp about this day
    </button>
  )

  return (
    <Page label="Day detail">
      <div key={day} className="flex animate-[wInR_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-4 pt-[clamp(8px,2vw,20px)]">
        {nav(askWisp)}

        <section
          aria-label="Day summary"
          className="relative flex flex-col gap-5 overflow-hidden rounded-[48px] p-[clamp(24px,4vw,44px)] text-ink squircle"
          style={{
            background: heroBg,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,.5), inset 0 0 90px rgba(255,255,255,.35), 0 40px 80px -50px ${heroGlow}`,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <span className="font-mono text-[11px] tracking-[.08em]">■ {(multi ? shown.map(placeOf).join(' · ') : `${placeOf(primary)} · ${usableLine(primary)}`).toUpperCase()}</span>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <NotesButton session={primary} notes={notes} />
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-end gap-6">
            <div className="flex min-w-0 flex-col gap-4">
              <h1 className="m-0 font-serif text-[clamp(34px,3.5vw,48px)] leading-[.9] font-normal tracking-[-0.01em]">
                {date.toLocaleDateString('en-GB', { weekday: 'long' })},
                <br />
                <span className="italic">
                  {date.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((ch) => (
                  <span key={ch.t} className="flex min-h-[34px] items-center gap-[7px] rounded-pill bg-white/60 px-[13px] text-[13px]">
                    {ch.g ? <VerdictGlyph kind={ch.g} way={ch.way} /> : <span aria-hidden>○</span>}
                    {ch.t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 justify-self-end text-right">
              <span className="font-dot text-[clamp(62px,6.5vw,84px)] leading-[.8] font-extrabold tracking-[-0.02em] tnum">{big}</span>
              <span className="max-w-[220px] text-[15px]">{bigLabel}</span>
            </div>
          </div>
        </section>

        {states.map(({ s, st }) => {
          const where = multi ? ` · ${placeOf(s).toUpperCase()}` : ''
          if (st === 'pending' && stalled(s))
            // Home's "didn't finish" links here: waiting longer will not change this one (polling has stopped).
            return (
              <StatusCard
                key={s.id}
                eyebrow={`DID NOT FINISH${where}`}
                title="This check-in did not finish."
                body={<>{s.status === 'uploading' ? 'The photos never finished uploading, so nothing was measured.' : 'Measuring stopped before a result came back. The photos are saved, so it can be measured again.'}</>}
                action={
                  s.status === 'uploading' ? (
                    <Button variant="ink" size="lg" onClick={checkIn}>
                      Take a new check-in
                    </Button>
                  ) : (
                    <Button variant="ink" size="lg" onClick={() => measureAgain(s)}>
                      Measure again
                    </Button>
                  )
                }
              />
            )
          if (st === 'pending')
            return (
              <StatusCard
                key={s.id}
                busy
                eyebrow={`STILL MEASURING${where}`}
                title="This check-in is still being measured."
                body={<>Your photos are uploaded. Results show here as soon as the measurement finishes; this page checks again on its own.</>}
                action={
                  <Button variant="outline" onClick={() => void data.refresh()}>
                    Check now
                  </Button>
                }
              />
            )
          if (st === 'failed')
            return (
              <StatusCard
                key={s.id}
                eyebrow={`DID NOT FINISH${where}`}
                title="This check-in did not finish measuring."
                body={<>{retryable(s) ? 'The photos are saved, so it can be measured again.' : (s.error?.message ?? 'The photos could not be read.')}</>}
                action={
                  retryable(s) ? (
                    <Button variant="ink" size="lg" onClick={() => measureAgain(s)}>
                      Try again
                    </Button>
                  ) : (
                    <Button variant="ink" size="lg" onClick={checkIn}>
                      Take new photos
                    </Button>
                  )
                }
              />
            )
          return null
        })}

        {told.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3">
            {told.map((x, k) => (
              <InsightsCard key={x.s.id} session={x.s} measured={isMeasured(x.st)} place={multi ? placeOf(x.s) : undefined} actions={nextFor(x.s, x.st, k === 0)} />
            ))}
          </div>
        ) : null}

        {ordered.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">
            {ordered.map(({ m, s, st }, i) => {
              // counts of a check-in with (or without) cheek photos compare with one taken the same way
              const ref = referenceFor(m.id, s, baseOf(s), seriesOf(s))
              return (
                <MetricTile
                  key={`${s.id}:${m.id}`}
                  metric={m}
                  session={s}
                  place={twice.has(m.id) ? placeOf(s) : undefined}
                  onOpen={() => showMetric(s, m.id)}
                  band={s.is_baseline || st === 'former' ? m.mdc95 : st === 'compared' ? bandOf(ref, m.id) : null}
                  delay={i * 60}
                />
              )
            })}
          </div>
        ) : null}

        {states.map(({ s, st }) => (
          <PlaceSection
            key={s.id}
            session={s}
            st={st}
            sessions={seriesOf(s)}
            baseline={baseOf(s)}
            order={ordered.filter((i) => i.s === s).map((i) => i.m.id)}
            live={data.mode === 'live'}
            withTime={list.filter((x) => x.site === s.site).length > 1}
            onCheckIn={checkIn}
            onBaseline={() => setAsking(s)}
            onOpenMetric={(id) => showMetric(s, id)}
          />
        ))}

        <p className="m-0 pt-2 text-caption text-ink-2">Photos delete 30 days after upload; measurements stay in your account until you delete them.</p>
        <Disclaimer />
      </div>
      <BaselineDialog session={asking ?? primary} withTime={list.filter((x) => x.site === (asking ?? primary).site).length > 1} open={asking !== null} onClose={() => setAsking(null)} />
      <MetricSheet
        metric={open?.m ?? null}
        session={sheetSession}
        baseline={sheetRef}
        baselineLabel={sheetRefLabel}
        sessions={seriesOf(sheetSession)}
        onClose={closeMetric}
        onAsk={(m) => {
          // The sheet is a modal <dialog> (top layer): close it, or the advisor opens hidden behind it.
          closeMetric()
          shell.openAdvisor(metricQuestion(m, sheetSession, sheetBase), `${METRIC_META[m.id].label} · ${fmtDate(sheetSession.created_at)}`)
        }}
      />
      <TomorrowSheet open={tomorrow} onClose={() => setTomorrow(false)} />
    </Page>
  )
}

/** One place's part of the day below the readings: its photo (spots, redness, areas; hold to compare with the
 * baseline) with Compare photos and the baseline button, or why nothing was measured. */
function PlaceSection({ session, st, sessions, baseline, order, live, withTime, onCheckIn, onBaseline, onOpenMetric }: { session: Session; st: string; sessions: Session[]; baseline: Session | null; order: MetricId[]; live: boolean; withTime: boolean; onCheckIn: () => void; onBaseline: () => void; onOpenMetric: (id: MetricId) => void }) {
  // The single-session view signs what the list does not: the redness overlay, every frame, the spot crops.
  const view = useSessionView(st !== 'pending' ? session.id : null)
  if (st === 'rejected')
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[36px] bg-surface p-[clamp(22px,3vw,30px)] squircle">
          <span className="flex max-w-[620px] flex-col gap-1.5">
            <span className="text-[20px]">No readings from your {SITE_LABEL[session.site].toLowerCase()}</span>
            <span className="text-[15px] leading-normal text-ink-2">{`${rejectNote(session)}${baseline ? ' Your baseline is unchanged.' : ''}`}</span>
          </span>
          <Button variant="primary" size="lg" onClick={onCheckIn} trailing={<span aria-hidden>→</span>}>
            Take new photos
          </Button>
        </div>
        <RejectedPhotos session={session} frameUrls={view?.session.frame_urls} />
      </>
    )
  if (st === 'unmeasured') return <UnmeasuredPhotos session={session} frameUrls={view?.session.frame_urls} />
  if (!isMeasured(st)) return null
  return (
    <section aria-label={SITE_LABEL[session.site]} className="flex flex-col">
      <div className="-mb-2 flex flex-wrap items-center justify-between gap-2 pt-6">
        <h2 className="m-0 text-[20px] font-normal">{SITE_LABEL[session.site]}</h2>
        <div className="flex flex-wrap gap-2">
          <CompareButton key={session.id} session={session} sessions={sessions} baseline={baseline} />
          {live ? (
            <Button variant="outline" size="sm" disabled={!canBeBaseline(session)} onClick={onBaseline}>
              {session.is_baseline ? 'This is your baseline' : canBeBaseline(session) ? `Use ${fmtDate(session.created_at)}${withTime ? `, ${clockOf(session.created_at)}` : ''} as baseline` : 'Not eligible as a baseline'}
            </Button>
          ) : null}
        </div>
      </div>
      <PhotoPanel session={session} baseline={st === 'compared' ? baseline : null} view={view} order={order} onOpenMetric={onOpenMetric} />
    </section>
  )
}

/** "Compare photos" button and its popup: Earlier / Later photo comparison over this place's check-ins (design split slider). */
function CompareButton({ session, sessions, baseline }: { session: Session; sessions: Session[]; baseline: Session | null }) {
  const pool = sessions.filter((s) => s.status === 'done' && s.measured !== false)
  const [a, setA] = useState<string>(baseline && baseline.id !== session.id ? baseline.id : (pool[0]?.id ?? session.id))
  const [b, setB] = useState<string>(session.id)
  const A = pool.find((s) => s.id === a) ?? session
  const B = pool.find((s) => s.id === b) ?? session
  // Two check-ins on one day are told apart by their time.
  const label = (s: Session) =>
    optionLabel(s, pool)
      .replace(/ · .*$/, '')
      .toUpperCase()
  const layer = (s: Session) => <PhotoFrame session={s} box={frameFor(s.site, s.result, photoSize(s))} alt={`Photo from ${fmtDate(s.created_at, { day: 'numeric', month: 'long' })}`} missing={photoExpired(s) ? 'Photo deleted after 30 days' : 'No photo preview'} rounded="rounded-none" />
  const select = (lbl: string, value: string, set: (v: string) => void) => (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[12px] text-ink-2">
      {lbl}
      <select value={value} onChange={(e) => set(e.target.value)} className="min-h-11 rounded-[14px] border-0 bg-canvas px-3 text-[14px] text-ink">
        {pool.map((s) => (
          <option key={s.id} value={s.id}>
            {optionLabel(s, pool)}
          </option>
        ))}
      </select>
    </label>
  )
  // A comparison needs a photo to look at: without any photo that loads (RAW references, photos deleted after 30 days) the button stays disabled.
  const urls = pool.flatMap((s) => (s.preview?.url ? [s.preview.url] : []))
  const hasPhotos = useAnyPhotoLoads(urls) !== 'no'
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="glass" size="sm" icon={Images} disabled={!hasPhotos} title={hasPhotos ? undefined : `No photos to compare${pool.some(photoExpired) ? ' (photos are deleted after 30 days)' : ''}`} onClick={() => setOpen(true)}>
        Compare photos
        {hasPhotos ? null : <span className="text-ink-2"> · no photos</span>}
      </Button>
      <Sheet open={open && hasPhotos} onClose={() => setOpen(false)} title="Compare photos" variant="modal" size="md">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {select('Earlier', a, setA)}
            {select('Later', b, setB)}
          </div>
          <CompareSplit className="mx-auto w-full max-w-[min(100%,calc((100dvh-300px)*.8))]" left={layer(A)} right={layer(B)} leftLabel={label(A)} rightLabel={label(B)} />
        </div>
      </Sheet>
    </>
  )
}

/** "Notes" button and its popup: what Willow noted about the day plus the person's own note. */
function NotesButton({ session, notes }: { session: Session; notes: { text: string; dot: string }[] }) {
  const [open, setOpen] = useState(false)
  const count = notes.length + (session.note ? 1 : 0)
  return (
    <>
      <Button variant="glass" size="sm" icon={StickyNote} onClick={() => setOpen(true)}>
        {count ? `Notes · ${count}` : 'Notes'}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notes from this day" variant="modal" size="sm">
        <div className="flex flex-col gap-1">
          {notes.map((n) => (
            <div key={n.text} className="flex items-start gap-3 border-b border-ink/7 py-2.5">
              <span aria-hidden className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: n.dot }} />
              <span className="text-[15px] leading-[1.45]">{n.text}</span>
            </div>
          ))}
          <NoteEditor key={session.id} session={session} empty={!notes.length} />
        </div>
      </Sheet>
    </>
  )
}

/** The person's note on this check-in (PATCH /v1/sessions/{id}, up to 280 characters). */
function NoteEditor({ session, empty }: { session: Session; empty: boolean }) {
  const owner = useOwner()
  const data = useData()
  const { getIdToken } = useAuth()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(session.note ?? '')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const view = await api.patchSession(await getIdToken(), session.id, {
        note: text.trim() || null,
      })
      data.upsert(view)
      setEditing(false)
      toast('Note saved')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the note. Try again.')
    } finally {
      setSaving(false)
    }
  }
  if (editing)
    return (
      <div className="flex flex-col gap-2 pt-2">
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
          Your note
          <textarea value={text} maxLength={280} rows={3} onChange={(e) => setText(e.target.value)} className="rounded-sm bg-sunken p-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line-subtle)] outline-none" placeholder="New lamp, a late night, started a serum…" />
        </label>
        <span className="text-caption text-ink-2">{280 - text.length} characters left</span>
        <div className="flex gap-2">
          <Button variant="ink" size="sm" loading={saving} onClick={() => void save()}>
            Save note
          </Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  return (
    <>
      {session.note ? (
        <div className="flex items-start gap-3 border-b border-ink/7 py-2.5">
          <span aria-hidden className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: NOTE_DOT.note }} />
          <span className="text-[15px] leading-[1.45]">“{session.note}”</span>
        </div>
      ) : empty ? (
        <span className="text-[15px] text-ink-2">Nothing noted on this day.</span>
      ) : null}
      {owner ? (
        <button
          type="button"
          onClick={() => {
            setText(session.note ?? '')
            setEditing(true)
          }}
          className="mt-1 flex min-h-11 items-center self-start text-[14px] underline"
        >
          {session.note ? 'Edit your note' : 'Add a note'}
        </button>
      ) : null}
    </>
  )
}
