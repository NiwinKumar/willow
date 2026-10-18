import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Calendar, KeyRow, TimelineChart, fractionalIndex, type CalendarDay } from '../../components/charts'
import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { WillowLoader } from '../../components/willow/WillowLoader'
import { useRoutine } from '../../data/hooks'
import type { CaptureMode, MetricId, Session, Site } from '../../data/types'
import { SITE_ORDER } from '../../data/live'
import { useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { fmtDate, parseDate, plural } from '../../lib/format'
import { prefs } from '../../lib/prefs'
import { CLOSE_UPS, METRIC_META, SITE_LABEL, byGoalOrder, unitOf } from '../../lib/metrics'
import { DayDetail } from './DayDetail'
import { DAY_BG, DAY_WORDS, bandText, chartable, currentBaseline, dayOf, dayStatus, usedFrames, type DayStatus } from './model'
import { Page } from './parts'
import { metricSeries } from './series'
import { routineNotes, sessionNotes, type Note } from './timeline'

// The places charted here; the forearms are a product test (/test) and only show in the calendar.
const PLACES: Site[] = ['face_full', ...CLOSE_UPS]
const isSite = (v: string | null): v is Site => v !== null && (SITE_ORDER as string[]).includes(v)
// The day colour is the most telling session of the day: a change outranks a baseline, a normal day and so on.
const DAY_RANK: DayStatus[] = ['changed', 'baseline', 'normal', 'notEnough', 'rejected', 'other']

/** One metric of one place, charted against that place's current baseline (the capture mode of its latest check-in). */
type Track = { site: Site; mode: CaptureMode; metric: MetricId; label: string }

/**
 * Progress (design "History and compare"): /progress is one calendar of every place and a metric over time
 * (?metric=, ?site= when a metric is read at more than one place); /progress/:day (YYYY-MM-DD) is that day.
 * Each place keeps its own baseline, so a metric is always charted against the baseline of the place it was read at.
 */
export default function Progress() {
  const { day } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const data = useData()
  const shell = useShell()
  const routine = useRoutine()
  const today = localDay()

  // Every check-in of every place, oldest first.
  const all = useMemo(() => SITE_ORDER.flatMap((p) => data.series(p)?.sessions ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)), [data])
  const lastDone = [...all].reverse().find((s) => s.status === 'done') ?? null
  const byDay = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of all) m.set(dayOf(s), [...(m.get(dayOf(s)) ?? []), s])
    return m
  }, [all])
  const months = useMemo(() => [...new Set([...[...byDay.keys()].map((d) => d.slice(0, 7)), today.slice(0, 7)])].sort(), [byDay, today])
  const [monthPick, setMonthPick] = useState<string | null>(null)
  // One quiet line under the calendar until the person has opened a day from it once (per device).
  const [tapHint] = useState(() => !prefs.coachSeen('calendarDay'))
  const month = monthPick && months.includes(monthPick) ? monthPick : (lastDone ? dayOf(lastDone) : today).slice(0, 7)
  const mi = months.indexOf(month)

  // Each place with readings, against its current baseline: the capture mode of its latest analysed check-in.
  const places = useMemo(
    () =>
      PLACES.flatMap((p) => {
        const list = data.series(p)?.sessions ?? []
        const last = [...list].reverse().find((s) => s.status === 'done')
        return last ? [{ site: p, mode: last.capture_mode, sessions: list }] : []
      }),
    [data],
  )
  // Metrics with a reading somewhere (a rejected check-in lists every metric, all empty), in goal order.
  const tracks = useMemo<Track[]>(() => {
    const raw: Omit<Track, 'label'>[] = []
    for (const p of places) {
      const ids = new Set<MetricId>()
      for (const s of chartable(p.sessions, p.mode)) for (const m of s.result?.metrics ?? []) if (m.value !== null) ids.add(m.id)
      for (const id of ids) raw.push({ site: p.site, mode: p.mode, metric: id })
    }
    const cmp = byGoalOrder(data.goals)
    const twice = (id: MetricId) => raw.filter((t) => t.metric === id).length > 1
    return raw
      .sort((a, b) => cmp(a.metric, b.metric) || PLACES.indexOf(a.site) - PLACES.indexOf(b.site))
      .map((t) => ({ ...t, label: twice(t.metric) ? `${METRIC_META[t.metric].label} · ${SITE_LABEL[t.site].toLowerCase()}` : METRIC_META[t.metric].label }))
  }, [places, data.goals])
  const qMetric = params.get('metric')
  const qSite = params.get('site')
  const track = tracks.find((t) => t.metric === qMetric && (!isSite(qSite) || t.site === qSite)) ?? tracks.find((t) => t.metric === qMetric) ?? tracks.find((t) => t.site === qSite) ?? tracks[0] ?? null
  const metric = track?.metric ?? null
  const trackSessions = useMemo(() => places.find((p) => p.site === track?.site)?.sessions ?? [], [places, track])
  const series = useMemo(() => (track ? metricSeries(trackSessions, track.mode, track.metric) : null), [trackSessions, track])
  const entries = useMemo(() => routine.data ?? [], [routine.data])
  const routineDays = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const e of entries) (m[e.started_at.slice(0, 10)] ??= []).push(e.custom_name || e.brand)
    return m
  }, [entries])

  const markers = useMarkers(series?.sessions ?? [], entries)

  const setQuery = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k)
          else n.set(k, v)
        }
        return n
      },
      { replace: true },
    )

  if ((data.status === 'loading' || data.status === 'idle') && !data.all.length) return <WillowLoader inline label="Loading your progress" />
  if (data.status === 'error' && !data.all.length)
    return (
      <Page label="Progress">
        <EmptyState title="Your progress did not load" body="Check your connection, then try again. Nothing was lost." action={<Button onClick={() => void data.refresh()}>Try again</Button>} />
      </Page>
    )

  if (day) return <DayDetail day={day} byDay={byDay} entries={entries} />

  const hasForearm = data.sites.some((s) => s.startsWith('forearm'))

  // ---- calendar cells ----
  const days: Record<string, CalendarDay> = {}
  for (const [d, list] of byDay) {
    const st = DAY_RANK.find((k) => list.some((x) => dayStatus(x) === k)) ?? 'other'
    const started = routineDays[d] ?? []
    const note = list.some((x) => x.note)
    const when = parseDate(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    const where = [...new Set(list.map((x) => SITE_LABEL[x.site].toLowerCase()))].join(', ')
    days[d] = {
      bg: DAY_BG[st],
      dots: [...(started.length ? ['var(--willow-500)'] : []), ...(note ? ['var(--text-primary)'] : [])],
      label: `${when}, ${list.length > 1 ? `${list.length} check-ins` : 'check-in'} of your ${where}, ${DAY_WORDS[st]}${started.length ? `, started ${started.join(' and ')}` : ''}${note ? ', you added a note' : ''}. Open details`,
      onPick: () => {
        prefs.setCoachSeen('calendarDay')
        navigate(`/progress/${d}`, { state: { fromCalendar: true } })
      },
    }
  }
  const routineDots: Record<string, string[]> = Object.fromEntries(Object.keys(routineDays).map((d) => [d, ['var(--willow-500)']]))

  // ---- chart ----
  const label = track?.label ?? ''
  const sample = metric ? (series?.sessions.map((s) => s.result?.metrics.find((m) => m.id === metric)).find(Boolean) ?? null) : null
  const unit = sample ? unitOf(sample).trim() : ''

  // ---- notes ----
  const multi = new Set(all.map((s) => s.site)).size > 1
  const notes: Note[] = [...routineNotes(entries), ...all.flatMap((s) => sessionNotes(s).map((n) => (multi && n.kind !== 'note' ? { ...n, text: `${SITE_LABEL[s.site]} · ${n.text}` } : n)))].sort((a, b) => a.day.localeCompare(b.day))

  return (
    <Page label="Progress">
      <div className="flex animate-[wInL_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-[clamp(8px,2vw,24px)] pb-2">
          <h1 className="m-0 font-serif text-[clamp(31px,3vw,44px)] leading-[.9] font-normal">Your skin, over time</h1>
          {hasForearm ? (
            <Link to="/test" className="flex min-h-11 items-center text-[15px] text-ink">
              Product test →
            </Link>
          ) : null}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-stretch gap-4">
          <section aria-label="Calendar" className="flex flex-col gap-3.5 rounded-[44px] bg-surface p-[clamp(16px,2.6vw,28px)] shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
            <Calendar
              month={month}
              days={days}
              today={today}
              dots={routineDots}
              onToday={() => shell.openCheckIn()}
              canPrev={mi > 0}
              canNext={mi < months.length - 1}
              onPrev={() => mi > 0 && setMonthPick(months[mi - 1])}
              onNext={() => mi < months.length - 1 && setMonthPick(months[mi + 1])}
              legend={
                <>
                  {(['baseline', 'changed', 'normal', 'notEnough', 'rejected', 'other'] as const).map((k) => (
                    <KeyRow key={k} swatch={{ background: DAY_BG[k] }}>
                      {DAY_WORDS[k]}
                    </KeyRow>
                  ))}
                  <KeyRow swatch={{ border: '1.5px dashed var(--text-primary)' }}>Today</KeyRow>
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden className="ml-2 size-1.5 rounded-full bg-willow-500" />
                    <span className="ml-2">Started a product</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden className="ml-2 size-1.5 rounded-full bg-ink" />
                    <span className="ml-2">You added a note</span>
                  </span>
                </>
              }
            />
            {!all.length ? (
              <p className="m-0 text-[14px] text-ink-2">No check-ins yet. Tap today to take one.</p>
            ) : tapHint ? (
              <p className="m-0 text-[13px] text-ink-2">Tap a coloured day to open it.</p>
            ) : null}
          </section>

          <section aria-label="Metric over time" className="flex flex-col justify-between gap-4 rounded-[44px] bg-selected p-[clamp(20px,3vw,30px)] text-inverse shadow-[0_40px_80px_-50px_rgba(0,0,0,.7)] squircle">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 className="m-0 text-[24px] font-normal">{label || 'Over time'}</h2>
              <div className="flex flex-wrap gap-1">
                {tracks.map((t) => {
                  const on = t === track
                  return (
                    <button key={`${t.site}.${t.metric}`} type="button" aria-pressed={on} onClick={() => setQuery({ metric: t.metric, site: t.site })} className={`min-h-10 rounded-pill border border-[#333] px-3.5 text-[13px] transition-colors ${on ? 'bg-white text-ink' : 'text-white'}`}>
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {series && series.points.some((p) => p.value !== null) && metric ? (
              <TimelineChart
                points={series.points}
                baseIndex={series.baseIndex}
                band={series.band}
                markers={markers}
                format={series.format}
                unit={unit}
                glow
                caption={`${metric ? METRIC_META[metric].label : label} by check-in${track ? `, ${SITE_LABEL[track.site].toLowerCase()}` : ''}`}
                summary={`${label} across ${series.points.length} check-ins${series.band !== null && sample ? `, normal range ${bandText(sample, series.band)} around the baseline` : ', no normal range yet'}.`}
              />
            ) : (
              <p className="m-0 py-16 text-center text-[15px] text-white/70">No check-ins with readings yet.</p>
            )}
            <div className="flex flex-wrap gap-4 text-[13px] text-white/70">
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-2 w-[18px] rounded-[8px]" style={{ background: 'linear-gradient(90deg, var(--aura-violet), var(--aura-pink))' }} />
                Normal range around baseline
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-full bg-lime" />
                Baseline
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden className="w-3.5 border-t-2 border-dashed border-lime" />
                Routine change
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-full border border-dashed border-white/60" />
                No reading
              </span>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
          <BaselinesCard places={places} onCheckIn={() => shell.openCheckIn()} />
          <NotesCard notes={notes} />
        </div>
        <Disclaimer />
      </div>
    </Page>
  )
}

/** Routine starts placed between the check-ins around them. */
function useMarkers(sessions: Session[], entries: { started_at: string; custom_name: string; brand: string }[]) {
  return useMemo(() => {
    const times = sessions.map((s) => new Date(s.created_at).getTime())
    return entries
      .map((e) => ({ at: fractionalIndex(times, parseDate(e.started_at.slice(0, 10)).getTime()), label: `${(e.custom_name || e.brand).toUpperCase().slice(0, 18)} · ${fmtDate(e.started_at.slice(0, 10)).toUpperCase()}` }))
      .filter((m): m is { at: number; label: string } => m.at !== null)
      .slice(0, 6)
  }, [sessions, entries])
}

/** Every place's current baseline: each place is compared only with its own. */
function BaselinesCard({ places, onCheckIn }: { places: { site: Site; mode: CaptureMode; sessions: Session[] }[]; onCheckIn: () => void }) {
  const rows = places.map((p) => ({ site: p.site, baseline: currentBaseline(p.sessions, p.mode) }))
  const set = rows.filter((r): r is { site: Site; baseline: Session } => r.baseline !== null)
  const thin = set.some((r) => usedFrames(r.baseline) < 3)
  return (
    <section
      aria-label="Your baselines"
      className="relative flex flex-col gap-[18px] overflow-hidden rounded-[44px] p-[clamp(22px,3vw,32px)] text-ink squircle"
      style={{ background: 'radial-gradient(70% 90% at 92% 100%, #C8E62E 0%, var(--signal-baseline) 30%, rgba(220,242,75,.25) 60%, transparent 80%), #F3F5E6', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.6), inset 0 0 70px rgba(255,255,255,.4), 0 30px 70px -50px rgba(140,170,20,.6)' }}
    >
      <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ {rows.length > 1 ? 'YOUR BASELINES' : 'YOUR BASELINE'}</span>
      {set.length ? (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {rows.map(({ site, baseline }) => (
              <li key={site} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink/10 py-3 last:border-b-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-ink-2">{SITE_LABEL[site]}</span>
                  <span className="font-serif text-[clamp(22px,2.2vw,30px)] leading-none">{baseline ? fmtDate(baseline.created_at, { day: 'numeric', month: 'long' }) : 'Not set yet'}</span>
                </span>
                {baseline ? (
                  <span className="flex items-center gap-3">
                    <span className="text-[13px] text-ink-2">{plural(usedFrames(baseline), 'usable photo')}</span>
                    <Link to={`/progress/${dayOf(baseline)}?session=${baseline.id}`} state={{ fromCalendar: true }} aria-label={`Open the ${SITE_LABEL[site].toLowerCase()} baseline`} className="flex min-h-11 items-center rounded-pill bg-selected px-4 text-[13px] text-inverse no-underline">
                      Open →
                    </Link>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="m-0 max-w-[460px] text-[15px] leading-normal">
            Every later reading of a place is compared with that place’s baseline. A change counts only when it goes beyond your normal photo-to-photo range.
            {thin ? ' A baseline with fewer than 3 usable photos has no normal range yet: changes are shown, never called real.' : ''}
          </p>
          <span className="text-[13px] text-ink-2">To change a baseline, open another day.</span>
        </>
      ) : (
        <>
          <span className="font-serif text-[clamp(28px,2.86vw,39px)] leading-[.95]">Not set yet</span>
          <p className="m-0 max-w-[420px] text-[15px] leading-normal">Your first usable check-in becomes your baseline. Take 3 or more photos of each place so Willow can measure your normal range.</p>
          <Button variant="ink" onClick={onCheckIn} className="self-start">
            Check in
          </Button>
        </>
      )}
    </section>
  )
}

function NotesCard({ notes }: { notes: Note[] }) {
  const [all, setAll] = useState(false)
  const list = all ? notes : notes.slice(-8)
  return (
    <section aria-label="Notes and routine changes" className="flex flex-col gap-1.5 rounded-[44px] bg-surface/70 p-[clamp(22px,3vw,32px)] squircle">
      <span className="mb-2 font-mono text-[12px] text-ink-2">■ NOTES AND ROUTINE CHANGES</span>
      {notes.length > 8 ? (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="min-h-11 self-start rounded-pill bg-sunken px-4 text-[13px] hover:bg-muted">
          {all ? 'Show the latest 8' : `Show all ${notes.length}`}
        </button>
      ) : null}
      {list.length ? (
        <ul className="m-0 list-none p-0">
          {list.map((n, i) => (
            <li key={`${n.day}${i}`} className="flex items-start gap-3.5 border-b border-ink/7 py-2.5">
              <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full" style={{ background: n.dot }} />
              <span className="w-16 shrink-0 font-mono text-[13px]">{fmtDate(n.day)}</span>
              <span className="text-[15px] leading-[1.4]">{n.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[15px] text-ink-2">Nothing yet. Products you add to your routine and notes on check-ins show here.</span>
      )}
    </section>
  )
}
