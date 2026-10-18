import { useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { activeIn, useRoutine, useRoutineCheck, useRoutineLog, useSetRoutineUse } from '../../data/hooks'
import { counts, useCheckin, useCheckinDue } from '../../data/useCheckin'
import type { RoutineEntry, Session } from '../../data/types'
import { demoUnavailable } from '../../data/demoSource'
import { leaveDemo, useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { parseDate, plural } from '../../lib/format'
import { identity } from '../../lib/identity'
import { placesOf } from '../../lib/profile'
import { minutesFor } from '../../lib/track'
import { routineEffect } from '../../lib/routineEffect'
import { addToCalendar } from '../../lib/reminders'
import { fmtDay, gapDaysFor, scheduleText, weeklyDayOf, type Checkin, type Due } from '../../lib/schedule'
import { fmtSigned, METRIC_META, qualityCopy, unitOf } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { CHANGE_WORDS, VERDICT_WORDS, changeLines, changeTitle, changeWay, type VerdictKind } from '../../lib/verdict'
import { ChangedCard, GoalsCard, RoutineEffectCard, SetupCard, WeekBand, type SetupRow } from './cards'
import { BAND_FRAMES, cap, clock, countWord, dayOf, daysSince, inFlight, latest, listOf, lowerFirst, readHome, runOf, SITE_SHORT, shortDay, shortName, splitVerdicts, stalled, today, usable, verdictSentence, type HomeRead } from './derive'
import { useProductTests } from '../routine/productTests'
import { useOutcomeSessions } from '../routine/routineModel'
import { restsOn } from '../routine/schedule'
import { readForearm } from './forearm'
import { HeroCard, type HeroLine } from './HeroCard'
import { goalTrends } from './goals'
import { LeadCard, type Lead } from './LeadCard'
import { topUpNeed } from '../checkin/topup'
import { RoutineEmpty, RoutineToday } from './RoutineToday'
import { BaselineTile, ProductTestTile } from './Tiles'

const POLL_MS = 10_000
const EMPTY: Session[] = []

/**
 * Home (Willow App.dc.html, isHome): greeting, today's check-in, what changed, routine today, product test,
 * next step and recent activity, all read from the person's own sessions and routine. Demo mode
 * shows the team's journey read-only.
 */
export default function Home() {
  const data = useData()
  const navigate = useNavigate()
  // A refresh that fails keeps the last sessions on screen (with a note); only a first load that fails is an error page.
  if ((data.status === 'loading' || data.status === 'idle') && data.all.length === 0) return <HomeSkeleton />
  if (data.status === 'error' && data.all.length === 0) {
    return (
      <Frame>
        {data.mode === 'demo' ? (
          <EmptyState
            {...(demoUnavailable() === 'empty'
              ? { title: 'The demo journey has no check-ins yet', body: "It shows our team's own check-ins, measured by the live engine, and none have been measured yet. Your own check-ins are in your account." }
              : { title: "The demo journey can't be read right now", body: "It is our team's own measured check-ins, read from the live api. Try again in a moment, or leave the demo." })}
            action={
              <Button
                variant="ink"
                onClick={() => {
                  leaveDemo()
                  navigate('/home', { replace: true })
                }}
              >
                Leave demo
              </Button>
            } />
        ) : (
          <EmptyState title="Your check-ins didn't load" body="Willow couldn't reach the server. Nothing is lost; try again." action={<Button variant="ink" onClick={() => void data.refresh()}>Try again</Button>} />
        )}
      </Frame>
    )
  }
  return <HomeBody />
}

function Frame({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <main aria-busy={busy || undefined} className="relative mx-auto flex max-w-[1320px] flex-col gap-3.5" style={{ padding: 'clamp(10px,1.6vw,22px) clamp(16px,3vw,32px) 24px' }}>
      {children}
    </main>
  )
}

function HomeBody() {
  const data = useData()
  const { user, getIdToken } = useAuth()
  const me = identity(user)
  const shell = useShell()
  const navigate = useNavigate()
  const demo = data.mode === 'demo'
  // Goals live on this device (You writes them); read fresh so a change there reorders Home at once.
  const goals = data.goals
  // Judge sample runs (hosted sample photos, sample_id) are not the person's own check-ins: Home's
  // greeting, lead card and week never read them; Recent lists them as sample runs.
  const own = useMemo(() => data.all.filter((s) => !s.sample_id), [data.all])
  const faceAll = data.series('face_full')?.sessions ?? EMPTY
  const face = useMemo(() => (faceAll.some((s) => s.sample_id) ? faceAll.filter((s) => !s.sample_id) : faceAll), [faceAll])
  // The check-in schedule (You): when check-ins are due, the weekly day, and how long a gap is.
  const checkin = useCheckin()
  const due = useCheckinDue()
  const read = useMemo(() => readHome(own, face, gapDaysFor(checkin)), [own, face, checkin])

  // A check-in still uploading or measuring: re-read sessions every 10 s until its result lands.
  const running = !demo && data.all.some((s) => inFlight(s) && !stalled(s))
  const { refresh } = data
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [running, refresh])

  const routine = useRoutine()
  const entries = routine.data
  const log = useRoutineLog()
  const setUse = useSetRoutineUse()
  const check = useRoutineCheck(entries)
  const tests = useProductTests()
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])

  const day = today()
  const used = (id: string, slot: 'am' | 'pm') => Boolean(log.data?.find((d) => d.date === day)?.used[id]?.includes(slot))
  const toggle = (e: RoutineEntry, slot: 'am' | 'pm', on: boolean) => {
    setUse(day, e.id, slot, on).catch(() => toast.error(`Couldn't save that tick for ${shortName(e)}. Try again.`))
  }

  // The one check-in: every place the person tracks, in one go (the sheet lists them).
  const checkIn = () => shell.openCheckIn()
  const openResult = (s: Session) => navigate(`/result/${s.id}`)
  // Add the missing photos to a baseline without a normal range (the check-in's top-up mode).
  const ask = (text: string, context: string) => shell.openAdvisor(text, context)

  const closeUp = { wanted: goals.includes('pores_texture') || goals.includes('smoother'), doneToday: (data.series('cheek_macro')?.sessions ?? EMPTY).some((s) => counts(s) && dayOf(s.created_at) === day) }
  const tracked = placesOf(data.profile)
  const dueNow = !demo && checkin && due && (due.kind === 'due' || due.kind === 'late')
  const placeChips = demo ? ['Face'] : [...tracked.map((p) => SITE_SHORT[p]), ...(dueNow ? ['Due'] : [])]
  const names = tracked.map((p) => SITE_SHORT[p].toLowerCase())
  const todayLine = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}, about ${minutesFor(tracked)} min`
  const lead = leadFor({ read, goals, demo, checkIn, openResult, placeChips, todayLine })
  const heroLines = withTonight(heroLinesFor(read, goals, demo, due), demo ? null : tonightLine(activeIn(entries, 'pm')))
  const heroNext = demo ? null : read.person === 'new' ? 'No check-ins yet' : (due?.label ?? null)
  const saveCalendar = (c: Checkin) => addToCalendar(getIdToken, c).catch(() => toast.error("Couldn't make the calendar file. Try again."))
  // Routine effect: how each product's target measurement moved since it started (lib/effect.ts).
  const outcomeSessions = useOutcomeSessions()
  const effect = useMemo(() => (demo ? null : routineEffect(entries ?? [], outcomeSessions, check.data)), [demo, entries, outcomeSessions, check.data])
  const forearm = readForearm(data.series('forearm_treated')?.sessions ?? EMPTY, data.series('forearm_control')?.sessions ?? EMPTY, demo ? null : tests.running)
  const latestFace = latest(face, (s) => s.status === 'done')
  const showChanged = Boolean(read.lead && !read.lead.is_baseline)
  // The hero's question follows what the lines above it are about: a check-in from today, an earlier
  // one (the lines still describe it), or no baseline yet.
  const heroAsk =
    read.person === 'new' || read.person === 'noBand'
      ? { label: 'How to start', run: () => ask('How do I take a good face baseline?', 'Today') }
      : latestFace && dayOf(latestFace.created_at) === day
        ? { label: 'Ask about today', run: () => ask('Explain today’s read: what changed and what should I do today?', 'Today') }
        : {
            label: 'Ask about these',
            run: () => ask('Explain my last check-in: what changed, and what should I do until the next one?', latestFace ? `Face check-in · ${shortDay(latestFace.created_at)}` : 'Today'),
          }
  const showSetup = !demo && (read.person === 'new' || read.person === 'noBand')

  const setupRows: SetupRow[] = [
    {
      t: 'Face baseline',
      d: read.person === 'new' ? 'About three minutes, by a window' : `${plural(read.baselineFrames ?? 0, 'usable photo', 'usable photos')} of ${BAND_FRAMES} · no normal range yet`,
      state: read.person === 'new' ? 'todo' : 'part',
      part: Math.min(1, (read.baselineFrames ?? 0) / BAND_FRAMES),
      onClick: checkIn,
    },
    ...(closeUp.wanted
      ? [{ t: 'Cheek close-up', d: 'For your pores and texture goal', state: (data.series('cheek_macro')?.sessions.some(usable) ? 'done' : 'todo') as SetupRow['state'], onClick: checkIn }]
      : []),
    { t: 'Add your routine', d: 'So results can point to products', state: entries?.length ? 'done' : 'todo', onClick: () => navigate('/routine') },
    {
      t: 'Set a reminder',
      d: checkin ? scheduleText(checkin) : 'A few times a week',
      state: checkin ? 'done' : 'todo',
      onClick: () => navigate({ pathname: '/you', hash: '#reminders' }),
      action: checkin ? { label: 'Add to calendar', onClick: () => void saveCalendar(checkin) } : undefined,
    },
    { t: 'Save with Google', d: 'Keep photos and results', state: me.guest ? 'todo' : 'done', onClick: () => navigate('/you') },
  ]

  // Your goals (trends since the baseline) leads the small-card row; What changed (the latest check-in's numbers) sits beside Routine today.
  const trends = useMemo(() => (read.lead && !read.lead.is_baseline ? goalTrends(read.lead, read.baseline, face, goals) : []), [read.lead, read.baseline, face, goals])
  const measured = showChanged ? read.lead : null
  const goalsNode = (cls: string) =>
    measured && trends.length ? (
      <GoalsCard
        className={cls}
        trends={trends}
        baseline={read.baseline}
        onOpen={(m) => navigate(`/result/${measured.id}?metric=${m}`)}
        onProgress={() => navigate('/progress')}
        onAsk={demo ? undefined : () => ask('How are my goals going since my baseline, and what should I do next?', 'Goals')}
      />
    ) : null
  const changedNode = (cls: string) =>
    measured ? (
      <ChangedCard
        className={cls}
        session={measured}
        baseline={read.baseline}
        goals={goals}
        onOpen={(m) => navigate(`/result/${measured.id}?metric=${m}`)}
        onFull={() => openResult(measured)}
        onAsk={demo ? undefined : () => ask('What changed since my baseline, and why?', `Face check-in · ${shortDay(measured.created_at)}`)}
      />
    ) : null

  // Row of smaller cards: as many as exist share the row, so no row has a hole.
  const small: { key: string; node: (cls: string) => ReactNode }[] = []
  if (measured && trends.length) small.push({ key: 'goals', node: goalsNode })
  if (showSetup) small.push({ key: 'setup', node: (cls) => <SetupCard className={cls} rows={setupRows} /> })
  if (effect?.rows.length) small.push({ key: 'effect', node: (cls) => <RoutineEffectCard className={cls} effect={effect} onOpen={() => navigate('/routine')} onAsk={(q) => ask(q, 'Routine effect')} /> })
  // Routine today joins this row (it is the daily one); the product test and your baseline go small, at the foot.
  small.push({ key: 'routine', node: () => routineCard })
  const spans = rowSpans(small.length)
  const foot: { key: string; node: ReactNode }[] = []
  if (forearm) foot.push({ key: 'test', node: <ProductTestTile className="flex-1" read={forearm} onOpen={() => navigate('/test')} /> })
  if (read.baseline && !demo) foot.push({ key: 'baseline', node: <BaselineTile className="flex-1" baseline={read.baseline} onOpen={() => navigate('/progress')} /> })

  const am = activeIn(entries, 'am')
  const pm = activeIn(entries, 'pm')
  const conflict = check.data?.conflicts[0]
  const conflictNames = conflict ? conflict.products.map((id) => byId.get(id)).filter((e): e is RoutineEntry => Boolean(e)) : []
  const short = conflict ? /^([^:.]{3,24}):/.exec(conflict.suggestion)?.[1] : undefined
  const missingSunscreen = Boolean(check.data?.gaps.some((g) => /sunscreen/i.test(g.need)))

  let routineCard: ReactNode
  const routineCls = 'flex-1'
  if (demo) routineCard = <RoutineEmpty demo className={routineCls} onRoutine={() => navigate('/routine')} />
  else if (routine.status === 'loading' || (routine.status === 'idle' && !entries)) routineCard = <CardSkeleton className={routineCls} label="Routine today" />
  else if (routine.status === 'error') {
    routineCard = (
      <section aria-label="Routine today" className={`card flex flex-col items-start gap-2 p-5 ${routineCls}`}>
        <h2 className="m-0 text-h3 font-normal">Routine today</h2>
        <p className="m-0 text-[13px] text-ink-2">Your routine didn't load.</p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void routine.refetch()}>
          Try again
        </Button>
      </section>
    )
  } else if (am.length + pm.length === 0) routineCard = <RoutineEmpty className={routineCls} onRoutine={() => navigate('/routine')} />
  else {
    routineCard = (
      <RoutineToday
        className={routineCls}
        am={am}
        pm={pm}
        used={used}
        onToggle={toggle}
        missingSunscreen={missingSunscreen}
        conflict={conflictNames.length ? { label: `${conflictNames.map(shortName).join(' & ')}${short ? `: ${short.toLowerCase()}` : ''}`, title: conflict!.issue } : null}
        onRoutine={() => navigate('/routine')}
      />
    )
  }

  const week = demo ? null : weekOf(own, read, goals, weeklyDayOf(checkin))

  return (
    <Frame>
      {data.status === 'error' ? (
        <div role="status" className="glass-pill flex flex-wrap items-center gap-3 self-center rounded-pill py-1.5 pr-1.5 pl-4 text-[13px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]">
          Couldn't refresh. Showing your last saved check-ins.
          <button type="button" onClick={() => void data.refresh()} className="min-h-9 rounded-pill bg-selected px-3.5 text-inverse">
            Retry
          </button>
        </div>
      ) : null}
      {week ? <WeekBand {...week} onProgress={() => navigate('/progress')} /> : null}
      <div className="@container grid grid-cols-12 items-stretch gap-3.5">
        <div className="col-span-12 flex min-w-0 @min-[720px]:col-span-6 [&>section]:flex-1">
          <HeroCard
            name={me.guest ? null : me.first}
            next={heroNext}
            lines={heroLines}
            onAsk={demo ? undefined : heroAsk.run}
            askLabel={heroAsk.label}
          />
        </div>
        <div className="col-span-12 flex min-w-0 @min-[720px]:col-span-6 [&>section]:flex-1">
          <LeadCard lead={lead} />
        </div>
        {small.map((c, i) => (
          <SmallSlot key={c.key} cls={spans[i]}>
            {c.node('flex-1')}
          </SmallSlot>
        ))}
        {changedNode(foot.length ? 'col-span-12 @min-[960px]:col-span-6' : 'col-span-12')}
        {foot.length ? (
          // Beside "Since your baseline": the small tiles stacked; without it, side by side.
          <div className={`col-span-12 flex min-w-0 gap-3.5 ${measured ? 'flex-col @min-[960px]:col-span-6' : 'flex-col @min-[560px]:flex-row'}`}>
            {foot.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-1">
                {f.node}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Frame>
  )
}

function SmallSlot({ cls, children }: { cls: string; children: ReactNode }) {
  return <div className={`flex min-w-0 ${cls}`}>{children}</div>
}

/** Literal classes (Tailwind only generates what it can read). Quarter cards from a 960px column, pairs from 560px. */
const Q: Record<number, string> = { 3: '@min-[960px]:col-span-3', 4: '@min-[960px]:col-span-4', 6: '@min-[960px]:col-span-6', 12: '@min-[960px]:col-span-12' }
const T: Record<number, string> = { 6: '@min-[560px]:col-span-6', 12: '@min-[560px]:col-span-12' }

/** Spans for n cards in the small-card row: up to four per row on desktop, pairs on tablet, never a hole. */
function rowSpans(n: number): string[] {
  const rows = n <= 4 ? [n] : n === 5 ? [3, 2] : [3, n - 3]
  const desk = rows.flatMap((k) => Array.from({ length: k }, () => 12 / k))
  return desk.map((d, i) => `col-span-12 ${T[n % 2 === 1 && i === n - 1 ? 12 : 6]} ${Q[d]}`)
}

function leadFor({
  read,
  goals,
  demo,
  checkIn,
  openResult,
  placeChips,
  todayLine,
}: {
  read: HomeRead
  goals: string[]
  demo: boolean
  checkIn: () => void
  openResult: (s: Session) => void
  placeChips: string[]
  todayLine: string
}): Lead {
  if (demo) {
    const s = read.lead
    if (!s) return { title: 'Demo journey', sub: 'This journey has no measured face check-in to show.', aura: 'violet', note: 'Check-ins are available in your own account' }
    return { ...doneLead(s, goals, `LATEST CHECK-IN · ${shortDay(s.created_at).toUpperCase()}`), cta: { label: 'See result', onClick: () => openResult(s) }, note: 'Check-ins are available in your own account' }
  }
  const t = read.todaySession
  if (t) {
    const site = SITE_SHORT[t.site].toUpperCase()
    const again = { label: 'Check in again', onClick: checkIn }
    switch (read.todayKind) {
      case 'measuring': {
        const up = t.status === 'uploading'
        return {
          eyebrow: `MEASURING · ${site}`,
          title: up ? 'Uploading your photos' : 'Measuring your photos',
          sub: up ? 'Keep the check-in open until the photos are up.' : 'Correcting colour and measuring. You can leave; the result lands here.',
          steps: [
            { t: up ? 'Uploading photos' : 'Photos uploaded', state: up ? 'current' : 'done' },
            { t: 'Measuring and explaining', state: up ? 'todo' : 'current' },
            { t: 'Result', state: 'todo' },
          ],
          aura: 'violet',
        }
      }
      case 'stalled':
        return { eyebrow: `${site} · ${clock(t.created_at)}`, title: "Today's check-in didn't finish", sub: t.status === 'uploading' ? 'The photos never finished uploading, so nothing was measured.' : 'Measuring stopped before a result came back, so nothing was compared.', cta: again, secondary: { label: 'See it', onClick: () => openResult(t) }, aura: 'grey' }
      case 'failed':
        return { eyebrow: `${site} · ${clock(t.created_at)}`, title: "Today's check-in didn't finish", sub: 'Measuring failed, so nothing was compared with your baseline.', cta: again, secondary: { label: 'See details', onClick: () => openResult(t) }, aura: 'grey' }
      case 'rejected':
        return {
          eyebrow: `${site} · ${clock(t.created_at)}`,
          title: "Today's photos couldn't be measured",
          sub: qualityCopy(t.result?.quality.reasons[0] ?? '', t.site)?.text ?? 'No photo passed the quality check, so nothing was measured.',
          cta: again,
          secondary: { label: 'See why', onClick: () => openResult(t) },
          aura: 'grey',
        }
      case 'unmeasured':
        return { eyebrow: `${site} · ${clock(t.created_at)}`, title: 'Saved, not measured', sub: `Willow kept your ${SITE_SHORT[t.site].toLowerCase()} photos, but this place isn't measured yet.`, cta: { label: 'See it', onClick: () => openResult(t) }, aura: 'grey' }
      case 'done':
        return { ...doneLead(t, goals, `CHECKED IN TODAY · ${t.site === 'face_full' ? '' : `${site} · `}${clock(t.created_at)}`), cta: { label: 'See result', onClick: () => openResult(t) } }
      default:
        break
    }
  }
  const f = read.baselineFrames ?? 0
  switch (read.person) {
    case 'new':
      return { eyebrow: 'START HERE', title: 'Take your baseline', sub: `Your first check-in: ${todayLine}, by a window. ${countWord(BAND_FRAMES)} photos of each place need to pass the quality check. Later check-ins are compared with them.`, big: `0/${BAND_FRAMES}`, bigLabel: 'usable photos needed, from 5 taken', prog: 0, chips: placeChips, cta: { label: 'Start baseline', onClick: checkIn }, aura: 'coral' }
    case 'noBand': {
      // Photos kept (under 30 days): add the missing ones to this same baseline (design: "Add 2 photos").
      const need = topUpNeed(read.baseline)
      if (need > 0 && read.baseline) {
        const b = read.baseline
        return {
          eyebrow: `BASELINE · ${f} OF ${BAND_FRAMES} USABLE PHOTOS`,
          title: 'Finish your face baseline',
          sub: `${need === 1 ? 'One more photo gives' : `${countWord(need)} more photos give`} Willow your normal range. Until then results read “Not enough data yet”. Same light as ${shortDay(b.created_at)}.`,
          big: `${f}/${BAND_FRAMES}`,
          bigLabel: 'usable baseline photos',
          prog: Math.min(1, f / BAND_FRAMES),
          chips: ['Face', `${plural(need, 'photo')} left`],
          cta: { label: 'Check in', onClick: checkIn },
          secondary: { label: 'See baseline', onClick: () => openResult(b) },
          aura: 'coral',
        }
      }
      return {
        eyebrow: `BASELINE · ${plural(f, 'USABLE PHOTO', 'USABLE PHOTOS')}`,
        title: 'Your baseline has no normal range yet',
        sub: `A normal range needs ${BAND_FRAMES} usable photos; this one has ${f}. Take a check-in with ${BAND_FRAMES} or more, then make it your baseline from its result.`,
        big: `${f}/${BAND_FRAMES}`,
        bigLabel: 'usable baseline photos',
        prog: Math.min(1, f / BAND_FRAMES),
        chips: ['Face'],
        cta: { label: 'Check in', onClick: checkIn },
        secondary: read.baseline ? { label: 'See baseline', onClick: () => openResult(read.baseline!) } : undefined,
        aura: 'coral',
      }
    }
    case 'gap':
      return {
        eyebrow: read.lastFace ? `LAST CHECK-IN ${shortDay(read.lastFace.created_at).toUpperCase()}` : undefined,
        title: 'Welcome back',
        sub: 'Your baseline still holds. One check-in picks up where you left off.',
        big: read.lastFace ? String(daysSince(read.lastFace.created_at)) : undefined,
        bigLabel: 'days since your last check-in',
        chips: placeChips,
        cta: { label: 'Check in now', onClick: checkIn },
        aura: 'sky',
      }
    default:
      return {
        eyebrow: read.lastFace ? `LAST CHECK-IN ${shortDay(read.lastFace.created_at).toUpperCase()}` : undefined,
        title: 'Your check-in',
        sub: `${cap(todayLine)}. Same window light as last time keeps results comparable.`,
        big: read.baseline ? String(daysSince(read.baseline.created_at)) : undefined,
        bigLabel: 'days since your baseline',
        chips: placeChips,
        cta: { label: 'Check in', onClick: checkIn },
        aura: 'violet',
      }
  }
}

/** The lead card for a measured session: its verdict counts, a sentence, and the first change as the big number. */
function doneLead(s: Session, goals: string[], eyebrow: string): Lead {
  if (s.is_baseline) {
    const f = s.baseline_ref?.frames ?? s.result?.frames_used ?? 0
    const band = s.baseline_ref?.has_noise_band ?? f >= BAND_FRAMES
    return { eyebrow: eyebrow.replace('CHECKED IN', 'BASELINE SET'), title: 'Baseline set', sub: band ? 'Your normal range is ready. The next check-in shows what changed.' : `It has ${plural(f, 'usable photo', 'usable photos')}; a normal range needs ${BAND_FRAMES}.`, big: String(f), bigLabel: f === 1 ? 'usable photo' : 'usable photos', aura: 'violet' }
  }
  const { changed, normal, kinds } = splitVerdicts(s, goals)
  const notEnough = [...kinds.values()].filter((k) => k === 'notEnough').length
  // The same count words as the Result hero chips (lib/verdict.ts).
  const count = (n: number, k: VerdictKind) => (n ? `${VERDICT_WORDS[k].glyph} ${n} ${VERDICT_WORDS[k].label.toLowerCase()}` : '')
  const chips = [...changeLines(s).map((l) => `${CHANGE_WORDS[l.way].glyph} ${l.text}`), count(normal.length, 'normal'), count(notEnough, 'notEnough')].filter(Boolean)
  const first = changed[0]
  const title = changed.length === 0 ? (normal.length ? 'Within your normal range' : 'Not enough data to compare yet') : changeTitle(changed, (m) => METRIC_META[m.id].label)
  const u = first ? unitOf(first).trim() : ''
  return {
    eyebrow,
    title,
    sub: verdictSentence(s, goals) ?? 'This check-in has no comparison with your baseline yet.',
    chips,
    big: first && first.delta !== null ? fmtSigned(first.delta, first) : undefined,
    bigLabel: first ? `${lowerFirst(METRIC_META[first.id].label)} vs baseline${u ? ` · ${u}` : ''}` : undefined,
    aura: 'violet',
  }
}

function linesFrom(s: Session, face: Session[], goals: string[]): HeroLine[] {
  if (s.is_baseline) {
    const f = s.baseline_ref?.frames ?? s.result?.frames_used ?? 0
    if (!(s.baseline_ref?.has_noise_band ?? f >= BAND_FRAMES)) return [{ g: '◐', t: `Your baseline has ${plural(f, 'usable photo', 'usable photos')}; a normal range needs ${BAND_FRAMES}.` }]
    return [{ g: '·', t: 'Your baseline is set. The next check-in shows what changed.' }]
  }
  const { changed, normal } = splitVerdicts(s, goals)
  const out: HeroLine[] = []
  if (changed.length) {
    const run = runOf(changed[0].id, face, s)
    const first = CHANGE_WORDS[changeWay(changed[0])]
    out.push({ g: first.glyph, t: `${METRIC_META[changed[0].id].label} ${first.label.toLowerCase()}, beyond your normal range${run >= 2 ? `, ${countWord(run).toLowerCase()} check-ins in a row` : ''}.` })
    // The rest, grouped by the way they moved: what improved first, then (gently) what moved the other way.
    for (const way of ['improved', 'otherWay', 'shifted'] as const) {
      const rest = changed.slice(1).filter((m) => changeWay(m) === way)
      if (rest.length) out.push({ g: CHANGE_WORDS[way].glyph, t: `${cap(listOf(rest))} ${CHANGE_WORDS[way].label.toLowerCase()}${way === changeWay(changed[0]) ? ' too' : ''}.` })
    }
  }
  if (normal.length) out.push({ g: '○', t: normal.length <= 2 ? `${cap(listOf(normal))} held within your normal range.` : `${cap(normal.slice(0, 2).map((m) => lowerFirst(METRIC_META[m.id].label)).join(', '))} and ${normal.length - 2} more held within your normal range.` })
  if (!out.length) out.push({ g: '◌', t: 'Not enough data to compare yet: your baseline has no normal range for these.' })
  return out
}

function heroLinesFor(read: HomeRead, goals: string[], demo: boolean, due: Due | null): HeroLine[] {
  const fromLead = read.lead ? linesFrom(read.lead, read.face, goals) : []
  if (demo) return fromLead.slice(0, 3)
  const t = read.todaySession
  const others = read.lead && t && read.lead.id === t.id ? [] : fromLead
  switch (read.todayKind) {
    case 'measuring':
      return [{ g: '◐', t: `Your ${SITE_SHORT[t!.site].toLowerCase()} photos are ${t!.status === 'uploading' ? 'uploading' : 'being measured'}.` }, ...others].slice(0, 3)
    case 'stalled':
    case 'failed':
    case 'rejected':
      return [{ g: '—', t: "Today's photos couldn't be measured." }, ...others, { g: '→', t: 'Another check-in by a window can still count today.' }].slice(0, 3)
    case 'done':
    case 'unmeasured':
      return fromLead.slice(0, 3)
    default:
      break
  }
  const f = read.baselineFrames ?? 0
  if (read.person === 'new')
    return [
      { g: '1', t: 'Today is for your baseline: face photos by a window.' },
      { g: '2', t: 'From the next check-in on, Willow shows what changed.' },
      { g: '○', t: 'Your skin is only ever compared with itself.' },
    ]
  if (read.person === 'noBand')
    return [
      { g: '◐', t: `Your baseline has ${plural(f, 'usable photo', 'usable photos')}; a normal range needs ${BAND_FRAMES}.` },
      topUpNeed(read.baseline) > 0
        ? { g: '→', t: `Add ${plural(topUpNeed(read.baseline), 'photo')} to it, in the same light, and it has one.` }
        : { g: '→', t: `A check-in with ${BAND_FRAMES} or more photos can become your baseline.` },
      { g: '○', t: 'Your skin is only ever compared with itself.' },
    ]
  if (read.person === 'gap')
    return [
      { g: '○', t: 'Welcome back. Your baseline still holds.' },
      { g: '→', t: 'One check-in today picks the trend back up.' },
    ]
  // On a day the schedule doesn't ask for a check-in, say when the next one is.
  const nextLine = due && due.kind === 'upcoming' ? `Next check-in ${fmtDay(due.next)}, by the same window light.` : 'Check in today, by the same window light.'
  return [...fromLead.slice(0, 2), { g: '→', t: nextLine }]
}

/** "☾ Tonight is a glycolic night." when an every-other-night product is on tonight and another rests (from the schedules; no numbers). */
function tonightLine(pm: RoutineEntry[]): HeroLine | null {
  const on = pm.find((e) => e.schedule?.kind === 'alternate' && !restsOn(e))
  if (!on || !pm.some((e) => restsOn(e))) return null
  const name = shortName(on).toLowerCase()
  return /\d/.test(name) ? null : { g: '☾', t: `Tonight is a ${name} night.` }
}

/** The tonight line goes last, in place of a "→" hint when the three lines are taken. */
function withTonight(lines: HeroLine[], tonight: HeroLine | null): HeroLine[] {
  if (!tonight) return lines
  if (lines.length < 3) return [...lines, tonight]
  const i = lines.findIndex((l) => l.g === '→')
  return i === -1 ? lines : [...lines.slice(0, i), ...lines.slice(i + 1), tonight]
}

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * This week: shown on the person's weekly day (the first day of their check-in schedule, else the weekday of
 * the face baseline) once they checked in this week.
 */
function weekOf(all: Session[], read: HomeRead, goals: string[], weeklyDay: number | null) {
  if (!read.baseline) return null
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  if ((weeklyDay ?? (parseDate(read.baseline.created_at).getDay() + 6) % 7) !== dow) return null
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  const keys = days.map((d) => localDay(d))
  const done = all.filter((s) => s.status === 'done' && keys.includes(dayOf(s.created_at)))
  if (!done.length) return null
  const on = new Set(done.map((s) => dayOf(s.created_at)))
  const fmt = (d: Date, month: boolean) => d.toLocaleDateString('en-GB', month ? { day: 'numeric', month: 'short' } : { day: 'numeric' }).toUpperCase()
  const sameMonth = days[0].getMonth() === days[6].getMonth()
  const range = sameMonth ? `${fmt(days[0], false)}–${fmt(days[6], true)}` : `${fmt(days[0], true)} – ${fmt(days[6], true)}`
  const faceCount = done.filter((s) => s.site === 'face_full').length
  const face = latest(done, (s) => s.site === 'face_full' && usable(s) && !s.is_baseline)
  const sentence = face ? verdictSentence(face, goals) : null
  return {
    range,
    // Every place counts here; Progress (where "See progress" goes) shows one place, so say how many were the face.
    summary: `${countWord(done.length)} check-in${done.length === 1 ? '' : 's'}${faceCount && faceCount < done.length ? `, ${faceCount} of your face` : ''}.${sentence ? ` ${sentence}` : ''}`,
    days: days.map((_, i) => ({ d: WEEKDAY[i], name: WEEKDAY_NAME[i], on: on.has(keys[i]), today: i === dow })),
  }
}

function CardSkeleton({ className = '', label, tall }: { className?: string; label: string; tall?: boolean }) {
  return (
    <section aria-label={label} aria-busy className={`card flex flex-col gap-3 p-5 ${tall ? 'min-h-[320px]' : 'min-h-[200px]'} ${className}`}>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-11 w-full" rounded="rounded-[18px]" />
      <Skeleton className="h-11 w-full" rounded="rounded-[18px]" />
      <Skeleton className="mt-auto h-9 w-28" rounded="rounded-pill" />
    </section>
  )
}

function HomeSkeleton() {
  return (
    <Frame busy>
      <span className="sr-only" role="status">
        Loading your check-ins
      </span>
      <div className="@container grid grid-cols-12 gap-3.5">
        <div className="col-span-12 @min-[720px]:col-span-6">
          <span aria-hidden className="skeleton block min-h-[320px] rounded-[36px]" />
        </div>
        <div className="col-span-12 @min-[720px]:col-span-6">
          <span aria-hidden className="skeleton block min-h-[320px] rounded-[36px]" />
        </div>
        {rowSpans(4).map((cls, i) => (
          <div key={i} className={cls}>
            <CardSkeleton label="Loading" />
          </div>
        ))}
      </div>
    </Frame>
  )
}
