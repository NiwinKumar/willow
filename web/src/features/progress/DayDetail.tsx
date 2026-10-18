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
import { stalled } from '../../data/live'
import type { MetricId, RoutineEntry, Session, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { ApiError, api } from '../../lib/api'
import { clockOf, fmtDate, parseDate } from '../../lib/format'
import { METRIC_META, SITE_LABEL } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { VERDICT_WORDS, changeLines, type ChangeWay, type VerdictKind } from '../../lib/verdict'
import { BaselineDialog } from './BaselineDialog'
import { InsightsCard, NextAction } from './ExplanationCard'
import { frameFor, photoSize } from './frame'
import { MetricTile } from './MetricCard'
import { MetricSheet } from './MetricSheet'
import { DAY_HERO, bandOf, baselineFor, referenceFor, canBeBaseline, counts, daySession, dayStatus, metricQuestion, optionLabel, orderMetrics, photoExpired, retryable, sessionState, usableLine, usedFrames } from './model'
import { Page, Pills, StatusCard, TomorrowSheet } from './parts'
import { PhotoFrame } from './PhotoFrame'
import { PhotoPanel } from './PhotoPanel'
import { RejectedPhotos, UnmeasuredPhotos } from './photos'
import { useAnyPhotoLoads } from './useImageStatus'
import { NOTE_DOT, productName, rejectNote, sessionNotes } from './timeline'
import { useSessionView } from './useSessionView'

const NONE: Session[] = []
const TOMORROW_KEY = 'willow.tomorrowShown'

/**
 * A day's result (design "Day detail"), the one result page: one day's check-in of every place, the
 * explanation, its readings (tap one for its detail, ?metric=), the photo with its spots and areas, notes and
 * actions. ?session= picks a check-in of the day, else ?site= a place, else the latest analysed one.
 */
export function DayDetail({ day, byDay, entries }: { day: string; byDay: Map<string, Session[]>; entries: RoutineEntry[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const data = useData()
  const shell = useShell()
  const list = byDay.get(day) ?? []
  const pickId = params.get('session')
  const qSite = params.get('site')
  const session = list.find((s) => s.id === pickId) ?? (list.some((s) => s.site === qSite) ? daySession(list.filter((s) => s.site === qSite)) : list.length ? daySession(list) : null)
  const site: Site = session?.site ?? 'face_full'
  // This place's check-ins: the baseline and the comparison are always within one place.
  const sessions = data.series(site)?.sessions ?? NONE
  const daysSorted = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const di = daysSorted.indexOf(day)
  const prevDay = di > 0 ? daysSorted[di - 1] : null
  const nextDay = di >= 0 && di < daysSorted.length - 1 ? daysSorted[di + 1] : null
  const [asking, setAsking] = useState(false)
  const date = parseDate(day)

  // Still measuring: read again every few seconds until the api answers (no made-up progress). A session
  // stuck for 30 min will not move by waiting, so polling stops there.
  const pending = session ? sessionState(session) === 'pending' : false
  const polling = pending && session !== null && !stalled(session)
  const { refresh } = data
  useEffect(() => {
    if (!polling) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 6000)
    return () => window.clearInterval(t)
  }, [polling, refresh])
  // The single-session view signs what the list does not: the redness overlay, every frame, the spot crops.
  const view = useSessionView(session && !pending ? session.id : null)

  // Metric detail in the URL (?metric=); opening pushes, so Back closes it.
  const metricId = params.get('metric') as MetricId | null
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
        { replace: true, state: location.state },
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
        { replace: true, state: location.state },
      )
    }, 1400)
    return () => window.clearTimeout(t)
  }, [fromCheckIn, session, setParams, location.state])
  // Forearm days have no calendar of their own: their page is the product test.
  const back = () => ((location.state as { fromCalendar?: boolean } | null)?.fromCalendar ? navigate(-1) : navigate(site.startsWith('forearm') ? '/test' : '/progress'))
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

  if (!session)
    return (
      <Page label="Day detail">
        {nav()}
        <EmptyState title="No check-in on this day" body="Pick a coloured day in the calendar." action={<ButtonLink to="/progress">Back to the calendar</ButtonLink>} />
      </Page>
    )

  const st = sessionState(session)
  const status = dayStatus(session)
  const [heroBg, heroGlow] = DAY_HERO[status]
  const baseline = baselineFor(session, sessions)
  const c = counts(session)
  const measured = st === 'compared' || st === 'baseline' || st === 'former'
  const ordered = orderMetrics(session.result?.metrics ?? [], data.goals)
  const chips: { g: VerdictKind | null; t: string; way?: ChangeWay }[] =
    st === 'rejected'
      ? [{ g: 'notCompared', t: 'Not measured' }]
      : st === 'baseline'
        ? [
            { g: 'baseline', t: 'Your starting point' },
            { g: null, t: 'Later days compare with this one' },
          ]
        : st === 'compared'
          ? [...changeLines(session).map((l) => ({ g: 'changed' as const, way: l.way, t: l.text })), ...(['normal', 'notEnough', 'notCompared'] as const).filter((k) => c[k]).map((k) => ({ g: k, t: `${c[k]} ${VERDICT_WORDS[k].label.toLowerCase()}` }))]
          : [
              {
                g: 'notCompared',
                t: st === 'former' ? 'An earlier baseline, not compared' : st === 'pending' ? 'Still measuring' : st === 'failed' ? 'Did not finish measuring' : 'Not measured',
              },
            ]
  const big = st === 'rejected' ? '00' : st === 'baseline' ? String(usedFrames(session)).padStart(2, '0') : st === 'compared' ? String(c.changed).padStart(2, '0') : '—'
  const bigLabel = st === 'rejected' ? 'usable photos' : st === 'baseline' ? 'photos in your baseline' : st === 'compared' ? (c.changed === 1 ? 'reading moved beyond your normal range' : 'readings moved beyond your normal range') : 'not compared'
  const started = entries.filter((e) => e.started_at.slice(0, 10) === day)
  const notes = [
    ...started.map((e) => ({
      text: `Started ${productName(e)}`,
      dot: NOTE_DOT.routine,
    })),
    ...sessionNotes(session).filter((n) => n.kind !== 'note'),
  ]
  const others = list.filter((s) => s.id !== session.id)
  const order = ordered.map((m) => m.id)
  const openMetric = ordered.find((m) => m.id === metricId) ?? null
  const sheetRef = session.is_baseline ? session : openMetric ? referenceFor(openMetric.id, session, baseline, sessions) : baseline
  const sheetRefLabel = sheetRef && sheetRef !== baseline && sheetRef !== session ? `Check-in, ${fmtDate(sheetRef.created_at) === fmtDate(session.created_at) ? clockOf(sheetRef.created_at) : fmtDate(sheetRef.created_at)}` : 'Baseline'
  const checkIn = () => shell.openCheckIn()
  const measureAgain = () => navigate(`/check-in?session=${session.id}`, { state: { background: location } })
  // Under the explanation: what to do next (asking Wisp and the baseline live in the actions card below).
  const next: Record<string, ReactNode[]> = {
    compared: [
      <NextAction key="c" onClick={checkIn}>
        Check in again, same light and distance
      </NextAction>,
    ],
    baseline: [
      <NextAction key="c" onClick={checkIn}>
        {(session.result?.frames_used ?? 0) >= 3 ? 'Next check-in: same light and distance' : 'Check in again with more photos'}
      </NextAction>,
      <NextAction key="r" to="/routine">
        Add the products you’re starting
      </NextAction>,
    ],
    rejected: [
      <NextAction key="c" onClick={checkIn}>
        Retake this check-in
      </NextAction>,
    ],
    unmeasured: [
      <NextAction key="f" onClick={checkIn}>
        Check in instead
      </NextAction>,
    ],
  }
  // Two check-ins of one place on a day are told apart by their time.
  const pillLabel = (s: Session) => `${SITE_LABEL[s.site]}${list.filter((x) => x.site === s.site).length > 1 ? ` · ${clockOf(s.created_at)}` : ''}`
  const sameSite = list.filter((s) => s.site === session.site).length > 1
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="flex min-h-9 items-center px-1 text-[13px] underline underline-offset-4"
        onClick={() =>
          shell.openAdvisor(
            `Help me read my ${SITE_LABEL[site].toLowerCase()} check-in from ${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}: ${st === 'compared' ? `${[...changeLines(session).map((l) => l.text), `${c.normal} within normal range`].join(', ')}` : st === 'baseline' ? 'it is my baseline' : st === 'rejected' ? 'the photos could not be measured' : 'it was not compared'}${started.length ? `. I started ${started.map(productName).join(' and ')} that day` : ''}.`,
            `${SITE_LABEL[site]} · ${fmtDate(session.created_at)}`,
          )
        }
      >
        Ask Wisp about this day
      </button>
      {data.mode === 'live' ? (
        <Button variant="outline" size="sm" disabled={!canBeBaseline(session)} onClick={() => setAsking(true)}>
          {session.is_baseline ? 'This is your baseline' : st === 'rejected' ? 'Not eligible · no usable photos' : canBeBaseline(session) ? `Use ${fmtDate(session.created_at)}${sameSite ? `, ${clockOf(session.created_at)}` : ''} as baseline` : 'Not eligible as a baseline'}
        </Button>
      ) : null}
      {st !== 'pending' ? (
        <ButtonLink to={`/result/${session.id}`} variant="ink" size="sm" trailing={<span aria-hidden>→</span>}>
          Open the full report
        </ButtonLink>
      ) : null}
    </div>
  )

  return (
    <Page label="Day detail">
      <div key={session.id} className="flex animate-[wInR_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-4 pt-[clamp(8px,2vw,20px)]">
        {nav(actions)}
        {others.length ? (
          <Pills
            label="Check-in on this day"
            tone="white"
            options={list.map((s) => ({
              value: s.id,
              label: pillLabel(s),
            }))}
            value={session.id}
            onChange={(id) =>
              setParams((p) => ({ ...Object.fromEntries(p), session: id }), {
                replace: true,
                state: location.state,
              })
            }
          />
        ) : null}

        <section
          aria-label="Day summary"
          className="relative flex flex-col gap-5 overflow-hidden rounded-[48px] p-[clamp(24px,4vw,44px)] text-ink squircle"
          style={{
            background: heroBg,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,.5), inset 0 0 90px rgba(255,255,255,.35), 0 40px 80px -50px ${heroGlow}`,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <span className="font-mono text-[11px] tracking-[.08em]">
              ■ {SITE_LABEL[site].toUpperCase()} · {usableLine(session).toUpperCase()}
            </span>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {measured ? <CompareButton session={session} sessions={sessions} baseline={baseline} /> : null}
              <NotesButton session={session} notes={notes} />
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

        {st === 'pending' && stalled(session) ? (
          // Home's "didn't finish" links here: waiting longer will not change this one (polling has stopped).
          <StatusCard
            eyebrow="DID NOT FINISH"
            title="This check-in did not finish."
            body={<>{session.status === 'uploading' ? 'The photos never finished uploading, so nothing was measured.' : 'Measuring stopped before a result came back. The photos are saved, so it can be measured again.'}</>}
            action={
              session.status === 'uploading' ? (
                <Button variant="ink" size="lg" onClick={checkIn}>
                  Take a new check-in
                </Button>
              ) : (
                <Button variant="ink" size="lg" onClick={measureAgain}>
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
                <Button variant="ink" size="lg" onClick={measureAgain}>
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
          <InsightsCard key={session.id} session={session} measured={measured} actions={next[st] ?? null} />
        )}

        {st === 'rejected' ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[36px] bg-surface p-[clamp(22px,3vw,30px)] squircle">
            <span className="flex max-w-[620px] flex-col gap-1.5">
              <span className="text-[20px]">No readings from this day</span>
              <span className="text-[15px] leading-normal text-ink-2">{`${rejectNote(session)}${baseline ? ' Your baseline is unchanged.' : ''}`}</span>
            </span>
            <Button variant="primary" size="lg" onClick={checkIn} trailing={<span aria-hidden>→</span>}>
              Take new photos
            </Button>
          </div>
        ) : null}
        {st === 'rejected' ? <RejectedPhotos session={session} frameUrls={view?.session.frame_urls} /> : null}
        {st === 'unmeasured' ? <UnmeasuredPhotos session={session} frameUrls={view?.session.frame_urls} /> : null}

        {measured && ordered.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">
            {ordered.map((m, i) => {
              // counts of a check-in with (or without) cheek photos compare with one taken the same way
              const ref = referenceFor(m.id, session, baseline, sessions)
              return (
                <MetricTile
                  key={m.id}
                  metric={m}
                  session={session}
                  onOpen={() => showMetric(m.id)}
                  band={session.is_baseline || st === 'former' ? m.mdc95 : st === 'compared' ? bandOf(ref, m.id) : null}
                  baselineDay={ref ? (fmtDate(ref.created_at) === fmtDate(session.created_at) ? `${ref === baseline ? 'baseline' : 'check-in'}, ${clockOf(ref.created_at)}` : fmtDate(ref.created_at)) : null}
                  delay={i * 60}
                />
              )
            })}
          </div>
        ) : null}

        {measured ? <PhotoPanel session={session} baseline={st === 'compared' ? baseline : null} view={view} order={order} onOpenMetric={showMetric} /> : null}

        <p className="m-0 pt-2 text-caption text-ink-2">Photos delete 30 days after upload; measurements stay in your account until you delete them.</p>
        <Disclaimer />
      </div>
      <BaselineDialog session={session} withTime={sameSite} open={asking} onClose={() => setAsking(false)} />
      <MetricSheet
        metric={openMetric}
        session={session}
        baseline={sheetRef}
        baselineLabel={sheetRefLabel}
        sessions={sessions}
        onClose={closeMetric}
        onAsk={(m) => {
          // The sheet is a modal <dialog> (top layer): close it, or the advisor opens hidden behind it.
          closeMetric()
          shell.openAdvisor(metricQuestion(m, session, baseline), `${METRIC_META[m.id].label} · ${fmtDate(session.created_at)}`)
        }}
      />
      <TomorrowSheet open={tomorrow} onClose={() => setTomorrow(false)} />
    </Page>
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
