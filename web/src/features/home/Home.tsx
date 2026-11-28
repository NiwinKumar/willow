import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { activeIn, useRoutine, useRoutineCheck, useRoutineLog, useSetRoutineUse, useSpotCheckIns } from '../../data/hooks'
import { useCheckin, useCheckinDue } from '../../data/useCheckin'
import type { RoutineEntry, Session, Site } from '../../data/types'
import { demoUnavailable } from '../../data/demoSource'
import { leaveDemo, useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { parseDate, plural } from '../../lib/format'
import { identity } from '../../lib/identity'
import { placesOf } from '../../lib/profile'
import { minutesFor, withArms } from '../../lib/track'
import { routineEffect } from '../../lib/routineEffect'
import { addToCalendar } from '../../lib/reminders'
import { fmtDay, gapDaysFor, scheduleText, weeklyDayOf, type Checkin, type Due } from '../../lib/schedule'
import { fmtSigned, METRIC_META, qualityCopy, unitOf } from '../../lib/metrics'
import { useAuth } from '../../lib/useAuth'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { CHANGE_WORDS, VERDICT_WORDS, changeLines, changeTitle, changeWay, type VerdictKind } from '../../lib/verdict'
import { ChangedCard, GoalsCard, RoutineEffectCard, SetupCard, WeekBand, type SetupRow } from './cards'
import { article, distinctNames, BAND_FRAMES, cap, clock, countWord, dayOf, daysSince, latest, listOf, lowerFirst, readHome, runOf, SITE_SHORT, shortDay, shortName, splitVerdicts, today, usable, verdictSentence, type HomeRead, type Place } from './derive'
import { useProductTests } from '../routine/productTests'
import { useOutcomeSessions } from '../routine/routineModel'
import { useSessionView } from '../progress/useSessionView'
import { restsOn } from '../routine/schedule'
import { readForearm } from './forearm'
import { HeroCard, type HeroLine } from './HeroCard'
import { goalTrends } from './goals'
import { HomeFit } from './fit'
import { LeadCard, type Lead } from './LeadCard'
import { topUpNeed } from '../checkin/topup'
import { RoutineEmpty, RoutineToday } from './RoutineToday'
import { SpotDiaryTile } from './SpotDiaryTile'
import { BaselineTile, PhotosTile, ProductTestTile } from './Tiles'

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
              ? { title: 'The demo journey has no check-ins yet', body: "It follows Mei, a simulated person, measured by the live engine, and none of her check-ins have been measured yet. Your own check-ins are in your account." }
              : { title: "The demo journey can't be read right now", body: "It is Mei's measured check-ins (a simulated person), read from the live api. Try again in a moment, or leave the demo." })}
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

/** Gap under the last row when Home fills the screen: the shell's 16px over the page plus the frame's 8px top. */
const FIT_GAP = 24

/**
 * The page. Fitted (`fit`): exactly one screen high, from where it starts (under the shell's padding or the demo
 * banner) to the window's bottom, with the same gap above the first card and below the last row.
 */
function Frame({ children, busy, fit = false }: { children: ReactNode; busy?: boolean; fit?: boolean }) {
  const own = useRef<HTMLElement | null>(null)
  const [top, setTop] = useState(16)
  // Where the page starts: re-read after every render, on resize and once things above it settle (the demo
  // banner, fonts); a state change only when it moved.
  useLayoutEffect(() => {
    if (!fit) return
    const measure = () => {
      const el = own.current
      if (el) setTop(Math.round(el.getBoundingClientRect().top + window.scrollY))
    }
    measure()
    const late = window.setTimeout(measure, 600)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  })
  return (
    <main
      ref={own}
      aria-busy={busy || undefined}
      className={`relative mx-auto flex max-w-[1320px] flex-col gap-3.5 ${fit ? 'overflow-hidden' : ''}`}
      style={fit ? { padding: `8px clamp(16px,2vw,32px) ${FIT_GAP}px`, height: `calc(100dvh - ${top}px)` } : { padding: 'clamp(10px,1.6vw,22px) clamp(16px,3vw,32px) 24px' }}
    >
      {children}
    </main>
  )
}

/**
 * Home fills the screen when the window is a desktop one at least 640px tall (760px with goals) and the cards sit in one row
 * (the grid at least 960px wide: narrower, with Wisp open beside a laptop-sized page, the cards stack in
 * pairs and the page scrolls as before). Tells the shell to drop its bottom padding while it does.
 */
function useFitScreen(dense: boolean) {
  // A person with goals has six cards under the hero: they need a taller window (760px) to fit without
  // squeezing every list to one row; fewer cards fit from 640px.
  const tall = useMediaQuery(`(min-width: 900px) and (min-height: ${dense ? 760 : 640}px)`)
  const [width, setWidth] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    if (!el) return
    // flushSync: when Wisp or the sidebar moves the page (a view transition, components/shell/morph.ts), the
    // switch between fitted and scrolling lands before the transition captures the new layout, so it is
    // cross-faded with everything else instead of jumping after it.
    ro.current = new ResizeObserver(([e]) => flushSync(() => setWidth(Math.round((e.target as HTMLElement).getBoundingClientRect().width))))
    // the page (main) around the grid: its full width, padding included
    if (el.parentElement) ro.current.observe(el.parentElement)
  }, [])
  // The grid's width once fitted (its side padding is clamp(16px, 2vw, 32px) then, 3vw scrolling): measured on
  // the page itself, so being fitted or not never changes the answer.
  const fitPad = Math.min(32, Math.max(16, (typeof window === 'undefined' ? 1440 : window.innerWidth) * 0.02))
  const fit = tall && width - 2 * fitPad >= 960
  useLayoutEffect(() => {
    if (!fit) return
    const html = document.documentElement
    html.dataset.homeFit = ''
    return () => {
      delete html.dataset.homeFit
    }
  }, [fit])
  return { fit, gridRef }
}

function HomeBody() {
  const data = useData()
  const { user, getIdToken } = useAuth()
  const me = identity(user)
  const shell = useShell()
  const navigate = useNavigate()
  const demo = data.mode === 'demo'
  // A check-in left while measuring (closed, or a several-place walk) says so here when its result lands.
  // Goals live on this device (You writes them); read fresh so a change there reorders Home at once.
  const goals = data.goals
  // Judge sample runs (hosted sample photos, sample_id) are not the person's own check-ins: Home's
  // greeting, lead card and week never read them; Recent lists them as sample runs.
  const own = useMemo(() => data.all.filter((s) => !s.sample_id), [data.all])
  // Every place the person tracks (the face first: it measures the most), so a baseline on any of them
  // counts: a person who tracks only the cheek close-up is not asked for a baseline again.
  const places = useMemo<Place[]>(
    () =>
      (['face_full', ...placesOf(data.profile).filter((p) => p !== 'face_full')] as Site[]).map((site) => {
        const all = data.series(site)?.sessions ?? EMPTY
        return { site, sessions: all.some((s) => s.sample_id) ? all.filter((s) => !s.sample_id) : all }
      }),
    [data],
  )
  // The check-in schedule (You): when check-ins are due, the weekly day, and how long a gap is.
  const checkin = useCheckin()
  const due = useCheckinDue()
  const read = useMemo(() => readHome(own, places, gapDaysFor(checkin)), [own, places, checkin])
  // The place Home reads (the face, or the first tracked place with a baseline) and its sessions.
  const series = read.series
  const placeName = SITE_SHORT[read.site]

  // A check-in still uploading or measuring is read again by the DataProvider (one session at a time, backing
  // off) until its result lands; Home redraws from the cache.

  const routine = useRoutine()
  const entries = routine.data
  const log = useRoutineLog()
  const setUse = useSetRoutineUse()
  const check = useRoutineCheck(entries)
  const tests = useProductTests()
  const spotCheckIns = useSpotCheckIns()
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

  // A pores-and-texture goal is measured up close: a setup row for the cheek close-up unless Home already reads it.
  const closeUpWanted = goals.includes('pores_texture') && read.site !== 'cheek_macro'
  const tracked = withArms(placesOf(data.profile), !demo && Boolean(tests.running))
  // The hero already says when a check-in is due; the lead card's chips name the places only.
  const placeChips = demo ? ['Face'] : tracked.map((p) => SITE_SHORT[p])
  const names = tracked.map((p) => SITE_SHORT[p].toLowerCase())
  const todayLine = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}, about ${minutesFor(tracked)} min`
  const lead = leadFor({ read, goals, demo, checkIn, openResult, placeChips, todayLine })
  const heroLinesAll = withTonight(heroLinesFor(read, goals, demo, due), tonightLine(activeIn(entries, 'pm')))
  // The schedule chip, unless a hero line already says when the next check-in is.
  const heroNext = demo || read.todayKind === 'done' ? null : read.person === 'new' ? 'No check-ins yet' : (due?.label ?? null)
  const saveCalendar = (c: Checkin) => addToCalendar(getIdToken, c).catch(() => toast.error("Couldn't make the calendar file. Try again."))
  // Routine effect: how each product's target measurement moved since it started (lib/effect.ts).
  const outcomeSessions = useOutcomeSessions()
  // The demo journey is a finished recording: it is read as of its last measured check-in, not as of today
  // (a product "in use for 13 weeks" in a journey whose last check-in was in its eighth week).
  const asOfSession = demo ? outcomeSessions.filter(usable).reduce<Session | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null) : null
  const asOf = asOfSession ? new Date(asOfSession.created_at).getTime() : undefined
  const effect = useMemo(() => routineEffect(entries ?? [], outcomeSessions, check.data, asOf), [entries, outcomeSessions, check.data, asOf])
  const forearm = readForearm(data.series('forearm_treated')?.sessions ?? EMPTY, data.series('forearm_control')?.sessions ?? EMPTY, demo ? null : tests.running)
  const latestRead = latest(series, (s) => s.status === 'done')
  const showChanged = Boolean(read.lead && !read.lead.is_baseline)
  // The hero's question follows what the lines above it are about: a check-in from today, an earlier
  // one (the lines still describe it), or no baseline yet.
  const heroAsk =
    read.person === 'new' || read.person === 'noBand'
      ? { label: 'How to start', run: () => ask('How do I take a good baseline?', 'Today') }
      : latestRead && dayOf(latestRead.created_at) === day
        ? { label: 'Ask about today', run: () => ask('Explain today’s read: what changed and what should I do today?', 'Today') }
        : {
            label: 'Ask about these',
            run: () => ask('Explain my last check-in: what changed, and what should I do until the next one?', latestRead ? `${placeName} check-in · ${shortDay(latestRead.created_at)}` : 'Today'),
          }
  const showSetup = !demo && (read.person === 'new' || read.person === 'noBand')

  const setupRows: SetupRow[] = [
    {
      t: read.person === 'new' ? 'Your baseline' : `${placeName} baseline`,
      d: read.person === 'new' ? `About ${minutesFor(tracked)} min, by a window` : `${plural(read.baselineFrames ?? 0, 'usable photo', 'usable photos')} of ${BAND_FRAMES} · no normal range yet`,
      state: read.person === 'new' ? 'todo' : 'part',
      part: Math.min(1, (read.baselineFrames ?? 0) / BAND_FRAMES),
      onClick: checkIn,
    },
    ...(closeUpWanted
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
  const trends = useMemo(() => (read.lead && !read.lead.is_baseline ? goalTrends(read.lead, read.baseline, series, goals) : []), [read.lead, read.baseline, series, goals])
  const measured = showChanged ? read.lead : null
  const goalsNode = (cls: string) =>
    measured && trends.length ? (
      <GoalsCard
        className={cls}
        trends={trends}
        baseline={read.baseline}
        onOpen={(m) => navigate(`/result/${measured.id}?metric=${m}`)}
        onProgress={() => navigate('/progress')}
        onAsk={() => ask('How are my goals going since my baseline, and what should I do next?', 'Goals')}
      />
    ) : null
  const changedNode = (cls: string) =>
    measured ? (
      <ChangedCard
        className={cls}
        session={measured}
        baseline={read.baseline}
        goals={goals}
        rows={4}
        onOpen={(m) => navigate(`/result/${measured.id}?metric=${m}`)}
        onFull={() => openResult(measured)}
        onAsk={() => ask('What changed since my baseline, and why?', `${placeName} check-in · ${shortDay(measured.created_at)}`)}
      />
    ) : null

  // The row under the hero, in three columns, one card in each taking up the slack so the columns end level:
  // what you're aiming for (goals or setup, over the routine's effect); the last check-in (how its photos came
  // out, what changed since the baseline); the daily one (Routine today, with the product test and baseline under it).
  type Slot = { key: string; node: ReactNode; grow?: boolean }
  // How the last check-in's photos came out. On the demo journey, the last one whose photos were used: a
  // retake that found no face is not what the showcase account is there to show.
  const lastPhotos = latest(own, (s) => s.status === 'done' && Boolean(s.result) && (!demo || usable(s)))
  // Every photo of it is signed by the single view only (the list signs the reference photo); the demo journey is read from its own endpoint, which has none.
  const lastPhotosView = useSessionView(demo ? null : (lastPhotos?.id ?? null))
  // With goals on the left, the routine's effect moves under Routine today (the routine and whether it works,
  // together) and the baseline tile under the goals: two tall cards never share one column while another holds
  // Routine today alone, which then stretched its panels into empty space (the demo journey). Without goals (a
  // first check-in) the effect keeps the left column.
  const { fit, gridRef } = useFitScreen(Boolean(measured && trends.length))
  // A tall window has room for Routine today's full panels even when it shares its column: 940px beside the
  // baseline tile, 1100px beside the routine's effect (a person with goals).
  const roomy = useMediaQuery(`(min-height: ${measured && trends.length ? 1100 : 940}px)`)
  // Fitted to the screen, the greeting keeps its first two lines (the lead card beside it carries the rest).
  const heroLines = fit ? heroLinesAll.slice(0, 2) : heroLinesAll
  const goalsShown = Boolean(measured && trends.length)
  const effectNode = effect?.rows.length ? <RoutineEffectCard className="flex-1" effect={effect} sessions={outcomeSessions} asOfTime={asOf} asOf={asOfSession ? shortDay(asOfSession.created_at) : null} onOpen={() => navigate('/routine')} onAsk={(q) => ask(q, 'Routine effect')} /> : null
  const baselineNode = read.baseline ? <BaselineTile className="flex-1" baseline={read.baseline} asOf={asOfSession?.created_at ?? null} onOpen={() => navigate('/progress')} /> : null
  // Fitted to the screen with goals (an active person, the demo journey), six cards no longer fit three columns
  // one screen high as they stack when scrolling. Fitted: the goals have the first column (the spot diary under
  // them), the photos sit over what changed, and the routine's effect sits under Routine today (the routine and
  // whether it moves anything, together); the baseline tile gives way (the goals card already says "Since your
  // baseline, 23 Aug").
  const fitGoals = fit && goalsShown
  const aims: Slot[] = []
  if (goalsShown) aims.push({ key: 'goals', node: goalsNode('flex-1'), grow: true })
  if (showSetup) aims.push({ key: 'setup', node: <SetupCard className="flex-1" rows={setupRows} /> })
  if (effectNode && !goalsShown) aims.push({ key: 'effect', node: effectNode })
  if (baselineNode && goalsShown && !fitGoals) aims.push({ key: 'baseline', node: baselineNode })
  const last: Slot[] = []
  if (lastPhotos) last.push({ key: 'photos', node: <PhotosTile className="flex-1" session={lastPhotos} frameUrls={lastPhotosView?.session.frame_urls ?? null} next={due?.label ?? null} demo={demo} shared={fit && Boolean(measured)} onOpen={() => openResult(lastPhotos)} /> })
  if (measured) last.push({ key: 'changed', node: changedNode('flex-1'), grow: true })
  // The spot diary (every face check-in, with every counted mark): fitted with goals it sits under them.
  const weeks = !demo ? (spotCheckIns.data?.check_ins ?? []) : []
  if (weeks.length) (fitGoals ? aims : last).push({ key: 'spots', node: <SpotDiaryTile className="flex-1" weeks={weeks} onOpen={() => navigate('/spots')} /> })
  const daily: Slot[] = [{ key: 'routine', node: null, grow: !(effectNode && goalsShown) }]
  if (effectNode && goalsShown) daily.push({ key: 'effect', node: effectNode, grow: true })
  if (forearm) daily.push({ key: 'test', node: <ProductTestTile className="flex-1" read={forearm} onOpen={() => navigate('/test')} /> })
  if (baselineNode && !goalsShown && !demo) daily.push({ key: 'baseline', node: baselineNode })

  const am = activeIn(entries, 'am')
  const pm = activeIn(entries, 'pm')
  const conflict = check.data?.conflicts[0]
  const conflictNames = conflict ? conflict.products.map((id) => byId.get(id)).filter((e): e is RoutineEntry => Boolean(e)) : []
  // two products with the same short name (two niacinamide serums) carry their brand in the tip too
  const routineNames = distinctNames((entries ?? []).filter((e) => !e.ended_at))
  const short = conflict ? /^([^:.]{3,24}):/.exec(conflict.suggestion)?.[1] : undefined
  const missingSunscreen = Boolean(check.data?.gaps.some((g) => /sunscreen/i.test(g.need)))

  let routineCard: ReactNode
  const routineCls = 'flex-1'
  if (routine.status === 'loading' || (routine.status === 'idle' && !entries)) routineCard = <CardSkeleton className={routineCls} label="Routine today" />
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
        compact={fit && daily.length > 1 && !roomy}
        am={am}
        pm={pm}
        used={used}
        onToggle={toggle}
        missingSunscreen={missingSunscreen}
        conflict={conflictNames.length ? { names: conflictNames.map((e) => routineNames.get(e.id) ?? shortName(e)), fix: short ?? null, title: conflict!.issue } : null}
        onRoutine={() => navigate('/routine')}
      />
    )
  }

  daily[0].node = routineCard
  const columns = [aims, last, daily].filter((c) => c.length)
  const spans = rowSpans(columns.length)

  const week = demo ? null : weekOf(own, read, goals, weeklyDayOf(checkin))

  return (
    <HomeFit.Provider value={fit}>
    <Frame fit={fit}>
      {data.status === 'error' ? (
        <div role="status" className="glass-pill flex flex-wrap items-center gap-3 self-center rounded-pill py-1.5 pr-1.5 pl-4 text-[13px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]">
          Couldn't refresh. Showing your last saved check-ins.
          <button type="button" onClick={() => void data.refresh()} className="min-h-9 rounded-pill bg-selected px-3.5 text-inverse">
            Retry
          </button>
        </div>
      ) : null}
      {week ? <WeekBand {...week} onProgress={() => navigate('/progress')} /> : null}
      <div ref={gridRef} className={`@container grid grid-cols-12 items-stretch gap-3.5 ${fit ? 'min-h-0 flex-[1_1_0] grid-rows-[max-content_minmax(0,1fr)]' : ''}`}>
        <div className="col-span-12 flex min-w-0 @min-[720px]:col-span-6 [&>section]:flex-1">
          <HeroCard
            name={me.guest ? null : me.first}
            next={heroNext}
            lines={heroLines}
            onAsk={heroAsk.run}
            askLabel={heroAsk.label}
          />
        </div>
        <div className="col-span-12 flex min-w-0 @min-[720px]:col-span-6 [&>section]:flex-1">
          <LeadCard lead={lead} />
        </div>
        {columns.map((col, i) => (
          <div key={col[0].key} className={`flex min-w-0 flex-col gap-3.5 ${fit ? 'min-h-0' : ''} ${spans[i]}`}>
            {col.map((c, k) => {
              const grow = col.some((x) => x.grow) ? c.grow : k === col.length - 1
              // Fitted: a growing card takes the column's rest (its lists show what fits), the others their own height.
              return (
                <div key={c.key} className={`flex min-w-0 ${fit ? (grow ? 'min-h-0' : 'min-h-0 flex-none') : grow ? 'flex-1' : ''}`} style={fit && grow ? { flex: '1 1 0' } : undefined}>
                  {c.node}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Frame>
    </HomeFit.Provider>
  )
}

/** Literal classes (Tailwind only generates what it can read). Quarter cards from a 960px column, pairs from 560px. */
const Q: Record<number, string> = { 3: '@min-[960px]:col-span-3', 4: '@min-[960px]:col-span-4', 6: '@min-[960px]:col-span-6', 12: '@min-[960px]:col-span-12' }
const T: Record<number, string> = { 6: '@min-[560px]:col-span-6', 12: '@min-[560px]:col-span-12' }

/** Spans for n columns in the row under the hero: up to four per row on desktop, pairs on tablet, never a hole. */
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
    if (!s) return { title: 'Demo journey', sub: 'This journey has no measured check-in to show.', aura: 'violet', note: 'Check-ins are available in your own account' }
    return { ...doneLead(s, goals, `Latest check-in · ${shortDay(s.created_at)}`), cta: { label: 'See result', onClick: () => openResult(s) }, note: 'Check-ins are available in your own account' }
  }
  const t = read.todaySession
  if (t) {
    const site = SITE_SHORT[t.site]
    const again = { label: 'Check in again', onClick: checkIn }
    switch (read.todayKind) {
      case 'measuring': {
        const up = t.status === 'uploading'
        return {
          eyebrow: `${site} · ${clock(t.created_at)}`,
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
      case 'done':
        return { ...doneLead(t, goals, `Checked in today · ${t.site === read.site ? '' : `${site} · `}${clock(t.created_at)}`), cta: { label: 'See result', onClick: () => openResult(t) } }
      default:
        break
    }
  }
  const f = read.baselineFrames ?? 0
  switch (read.person) {
    case 'new':
      return { title: 'Take your baseline', sub: `Your first check-in: ${todayLine}, by a window. ${countWord(BAND_FRAMES)} photos of each place need to pass the quality check. Later check-ins are compared with them.`, big: `0/${BAND_FRAMES}`, bigLabel: 'usable photos needed, from 5 taken', prog: 0, chips: placeChips, cta: { label: 'Start baseline', onClick: checkIn }, aura: 'coral' }
    case 'noBand': {
      // Photos kept (under 30 days): add the missing ones to this same baseline (design: "Add 2 photos").
      const need = topUpNeed(read.baseline)
      if (need > 0 && read.baseline) {
        const b = read.baseline
        return {
          eyebrow: `Started ${shortDay(b.created_at)}`,
          title: `Finish your ${SITE_SHORT[read.site].toLowerCase()} baseline`,
          sub: `${need === 1 ? 'One more photo gives' : `${countWord(need)} more photos give`} Willow your normal range. Until then results read “Not enough data yet”. Same light as ${shortDay(b.created_at)}.`,
          big: `${f}/${BAND_FRAMES}`,
          bigLabel: 'usable baseline photos',
          prog: Math.min(1, f / BAND_FRAMES),
          chips: [SITE_SHORT[read.site], `${plural(need, 'photo')} left`],
          cta: { label: 'Check in', onClick: checkIn },
          secondary: { label: 'See baseline', onClick: () => openResult(b) },
          aura: 'coral',
        }
      }
      return {
        eyebrow: read.baseline ? `Baseline · ${shortDay(read.baseline.created_at)}` : undefined,
        title: 'Your baseline has no normal range yet',
        sub: `A normal range needs ${BAND_FRAMES} usable photos; this one has ${f}. Take a check-in with ${BAND_FRAMES} or more, then make it your baseline from its result.`,
        big: `${f}/${BAND_FRAMES}`,
        bigLabel: 'usable baseline photos',
        prog: Math.min(1, f / BAND_FRAMES),
        chips: [SITE_SHORT[read.site]],
        cta: { label: 'Check in', onClick: checkIn },
        secondary: read.baseline ? { label: 'See baseline', onClick: () => openResult(read.baseline!) } : undefined,
        aura: 'coral',
      }
    }
    case 'gap':
      return {
        eyebrow: read.last ? `Last check-in · ${shortDay(read.last.created_at)}` : undefined,
        title: 'Welcome back',
        sub: 'Your baseline still holds. One check-in picks up where you left off.',
        big: read.last ? String(daysSince(read.last.created_at)) : undefined,
        bigLabel: 'days since your last check-in',
        chips: placeChips,
        cta: { label: 'Check in now', onClick: checkIn },
        aura: 'sky',
      }
    default:
      return {
        eyebrow: read.last ? `Last check-in · ${shortDay(read.last.created_at)}` : undefined,
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
    return { eyebrow: eyebrow.replace('Checked in', 'Baseline set'), title: 'Baseline set', sub: band ? 'Your normal range is ready. The next check-in shows what changed.' : `It has ${plural(f, 'usable photo', 'usable photos')}; a normal range needs ${BAND_FRAMES}.`, big: String(f), bigLabel: f === 1 ? 'usable photo' : 'usable photos', aura: 'violet' }
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

function linesFrom(s: Session, series: Session[], goals: string[]): HeroLine[] {
  if (s.is_baseline) {
    const f = s.baseline_ref?.frames ?? s.result?.frames_used ?? 0
    if (!(s.baseline_ref?.has_noise_band ?? f >= BAND_FRAMES)) return [{ g: '◐', t: `Your baseline has ${plural(f, 'usable photo', 'usable photos')}; a normal range needs ${BAND_FRAMES}.` }]
    return [{ g: '·', t: 'Your baseline is set. The next check-in shows what changed.' }]
  }
  const { changed, normal } = splitVerdicts(s, goals)
  const out: HeroLine[] = []
  if (changed.length) {
    const run = runOf(changed[0].id, series, s)
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
  const fromLead = read.lead ? linesFrom(read.lead, read.series, goals) : []
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
      // The lead card shows what today's check-in found; the hero says it is done and what comes next (no repeat).
      return [
        { g: '✓', t: 'Today’s check-in is done.' },
        { g: '→', t: due && due.kind === 'done' ? `Next one ${fmtDay(due.next)}, by the same window light.` : 'Next time, the same window light keeps results comparable.' },
      ]
    default:
      break
  }
  const f = read.baselineFrames ?? 0
  if (read.person === 'new')
    return [
      { g: '1', t: 'Today is for your baseline: photos by a window.' },
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
  // Back after a gap: the lead card says "Welcome back"; the hero recalls what the last check-in showed.
  if (read.person === 'gap') return [...(fromLead.length ? fromLead.slice(0, 2) : [{ g: '○', t: 'Your baseline still holds.' }]), { g: '→', t: 'One check-in today picks the trend back up.' }]
  // On a day the schedule doesn't ask for a check-in, say when the next one is.
  const nextLine = due && due.kind === 'upcoming' ? `Next check-in ${fmtDay(due.next)}, by the same window light.` : 'Check in today, by the same window light.'
  return [...fromLead.slice(0, 2), { g: '→', t: nextLine }]
}

/** "☾ Tonight is a glycolic night." when an every-other-night product is on tonight and another rests (from the schedules; no numbers). */
function tonightLine(pm: RoutineEntry[]): HeroLine | null {
  const on = pm.find((e) => e.schedule?.kind === 'alternate' && !restsOn(e))
  if (!on || !pm.some((e) => restsOn(e))) return null
  const name = shortName(on).toLowerCase()
  return /\d/.test(name) ? null : { g: '☾', t: `Tonight is ${article(name)} ${name} night.` }
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
 * the baseline) once they checked in this week.
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
  const placeCount = done.filter((s) => s.site === read.site).length
  const lead = latest(done, (s) => s.site === read.site && usable(s) && !s.is_baseline)
  const sentence = lead ? verdictSentence(lead, goals) : null
  const where = read.site === 'face_full' ? 'your face' : SITE_SHORT[read.site].toLowerCase()
  return {
    range,
    // Every place counts here; Progress (where "See progress" goes) shows one place, so say how many were Home's place.
    summary: `${countWord(done.length)} check-in${done.length === 1 ? '' : 's'}${placeCount && placeCount < done.length ? `, ${placeCount} of ${where}` : ''}.${sentence ? ` ${sentence}` : ''}`,
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
