import { ArrowLeft, ChevronDown, Link2 } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { CoachMarks } from '../components/CoachMarks'
import { ControlCompare } from '../components/ControlCompare'
import { DemoBar } from '../components/DemoBar'
import { MetricDetail } from '../components/MetricDetail'
import { MetricRow } from '../components/MetricRow'
import { NumberValue } from '../components/NumberValue'
import { Scrubber } from '../components/Scrubber'
import { Sheet } from '../components/Sheet'
import { Stage } from '../components/Stage'
import { isSampleEngine } from '../data/live'
import type { Metric, MetricGroup, MetricId, Session, Site } from '../data/types'
import { useData } from '../data/useData'
import { fmtDate, plural } from '../lib/format'
import { GROUP_META, QUALITY_COPY, SITE_LABEL, VERDICT_RANK, orderedGroups } from '../lib/metrics'
import { useViewState } from '../lib/url'

const SNAPS = ['peek', 'half', 'full'] as const
type Snap = (typeof SNAPS)[number]

export function Report() {
  const { site: siteParam } = useParams()
  const site = (siteParam ?? 'face_full') as Site
  const data = useData()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const series = data.series(site)
  const sessions = useMemo(() => series?.sessions.filter((s) => s.status === 'done') ?? [], [series])
  const view = useViewState()
  const index = Math.min(sessions.length - 1, Math.max(0, view.t ?? sessions.length - 1))
  const session: Session | null = sessions[index] ?? null
  const baseline = useMemo(() => sessions.find((s) => s.is_baseline) ?? null, [sessions])
  const metricId = (view.m as MetricId | null) ?? null
  const [expanded, setExpanded] = useState<MetricId | null>(null)
  const [snap, setSnap] = useState<Snap>('half')
  const [siteSheet, setSiteSheet] = useState(false)
  const [keys, setKeys] = useState(false)

  const metrics = session?.result?.metrics ?? []
  const baselineMetric = useCallback((id: MetricId) => baseline?.result?.metrics.find((m) => m.id === id) ?? null, [baseline])
  const reach = useMemo(() => {
    const r: Partial<Record<MetricId, number>> = {}
    for (const s of sessions) for (const m of s.result?.metrics ?? []) r[m.id] = Math.max(r[m.id] ?? 0, Math.abs(m.delta ?? 0))
    return r
  }, [sessions])
  const realCount = metrics.filter((m) => m.verdict === 'real_change').length
  const groups = orderedGroups(data.goals)
  const grouped = groups
    .map((g) => ({ group: g, items: metrics.filter((m) => m.group === g).sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]) }))
    .filter((g) => g.items.length > 0)

  const outsideCount = useCallback((s: Session) => (s.result?.metrics ?? []).filter((m) => m.verdict === 'real_change').length, [])
  const onScrub = useCallback((i: number) => view.set({ t: i }), [view])

  // Keyboard: arrows scrub, L toggles the layer, ? not yet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') view.set({ t: Math.max(0, index - 1) })
      else if (e.key === 'ArrowRight') view.set({ t: Math.min(sessions.length - 1, index + 1) })
      else if (e.key.toLowerCase() === 'l') view.set({ layer: !view.layer })
      else if (e.key === '?') setKeys(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, sessions.length, view])

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
        {data.mode === 'demo' ? <DemoBar /> : null}
        <div className="mx-auto max-w-[36rem] px-5 py-12">
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">No sessions yet for {SITE_LABEL[site]}</h1>
          <p className="mt-3 text-[15px] text-text-2">Take a baseline of five photos to start. Every later session is compared to it.</p>
          <Link to={`/capture?site=${site}`} className="mt-6 inline-flex min-h-11 items-center rounded-(--radius-control) bg-text px-4 text-[15px] font-medium text-surface">
            Start a baseline
          </Link>
        </div>
      </div>
    )
  }

  const titleDate = session ? (session.hours_since_baseline !== undefined && session.hours_since_baseline > 0 ? `+${session.hours_since_baseline} h` : fmtDate(session.created_at)) : ''

  const sheetBody = (
    <>
      <header className="px-5 pb-3 pt-1 sm:px-6">
        {session?.is_baseline ? (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">Your baseline</h1>
            <p className="mt-1 text-[13px] text-text-2">
              {fmtDate(session.created_at)} · {plural(session.n_frames, 'photo', 'photos')} · every later session is compared to this
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">
              <NumberValue value={realCount} decimals={0} size="lg" className="text-[28px] align-baseline" /> real {realCount === 1 ? 'change' : 'changes'} since your baseline
            </h1>
            <p className="mt-1 text-[13px] text-text-2">
              Baseline {baseline ? fmtDate(baseline.created_at) : '–'} · {baseline ? plural(baseline.n_frames, 'photo', 'photos') : ''} · {session ? plural(session.n_frames, 'photo', 'photos') : ''} this session
              {session?.deviation ? <Chip tone="warn" className="ml-2">something was different</Chip> : null}
            </p>
          </>
        )}
      </header>
      {isSampleEngine(session) ? (
        <div className="mx-5 mb-3 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] sm:mx-6">
          <span className="font-semibold">Sample numbers.</span> Your photos are saved. Until the measurement engine is connected, these readings come from a fixed sample, not from your skin.
        </div>
      ) : null}
      {session?.result && !session.result.quality.passed ? (
        <div className="mx-5 mb-3 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] sm:mx-6">
          <span className="font-semibold text-warn-text">Photo quality differed from your reference.</span>{' '}
          {session.result.quality.reasons.map((r) => QUALITY_COPY[r]?.text).join(' ')}
        </div>
      ) : null}
      {site === 'forearm_treated' && session && !session.is_baseline ? (
        <div className="mx-5 mb-3 sm:mx-6">
          <ControlCompare
            treated={session}
            control={data.series('forearm_control')?.sessions[index] ?? null}
            treatedBaseline={baseline}
            controlBaseline={data.series('forearm_control')?.sessions.find((s) => s.is_baseline) ?? null}
            metricId={(metricId === 'redness' ? 'redness' : 'tone_ita') as 'tone_ita' | 'redness'}
          />
        </div>
      ) : null}
      {grouped.map(({ group, items }) => (
        <section key={group} aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`} className="border-b border-border px-5 pb-1 pt-4 text-[15px] font-semibold text-text-2 sm:px-6">
            {GROUP_META[group as MetricGroup].label}
          </h2>
          <ul>
            {items.map((m: Metric) => {
              const bm = baselineMetric(m.id)
              return (
                <MetricRow
                  key={`${session?.id}-${m.id}`}
                  metric={m}
                  baselineValue={session?.is_baseline ? null : (bm?.value ?? null)}
                  baselineMdc={session?.is_baseline ? null : (bm?.mdc95 ?? null)}
                  reach={reach[m.id] ?? 0}
                  selected={metricId === m.id}
                  expanded={expanded === m.id}
                  stamp
                  onSelect={() => view.set({ m: metricId === m.id ? null : m.id, layer: metricId !== m.id })}
                  onToggle={() => {
                    setExpanded(expanded === m.id ? null : m.id)
                    if (snap === 'peek') setSnap('full')
                  }}
                >
                  <MetricDetail metricId={m.id} sessions={sessions} current={m} baseline={baseline} />
                </MetricRow>
              )
            })}
          </ul>
        </section>
      ))}
      {session?.explanation ? (
        <section className="mx-5 my-5 rounded-(--radius-tile) bg-surface p-4 sm:mx-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">Why this matters</h2>
            {data.mode === 'demo' ? <Chip tone="neutral">sample explanation</Chip> : session.explanation_source === 'gemini' ? <Chip tone="neutral">AI-written, numbers verified</Chip> : <Chip tone="neutral">written from your numbers</Chip>}
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
          <p className="mt-3 text-[12px] text-text-3">{session.explanation.disclaimer}</p>
        </section>
      ) : null}
      <p className="px-5 pb-6 text-[12px] text-text-3 sm:px-6">Cosmetic appearance tracking, not a diagnosis. Photos delete 30 days after capture; measurements stay in your account until you delete them.</p>
    </>
  )

  const topBar = (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-6">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-control) hover:bg-surface-2" aria-label="Back">
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
      caption={session && !session.is_baseline && session.hours_since_baseline !== undefined ? `+${session.hours_since_baseline} h` : undefined}
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
      {data.mode === 'demo' ? <DemoBar /> : null}
      {topBar}
      {/* Desktop: stage + scrubber left, panel right */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[58%_42%]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1">{stage}</div>
          {scrubber}
        </div>
        <div className="min-h-0 overflow-y-auto border-l border-border">{sheetBody}</div>
      </div>
      {/* Phone: stage, draggable sheet, scrubber */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="min-h-0 flex-1">{stage}</div>
        <SnapSheet snap={snap} onSnap={setSnap} reduce={Boolean(reduce)}>
          {sheetBody}
        </SnapSheet>
        {scrubber}
      </div>
      <CoachMarks id="lens" />
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
                <span className="font-mono text-[12px] text-text-3">{plural(data.series(s)?.sessions.length ?? 0, 'session', 'sessions')}</span>
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
      className="relative z-10 flex shrink-0 flex-col rounded-t-(--radius-sheet) bg-bg shadow-[0_-8px_24px_oklch(0.24_0.018_130/0.1)]"
    >
      <motion.button
        type="button"
        aria-label={`Results panel, ${snap}. Drag or press to resize.`}
        onPanEnd={(_, info) => {
          const projected = info.offset.y + (info.velocity.y / 1000) * 120
          const i = SNAPS.indexOf(snap)
          if (projected < -40) onSnap(SNAPS[Math.min(2, i + 1)])
          else if (projected > 40) onSnap(SNAPS[Math.max(0, i - 1)])
          animate(y, 0, { type: 'spring', visualDuration: 0.3, bounce: 0 })
        }}
        onClick={() => onSnap(snap === 'full' ? 'half' : snap === 'half' ? 'peek' : 'half')}
        className="flex h-8 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-noise-500/60" aria-hidden />
      </motion.button>
      <div className={`min-h-0 flex-1 ${snap === 'peek' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{children}</div>
    </motion.section>
  )
}
