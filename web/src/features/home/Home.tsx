import { useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { activeIn, useRoutine, useRoutineCheck, useRoutineLog, useSetRoutineUse, useSpots } from '../../data/hooks'
import { counts, useCheckin, useCheckinDue } from '../../data/useCheckin'
import type { CaptureMode, RoutineEntry, Session } from '../../data/types'
import { demoUnavailable } from '../../data/demoSource'
import { leaveDemo, useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { parseDate, plural } from '../../lib/format'
import { identity } from '../../lib/identity'
import { addToCalendar } from '../../lib/reminders'
import { dueChips, fmtDay, gapDaysFor, scheduleText, weeklyDayOf, type Checkin, type Due } from '../../lib/schedule'
import { fmtSigned, GOALS, METRIC_META, qualityCopy, unitOf } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { VERDICT_WORDS, type VerdictKind } from '../../lib/verdict'
import { ChangedCard, RecentCard, SetupCard, WeekBand, type RecentRow, type SetupRow } from './cards'
import { BAND_FRAMES, cap, clock, countWord, dayOf, daysSince, inFlight, latest, listOf, lowerFirst, readHome, runOf, SITE_SHORT, shortDay, shortName, splitVerdicts, stalled, today, usable, verdictSentence, type HomeRead } from './derive'
import { ApartCard, GapCard, TonightCard, tonightOf } from '../routine/CheckCards'
import { useProductTests } from '../routine/productTests'
import { entryName, findingsOf, type Finding } from '../routine/routineModel'
import { useRoutineWrites } from '../routine/writes'
import { addDays, restsOn } from '../routine/schedule'
import { readForearm } from './forearm'
import { HeroCard, type HeroLine } from './HeroCard'
import { LeadCard, type Lead } from './LeadCard'
import { topUpNeed } from '../checkin/topup'
import { RoutineEmpty, RoutineToday } from './RoutineToday'
import { ProductTestTile, SpotDiaryTile } from './Tiles'

const POLL_MS = 10_000
const EMPTY: Session[] = []
const MODE_LABEL: Record<CaptureMode, string> = { calibrated_raw: 'RAW', uncalibrated: 'Quick' }

/**
 * Home (Willow App.dc.html, isHome): greeting, today's check-in, what changed, routine today, product test,
 * spot diary, next step and recent activity, all read from the person's own sessions and routine. Demo mode
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
  const location = useLocation()
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
  const spots = useSpots()
  const tests = useProductTests()
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])

  const day = today()
  const used = (id: string, slot: 'am' | 'pm') => Boolean(log.data?.find((d) => d.date === day)?.used[id]?.includes(slot))
  const toggle = (e: RoutineEntry, slot: 'am' | 'pm', on: boolean) => {
    setUse(day, e.id, slot, on).catch(() => toast.error(`Couldn't save that tick for ${shortName(e)}. Try again.`))
  }

  const checkIn = (site: Session['site'] = 'face_full', mode?: CaptureMode) => shell.openCheckIn({ site, mode })
  const openResult = (s: Session) => navigate(`/result/${s.id}`)
  // Add the missing photos to a baseline without a normal range (the check-in's top-up mode).
  const topUp = (s: Session) => navigate(`/check-in?topup=${s.id}`, { state: { background: location } })
  const ask = (text: string, context: string) => shell.openAdvisor(text, context)

  const closeUp = { wanted: goals.includes('pores_texture') || goals.includes('smoother'), doneToday: (data.series('cheek_macro')?.sessions ?? EMPTY).some((s) => counts(s) && dayOf(s.created_at) === day) }
  const placeChips = !demo && checkin && due ? dueChips(checkin, due, closeUp) : ['Face']
  const lead = leadFor({ read, goals, demo, checkIn, openResult, topUp, placeChips })
  const heroLines = withTonight(heroLinesFor(read, goals, demo, due), demo ? null : tonightLine(activeIn(entries, 'pm')))
  const heroNext = demo ? null : read.person === 'new' ? 'No check-ins yet' : (due?.label ?? null)
  const saveCalendar = (c: Checkin) => addToCalendar(getIdToken, c).catch(() => toast.error("Couldn't make the calendar file. Try again."))
  // The routine check card: tonight's pair, else the first conflict, else the first gap.
  const yesterday = addDays(day, -1)
  const lastNight = useRoutineLog(yesterday, yesterday)
  const usedLastNight = (id: string) => Boolean(lastNight.data?.find((d) => d.date === yesterday)?.used[id]?.includes('pm'))
  const writes = useRoutineWrites()
  const current = useMemo(() => (entries ?? []).filter((e) => !e.ended_at), [entries])
  const findings = useMemo(() => (check.data && entries ? findingsOf(check.data, entries) : []), [check.data, entries])
  const tonight = demo ? null : tonightOf(findings, current, usedLastNight)
  const apart = demo ? null : (findings.find((f) => f.kind === 'Conflict' && f.entries.length >= 2) ?? null)
  const gap = demo ? null : (findings.find((f) => f.kind === 'Gap') ?? null)
  const hasCheck = Boolean(tonight || apart || gap)
  const alternate = async (on: RoutineEntry, off: RoutineEntry) => {
    try {
      await writes.alternate(on, off)
    } catch {
      toast.error(`Couldn't set ${entryName(on)} and ${entryName(off)} to alternate. Nothing changed; try again.`)
    }
  }
  const askAbout = (f: Finding) => ask(f.question, 'Routine check')
  const findFor = (f: Finding) => navigate('/routine', { state: { find: { ...f.find, mode: 'search', slot: f.find?.category === 'sunscreen' ? 'am' : undefined } } })
  const forearm = readForearm(data.series('forearm_treated')?.sessions ?? EMPTY, data.series('forearm_control')?.sessions ?? EMPTY, demo ? null : tests.running)
  const latestFace = latest(face, (s) => s.status === 'done')
  const diary = !demo && spots.data?.enough_data && latestFace ? spots.data : null
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
      onClick: () => (read.person === 'noBand' && read.baseline && topUpNeed(read.baseline) > 0 ? topUp(read.baseline) : checkIn('face_full')),
    },
    ...(closeUp.wanted
      ? [{ t: 'Cheek close-up', d: 'For your pores and texture goal', state: (data.series('cheek_macro')?.sessions.some(usable) ? 'done' : 'todo') as SetupRow['state'], onClick: () => checkIn('cheek_macro') }]
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

  // Row of smaller cards: as many as exist share the row, so no row has a hole.
  const small: { key: string; node: (cls: string) => ReactNode }[] = []
  if (showChanged && read.lead) {
    const s = read.lead
    small.push({
      key: 'changed',
      node: (cls) => (
        <ChangedCard
          className={cls}
          session={s}
          baseline={read.baseline}
          goals={goals}
          onOpen={(m) => navigate(`/result/${s.id}?metric=${m}`)}
          onFull={() => openResult(s)}
          onAsk={demo ? undefined : () => ask('What changed since my baseline, and why?', `Face check-in · ${shortDay(s.created_at)}`)}
        />
      ),
    })
  }
  if (showSetup) small.push({ key: 'setup', node: (cls) => <SetupCard className={cls} rows={setupRows} /> })
  if (hasCheck) {
    small.push({
      key: 'check',
      node: (cls) =>
        tonight ? (
          <TonightCard
            className={cls}
            tonight={tonight}
            usedLastNight={usedLastNight}
            onAlternate={alternate}
            onAsk={() => ask(`Why should I alternate my ${shortName(tonight.on).toLowerCase()} and ${shortName(tonight.off).toLowerCase()}?`, 'Routine check')}
            delay={0.28}
          />
        ) : apart ? (
          <ApartCard className={cls} finding={apart} onRoutine={() => navigate('/routine')} onAsk={() => askAbout(apart)} delay={0.28} />
        ) : gap ? (
          <GapCard className={cls} finding={gap} onFind={() => findFor(gap)} onAsk={() => askAbout(gap)} delay={0.28} />
        ) : null,
    })
  }
  if (forearm) small.push({ key: 'test', node: (cls) => <ProductTestTile className={cls} read={forearm} onOpen={() => navigate('/test')} /> })
  if (diary && latestFace) small.push({ key: 'spots', node: (cls) => <SpotDiaryTile className={cls} diary={diary} onOpen={() => navigate({ pathname: `/result/${latestFace.id}`, hash: '#spot-diary' })} /> })
  const spans = rowSpans(small.length)

  const am = activeIn(entries, 'am')
  const pm = activeIn(entries, 'pm')
  const conflict = check.data?.conflicts[0]
  const conflictNames = conflict ? conflict.products.map((id) => byId.get(id)).filter((e): e is RoutineEntry => Boolean(e)) : []
  const short = conflict ? /^([^:.]{3,24}):/.exec(conflict.suggestion)?.[1] : undefined
  const missingSunscreen = Boolean(check.data?.gaps.some((g) => /sunscreen/i.test(g.need)))

  let routineCard: ReactNode
  const routineCls = 'col-span-12 @min-[960px]:col-span-6'
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

  const recent = recentRows({ all: data.all, entries: demo ? undefined : entries, joined: demo ? null : (user?.metadata?.creationTime ?? null), goals, navigate })
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
        {routineCard}
        <RecentCard className={routineCls} rows={recent} onAll={() => navigate('/progress')} />
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

type Nav = ReturnType<typeof useNavigate>

function leadFor({
  read,
  goals,
  demo,
  checkIn,
  openResult,
  topUp,
  placeChips,
}: {
  read: HomeRead
  goals: string[]
  demo: boolean
  checkIn: (site?: Session['site'], mode?: CaptureMode) => void
  openResult: (s: Session) => void
  topUp: (s: Session) => void
  placeChips: string[]
}): Lead {
  const baseMode = read.baseline?.capture_mode
  if (demo) {
    const s = read.lead
    if (!s) return { title: 'Demo journey', sub: 'This journey has no measured face check-in to show.', aura: 'violet', note: 'Check-ins are available in your own account' }
    return { ...doneLead(s, goals, `LATEST CHECK-IN · ${shortDay(s.created_at).toUpperCase()}`), cta: { label: 'See result', onClick: () => openResult(s) }, note: 'Check-ins are available in your own account' }
  }
  const t = read.todaySession
  if (t) {
    const site = SITE_SHORT[t.site].toUpperCase()
    const again = { label: 'Check in again', onClick: () => checkIn(t.site, t.capture_mode) }
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
      return { eyebrow: 'START HERE', title: 'Take your baseline', sub: `Five face photos by a window, about three minutes. ${countWord(BAND_FRAMES)} need to pass the quality check. Later check-ins are compared with them.`, big: `0/${BAND_FRAMES}`, bigLabel: 'usable photos needed, from 5 taken', prog: 0, chips: ['Face', 'Phone or RAW'], cta: { label: 'Start baseline', onClick: () => checkIn('face_full') }, aura: 'coral' }
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
          chips: ['Face', ...(baseMode ? [MODE_LABEL[baseMode]] : []), `${plural(need, 'photo')} left`],
          cta: { label: `Add ${plural(need, 'photo')}`, onClick: () => topUp(b) },
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
        chips: ['Face', ...(baseMode ? [MODE_LABEL[baseMode]] : [])],
        cta: { label: 'Check in', onClick: () => checkIn('face_full', baseMode) },
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
        chips: [...placeChips, ...(baseMode ? [MODE_LABEL[baseMode]] : [])],
        cta: { label: 'Check in now', onClick: () => checkIn('face_full', baseMode) },
        aura: 'sky',
      }
    default:
      return {
        eyebrow: read.lastFace ? `LAST CHECK-IN ${shortDay(read.lastFace.created_at).toUpperCase()}` : undefined,
        title: 'Face check-in',
        sub: 'Same window light as last time keeps results comparable.',
        big: read.baseline ? String(daysSince(read.baseline.created_at)) : undefined,
        bigLabel: 'days since your baseline',
        chips: [...placeChips, ...(baseMode ? [MODE_LABEL[baseMode]] : [])],
        cta: { label: 'Check in', onClick: () => checkIn('face_full', baseMode) },
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
  const chips = [count(changed.length, 'changed'), count(normal.length, 'normal'), count(notEnough, 'notEnough')].filter(Boolean)
  const first = changed[0]
  const title = changed.length === 0 ? (normal.length ? 'Within your normal range' : 'Not enough data to compare yet') : changed.length === 1 ? `${METRIC_META[first.id].label} changed` : `${changed.length} measures changed`
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
    out.push({ g: '◆', t: `${METRIC_META[changed[0].id].label} changed beyond your normal range${run >= 2 ? `, ${countWord(run).toLowerCase()} check-ins in a row` : ''}.` })
    if (changed.length > 1) out.push({ g: '◆', t: `${cap(listOf(changed.slice(1)))} changed too.` })
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

function recentRows({ all, entries, joined, goals, navigate }: { all: Session[]; entries: RoutineEntry[] | undefined; joined: string | null; goals: string[]; navigate: Nav }): RecentRow[] {
  const rows: RecentRow[] = []
  for (const s of all) {
    const at = Date.parse(s.created_at)
    const open = () => navigate(`/result/${s.id}`)
    const baseline = s.is_baseline && usable(s)
    rows.push({ key: `s:${s.id}`, at, d: shortDay(s.created_at), t: `${s.sample_id ? 'Sample run' : baseline ? 'Baseline set' : 'Check-in'} · ${SITE_SHORT[s.site]}`, x: summaryOf(s), onClick: open })
    if (s.note) rows.push({ key: `n:${s.id}`, at: at + 1, d: shortDay(s.created_at), t: 'Note', x: `“${s.note}”`, onClick: open })
  }
  for (const e of entries ?? []) {
    rows.push({ key: `r:${e.id}`, at: parseDate(e.started_at).getTime(), tie: Date.parse(e.created_at ?? '') || 0, d: shortDay(e.started_at), t: 'Started a product', x: e.custom_name, onClick: () => navigate('/routine') })
    if (e.ended_at) rows.push({ key: `e:${e.id}`, at: parseDate(e.ended_at).getTime(), d: shortDay(e.ended_at), t: 'Stopped a product', x: e.custom_name, onClick: () => navigate('/routine') })
  }
  if (joined) {
    const iso = new Date(joined).toISOString()
    const names = goals.map((g) => GOALS.find((x) => x.id === g)?.label.toLowerCase()).filter(Boolean)
    rows.push({ key: 'joined', at: Date.parse(iso), d: shortDay(iso), t: 'Joined Willow', x: names.length ? `Goals: ${names.join(', ')}` : 'No goals chosen yet', onClick: () => navigate('/you') })
  }
  return rows.sort((a, b) => b.at - a.at || (b.tie ?? 0) - (a.tie ?? 0)).slice(0, 6)
}

function summaryOf(s: Session): string {
  if (inFlight(s)) return stalled(s) ? "— Didn't finish" : '◐ Measuring'
  if (s.status === 'failed') return "— Didn't finish"
  if (s.measured === false) return 'Saved, not measured'
  if (!s.result?.quality.passed) return '— Photos not usable'
  if (s.is_baseline) {
    const f = s.baseline_ref?.frames ?? s.result.frames_used
    return `${plural(f, 'usable photo', 'usable photos')} · ${(s.baseline_ref?.has_noise_band ?? f >= BAND_FRAMES) ? 'normal range ready' : 'no normal range yet'}`
  }
  const { changed, normal } = splitVerdicts(s, [])
  if (changed.length) return `◆ ${cap(listOf(changed, 2))} changed`
  if (normal.length) return '○ Within normal range'
  return '◌ Not enough data yet'
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
