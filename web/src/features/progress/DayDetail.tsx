import { Images, StickyNote } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
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
import type { RoutineEntry, Session, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { ApiError, api } from '../../lib/api'
import { clockOf, fmtDate, parseDate } from '../../lib/format'
import { SITE_LABEL } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { VERDICT_WORDS, type VerdictKind } from '../../lib/verdict'
import { BaselineDialog } from './BaselineDialog'
import { frameFor, photoSize } from './frame'
import { MetricTile } from './MetricCard'
import { DAY_HERO, MODE_LONG, bandOf, baselineFor, referenceFor, canBeBaseline, counts, daySession, dayStatus, optionLabel, orderMetrics, photoExpired, sessionState, usableLine, usedFrames } from './model'
import { Page, Pills } from './parts'
import { PhotoFrame } from './PhotoFrame'
import { useAnyPhotoLoads } from './useImageStatus'
import { NOTE_DOT, productName, rejectNote, sessionNotes } from './timeline'

/** Day detail (design "Day detail"): one day's check-in, its readings, a photo comparison, notes and actions. */
export function DayDetail({ day, site, sessions, byDay, entries }: { day: string; site: Site; sessions: Session[]; byDay: Map<string, Session[]>; entries: RoutineEntry[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const data = useData()
  const shell = useShell()
  const list = byDay.get(day) ?? []
  const pickId = params.get('session')
  const session = list.find((s) => s.id === pickId) ?? (list.length ? daySession(list) : null)
  const daysSorted = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const di = daysSorted.indexOf(day)
  const prevDay = di > 0 ? daysSorted[di - 1] : null
  const nextDay = di >= 0 && di < daysSorted.length - 1 ? daysSorted[di + 1] : null
  const [asking, setAsking] = useState(false)
  const date = parseDate(day)
  // Forearm days have no calendar of their own: their page is the product test.
  const back = () => ((location.state as { fromCalendar?: boolean } | null)?.fromCalendar ? navigate(-1) : navigate(site.startsWith('forearm') ? '/test' : `/progress?site=${site}`))
  const go = (d: string) =>
    navigate(`/progress/${d}?site=${site}`, {
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
        <EmptyState title={`No check-in of your ${SITE_LABEL[site].toLowerCase()} on this day`} body="Pick a coloured day in the calendar." action={<ButtonLink to={`/progress?site=${site}`}>Back to the calendar</ButtonLink>} />
      </Page>
    )

  const st = sessionState(session)
  const status = dayStatus(session)
  const [heroBg, heroGlow] = DAY_HERO[status]
  const baseline = baselineFor(session, sessions)
  const c = counts(session)
  const measured = st === 'compared' || st === 'baseline' || st === 'former'
  const ordered = orderMetrics(session.result?.metrics ?? [], data.goals)
  const chips: { g: VerdictKind | null; t: string }[] =
    st === 'rejected'
      ? [{ g: 'notCompared', t: 'Not measured' }]
      : st === 'baseline'
        ? [
            { g: 'baseline', t: 'Your starting point' },
            { g: null, t: 'Later days compare with this one' },
          ]
        : st === 'compared'
          ? (['changed', 'normal', 'notEnough', 'notCompared'] as const)
              .filter((k) => c[k])
              .map((k) => ({
                g: k,
                t: `${c[k]} ${VERDICT_WORDS[k].label.toLowerCase()}`,
              }))
          : [
              {
                g: 'notCompared',
                t: st === 'former' ? 'An earlier baseline, not compared' : st === 'pending' ? 'Still measuring' : st === 'failed' ? 'Did not finish measuring' : 'Not measured',
              },
            ]
  const big = st === 'rejected' ? '00' : st === 'baseline' ? String(usedFrames(session)).padStart(2, '0') : st === 'compared' ? String(c.changed).padStart(2, '0') : '—'
  const bigLabel = st === 'rejected' ? 'usable photos' : st === 'baseline' ? 'photos in your baseline' : st === 'compared' ? (c.changed === 1 ? 'reading changed beyond your normal range' : 'readings changed beyond your normal range') : 'not compared'
  const started = entries.filter((e) => e.started_at.slice(0, 10) === day)
  const notes = [
    ...started.map((e) => ({
      text: `Started ${productName(e)}`,
      dot: NOTE_DOT.routine,
    })),
    ...sessionNotes(session).filter((n) => n.kind !== 'note'),
  ]
  const others = list.filter((s) => s.id !== session.id)
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="flex min-h-9 items-center px-1 text-[13px] underline underline-offset-4"
        onClick={() =>
          shell.openAdvisor(
            `Help me read my ${SITE_LABEL[site].toLowerCase()} check-in from ${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}: ${st === 'compared' ? `${c.changed} changed, ${c.normal} within normal range` : st === 'baseline' ? 'it is my baseline' : st === 'rejected' ? 'the photos could not be measured' : 'it was not compared'}${started.length ? `. I started ${started.map(productName).join(' and ')} that day` : ''}.`,
            `${SITE_LABEL[site]} · ${fmtDate(session.created_at)}`,
          )
        }
      >
        Ask Wisp about this day
      </button>
      {data.mode === 'live' ? (
        <Button variant="outline" size="sm" disabled={!canBeBaseline(session)} onClick={() => setAsking(true)}>
          {session.is_baseline ? 'This is your baseline' : st === 'rejected' ? 'Not eligible · no usable photos' : canBeBaseline(session) ? `Use ${fmtDate(session.created_at)}${others.length ? `, ${clockOf(session.created_at)}` : ''} as baseline` : 'Not eligible as a baseline'}
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
              label: `${clockOf(s.created_at)} · ${MODE_LONG[s.capture_mode]}`,
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
          className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-end gap-6 overflow-hidden rounded-[48px] p-[clamp(24px,4vw,44px)] text-ink squircle"
          style={{
            background: heroBg,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,.5), inset 0 0 90px rgba(255,255,255,.35), 0 40px 80px -50px ${heroGlow}`,
          }}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <span className="font-mono text-[11px] tracking-[.08em]">
              ■ {MODE_LONG[session.capture_mode].toUpperCase()}
              {session.capture_mode === 'uncalibrated' ? ' · UNCALIBRATED' : ''} · {usableLine(session).toUpperCase()}
            </span>
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
                  {ch.g ? <VerdictGlyph kind={ch.g} /> : <span aria-hidden>○</span>}
                  {ch.t}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {measured ? <CompareButton session={session} sessions={sessions} baseline={baseline} /> : null}
              <NotesButton session={session} notes={notes} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 justify-self-end text-right">
            <span className="font-dot text-[clamp(62px,6.5vw,84px)] leading-[.8] font-extrabold tracking-[-0.02em] tnum">{big}</span>
            <span className="max-w-[220px] text-[15px]">{bigLabel}</span>
          </div>
        </section>

        {st === 'rejected' || st === 'failed' ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[36px] bg-surface p-[clamp(22px,3vw,30px)] squircle">
            <span className="flex max-w-[620px] flex-col gap-1.5">
              <span className="text-[20px]">No readings from this day</span>
              <span className="text-[15px] leading-normal text-ink-2">{st === 'rejected' ? `${rejectNote(session)}${baseline ? ' Your baseline is unchanged.' : ''}` : 'This check-in did not finish measuring.'}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => shell.openCheckIn()} trailing={<span aria-hidden>→</span>}>
              Take new photos
            </Button>
          </div>
        ) : null}

        {measured && ordered.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">
            {ordered.map((m, i) => {
              // counts of a check-in with (or without) cheek photos compare with one taken the same way
              const ref = referenceFor(m.id, session, baseline, sessions)
              return <MetricTile key={m.id} metric={m} session={session} band={session.is_baseline ? m.mdc95 : st === 'compared' ? bandOf(ref, m.id) : null} baselineDay={ref ? (fmtDate(ref.created_at) === fmtDate(session.created_at) ? `${ref === baseline ? 'baseline' : 'check-in'}, ${clockOf(ref.created_at)}` : fmtDate(ref.created_at)) : null} delay={i * 60} />
            })}
          </div>
        ) : null}

        <Disclaimer />
      </div>
      <BaselineDialog session={session} withTime={others.length > 0} open={asking} onClose={() => setAsking(false)} />
    </Page>
  )
}

/** "Compare photos" button and its popup: Earlier / Later photo comparison over same-mode check-ins (design split slider). */
function CompareButton({ session, sessions, baseline }: { session: Session; sessions: Session[]; baseline: Session | null }) {
  const pool = sessions.filter((s) => s.capture_mode === session.capture_mode && s.status === 'done' && s.measured !== false)
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
