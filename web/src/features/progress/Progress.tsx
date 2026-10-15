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
import { useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { fmtDate, parseDate } from '../../lib/format'
import { METRIC_META, SITE_LABEL, orderedGroups, unitOf } from '../../lib/metrics'
import { DayDetail } from './DayDetail'
import { DAY_BG, DAY_WORDS, MODE_LONG, bandText, chartable, currentBaseline, dayOf, daySession, dayStatus, usableLine, usedFrames } from './model'
import { Page, Pills } from './parts'
import { metricSeries } from './series'
import { routineNotes, sessionNotes, type Note } from './timeline'

const PLACES: Site[] = ['face_full', 'cheek_macro', 'nose_macro']
const isPlace = (v: string | null): v is Site => v !== null && (PLACES as string[]).includes(v)
const isMode = (v: string | null): v is CaptureMode => v === 'calibrated_raw' || v === 'uncalibrated'

/**
 * Progress (design "History and compare"): /progress is the calendar and a metric over time for one place
 * (?site=, ?mode=, ?metric=); /progress/:day (YYYY-MM-DD) is that day's detail.
 */
export default function Progress() {
  const { day } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const data = useData()
  const shell = useShell()
  const routine = useRoutine()
  const qSite = params.get('site')
  const site: Site = isPlace(qSite) ? qSite : 'face_full'
  const sessions = useMemo(() => data.series(site)?.sessions ?? [], [data, site])
  const lastDone = [...sessions].reverse().find((s) => s.status === 'done') ?? null
  const qMode = params.get('mode')
  const mode: CaptureMode = isMode(qMode) ? qMode : (lastDone?.capture_mode ?? 'uncalibrated')
  const today = localDay()

  const byDay = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of sessions) m.set(dayOf(s), [...(m.get(dayOf(s)) ?? []), s])
    return m
  }, [sessions])
  const months = useMemo(() => [...new Set([...[...byDay.keys()].map((d) => d.slice(0, 7)), today.slice(0, 7)])].sort(), [byDay, today])
  const [monthPick, setMonthPick] = useState<string | null>(null)
  const month = monthPick && months.includes(monthPick) ? monthPick : (lastDone ? dayOf(lastDone) : today).slice(0, 7)
  const mi = months.indexOf(month)

  // Metrics this place has in this mode, in goal order.
  const metricIds = useMemo(() => {
    const ids = new Set<MetricId>()
    for (const s of chartable(sessions, mode)) for (const m of s.result?.metrics ?? []) ids.add(m.id)
    const groups = orderedGroups(data.goals)
    return [...ids].sort((a, b) => groups.indexOf(METRIC_META[a].group) - groups.indexOf(METRIC_META[b].group))
  }, [sessions, mode, data.goals])
  const qMetric = params.get('metric')
  const metric: MetricId | null = qMetric && metricIds.includes(qMetric as MetricId) ? (qMetric as MetricId) : (metricIds[0] ?? null)
  const series = useMemo(() => (metric ? metricSeries(sessions, mode, metric) : null), [sessions, mode, metric])
  const baseline = currentBaseline(sessions, mode)
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

  if (day) return <DayDetail day={day} site={site} sessions={sessions} byDay={byDay} entries={entries} />

  const places = PLACES.filter((p) => p === site || (data.series(p)?.sessions.length ?? 0) > 0)
  const hasForearm = data.sites.some((s) => s.startsWith('forearm'))

  // ---- calendar cells ----
  const days: Record<string, CalendarDay> = {}
  for (const [d, list] of byDay) {
    const s = daySession(list)
    const st = dayStatus(s)
    const started = routineDays[d] ?? []
    const note = list.some((x) => x.note)
    const when = parseDate(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    days[d] = {
      bg: DAY_BG[st],
      dots: [...(started.length ? ['var(--willow-500)'] : []), ...(note ? ['var(--text-primary)'] : [])],
      label: `${when}, ${list.length > 1 ? `${list.length} check-ins, latest ` : ''}${MODE_LONG[s.capture_mode]}, ${DAY_WORDS[st]}, ${usableLine(s)}${started.length ? `, started ${started.join(' and ')}` : ''}${note ? ', you added a note' : ''}. Open details`,
      onPick: () => navigate(`/progress/${d}?site=${site}`, { state: { fromCalendar: true } }),
    }
  }
  const routineDots: Record<string, string[]> = Object.fromEntries(Object.keys(routineDays).map((d) => [d, ['var(--willow-500)']]))

  // ---- chart ----
  const label = metric ? METRIC_META[metric].label : ''
  const sample = metric ? (series?.sessions.map((s) => s.result?.metrics.find((m) => m.id === metric)).find(Boolean) ?? null) : null
  const unit = sample ? unitOf(sample).trim() : ''

  // ---- notes ----
  const notes: Note[] = [...routineNotes(entries), ...sessions.filter((s) => s.capture_mode === mode).flatMap(sessionNotes)].sort((a, b) => a.day.localeCompare(b.day))

  return (
    <Page label="Progress">
      <div className="flex animate-[wInL_.5s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-[clamp(8px,2vw,24px)] pb-2">
          <h1 className="m-0 font-serif text-[clamp(31px,3vw,44px)] leading-[.9] font-normal">{SITE_LABEL[site]}, over time</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {places.length > 1 ? <Pills label="Place" tone="white" options={places.map((p) => ({ value: p, label: SITE_LABEL[p] }))} value={site} onChange={(v) => setQuery({ site: v, metric: null, mode: null })} /> : null}
            <Pills label="Capture mode" size="lg" options={(['calibrated_raw', 'uncalibrated'] as CaptureMode[]).map((m) => ({ value: m, label: MODE_LONG[m] }))} value={mode} onChange={(v) => setQuery({ mode: v })} />
          </div>
        </div>
        <p className="-mt-1 mb-1 text-[15px] text-ink-2">
          {mode === 'uncalibrated' ? 'Quick photos are uncalibrated and have their own baseline. They are never mixed with RAW.' : 'RAW check-ins, compared with your RAW baseline only.'} The calendar shows both.
          {hasForearm ? (
            <>
              {' '}
              <Link to="/test" className="text-ink">
                Forearm product test →
              </Link>
            </>
          ) : null}
        </p>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-stretch gap-4">
          <section aria-label="Calendar" className="flex flex-col gap-3.5 rounded-[44px] bg-surface p-[clamp(16px,2.6vw,28px)] shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
            <Calendar
              month={month}
              days={days}
              today={today}
              dots={routineDots}
              onToday={() => shell.openCheckIn({ site })}
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
            {!sessions.length ? <p className="m-0 text-[14px] text-ink-2">No check-ins of your {SITE_LABEL[site].toLowerCase()} yet. Tap today to take one.</p> : null}
          </section>

          <section aria-label="Metric over time" className="flex flex-col justify-between gap-4 rounded-[44px] bg-selected p-[clamp(20px,3vw,30px)] text-inverse shadow-[0_40px_80px_-50px_rgba(0,0,0,.7)] squircle">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 className="m-0 text-[24px] font-normal">{label || 'Over time'}</h2>
              <div className="flex flex-wrap gap-1">
                {metricIds.map((id) => (
                  <button key={id} type="button" aria-pressed={id === metric} onClick={() => setQuery({ metric: id })} className={`min-h-10 rounded-pill border border-[#333] px-3.5 text-[13px] transition-colors ${id === metric ? 'bg-white text-ink' : 'text-white'}`}>
                    {METRIC_META[id].label}
                  </button>
                ))}
              </div>
            </div>
            {series && series.points.length && metric ? (
              <TimelineChart
                points={series.points}
                baseIndex={series.baseIndex}
                band={series.band}
                markers={markers}
                format={series.format}
                unit={unit}
                glow
                caption={`${label} by check-in, ${MODE_LONG[mode]}`}
                summary={`${label} across ${series.points.length} ${MODE_LONG[mode]} check-ins${series.band !== null && sample ? `, normal range ${bandText(sample, series.band)} around the baseline` : ', no normal range yet'}.`}
              />
            ) : (
              <p className="m-0 py-16 text-center text-[15px] text-white/70">No {MODE_LONG[mode]} check-ins of your {SITE_LABEL[site].toLowerCase()} with readings yet.</p>
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
          <BaselineCard baseline={baseline} mode={mode} site={site} onCheckIn={() => shell.startCheckIn(site, mode)} />
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

function BaselineCard({ baseline, mode, site, onCheckIn }: { baseline: Session | null; mode: CaptureMode; site: Site; onCheckIn: () => void }) {
  const used = baseline ? usedFrames(baseline) : 0
  return (
    <section
      aria-label="Baseline"
      className="relative flex flex-col gap-[18px] overflow-hidden rounded-[44px] p-[clamp(22px,3vw,32px)] text-ink squircle"
      style={{ background: 'radial-gradient(70% 90% at 92% 100%, #C8E62E 0%, var(--signal-baseline) 30%, rgba(220,242,75,.25) 60%, transparent 80%), #F3F5E6', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.6), inset 0 0 70px rgba(255,255,255,.4), 0 30px 70px -50px rgba(140,170,20,.6)' }}
    >
      <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ YOUR {MODE_LONG[mode].toUpperCase()} BASELINE</span>
      {baseline ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <span className="font-serif text-[clamp(28px,2.86vw,39px)] leading-[.95]">{fmtDate(baseline.created_at, { day: 'numeric', month: 'long' })}</span>
            <span className="flex flex-col items-end gap-1">
              <span className="font-dot text-[44px] leading-[.9] font-extrabold">{String(used).padStart(2, '0')}</span>
              <span className="text-[12px] text-ink-2">usable {used === 1 ? 'photo' : 'photos'}</span>
            </span>
          </div>
          <p className="m-0 max-w-[420px] text-[15px] leading-normal">
            {used >= 3
              ? 'Every later reading is compared with this day. A change counts only when it goes beyond your normal photo-to-photo range.'
              : 'Later check-ins are compared with this day, but with fewer than 3 usable photos there is no normal range: changes are shown, never called real. A check-in with more photos can become your baseline.'}
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <Link to={`/progress/${dayOf(baseline)}?site=${site}&session=${baseline.id}`} state={{ fromCalendar: true }} className="flex min-h-12 items-center rounded-pill bg-selected px-5 text-[14px] text-inverse no-underline">
              Open this day →
            </Link>
            <span className="text-[13px] text-ink-2">To change it, open another day.</span>
          </div>
        </>
      ) : (
        <>
          <span className="font-serif text-[clamp(28px,2.86vw,39px)] leading-[.95]">Not set yet</span>
          <p className="m-0 max-w-[420px] text-[15px] leading-normal">Your first usable {MODE_LONG[mode]} check-in of this place becomes your baseline. Take 3 or more photos so Willow can measure your normal range.</p>
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
