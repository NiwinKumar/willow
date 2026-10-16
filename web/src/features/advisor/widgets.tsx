/**
 * In-chat widgets ("artifacts"). The advisor only names a widget and its parameters (api advisor_blocks.py);
 * every number here comes from the app's own data (sessions, routine, spot diary, catalog), exactly as the
 * full screens show it. Each widget links to its full screen.
 */
import { ArrowUpRight, Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Sparkline } from '../../components/charts/Sparkline'
import { activeIn, useRoutine, useRoutineLog, useSpots } from '../../data/hooks'
import type { MetricId, Product, Session, Site } from '../../data/types'
import { useData } from '../../data/useData'
import type { SpotStatus } from '../../lib/api'
import { fmtDate, fmtPrice } from '../../lib/format'
import { METRIC_META, SITE_LABEL, fmtValue, unitOf } from '../../lib/metrics'
import { VERDICT_WORDS, verdictCounts, verdictKind, type VerdictKind } from '../../lib/verdict'
import { CategoryOrb } from '../routine/productUi'
import { entryName, metaLine, slotWords } from '../routine/routineModel'

export type WidgetSpec = { kind: 'metric_trend' | 'session_summary' | 'routine' | 'product' | 'spot_diary' | 'product_test'; params: Record<string, string | undefined> }

export type WidgetLinks = {
  go: (path: string) => void
  onProduct: (p: Product) => void
  onAdd: (p: Product) => void
  product: (id: string) => Product | null
}

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)

function Frame({ title, link, onLink, children }: { title: string; link: string; onLink: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[22px] bg-sunken/80 p-3.5" style={{ animation: 'wRise .45s both' }}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[.06em] text-ink-2">■ {title.toUpperCase()}</span>
        <button type="button" onClick={onLink} className="hit44 inline-flex items-center gap-1 rounded-pill bg-white px-2.5 py-1 text-[12px] transition-colors hover:bg-ink/5">
          {link} <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden />
        </button>
      </span>
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-[13px] text-ink-2">{children}</span>
}

function VerdictLine({ counts, only }: { counts: Record<VerdictKind, number>; only?: VerdictKind[] }) {
  const kinds = (only ?? (Object.keys(counts) as VerdictKind[])).filter((k) => counts[k] > 0)
  if (!kinds.length) return <Empty>No measurements in this check-in.</Empty>
  return (
    <span className="flex flex-wrap gap-1.5">
      {kinds.map((k) => (
        <span key={k} className="rounded-pill bg-white px-2.5 py-1 text-[12px]">
          {VERDICT_WORDS[k].glyph} {counts[k]} {VERDICT_WORDS[k].short.toLowerCase()}
        </span>
      ))}
    </span>
  )
}

function MetricTrend({ metricId, site, links }: { metricId: MetricId; site?: Site; links: WidgetLinks }) {
  const data = useData()
  const meta = METRIC_META[metricId]
  const sites = site ? [site] : meta.sites
  // the place with the most readings of this metric
  const bySite = sites.map((s) => ({ site: s, sessions: data.all.filter((x) => x.site === s && usable(x) && x.result?.metrics.some((m) => m.id === metricId)) }))
  const best = bySite.sort((a, b) => b.sessions.length - a.sessions.length)[0]
  const sessions = best?.sessions ?? []
  const last = sessions.at(-1)
  const lastMetric = last?.result?.metrics.find((m) => m.id === metricId)
  const where = best ? SITE_LABEL[best.site] : SITE_LABEL[sites[0]]
  return (
    <Frame title={`${meta.label} · ${where}`} link="Progress" onLink={() => links.go(`/progress?site=${best?.site ?? sites[0]}&metric=${metricId}`)}>
      {last && lastMetric ? (
        <span className="flex items-center gap-4">
          <span className="text-sky">
            <Sparkline values={sessions.map((s) => s.result?.metrics.find((m) => m.id === metricId)?.value ?? null)} width={140} height={40} label={`${meta.label} over ${sessions.length} check-ins`} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[17px] tabular-nums">
              {fmtValue(lastMetric.value, lastMetric)} <span className="text-[12px] text-ink-2">{unitOf(lastMetric)}</span>
            </span>
            <span className="text-[12px] text-ink-2">
              {VERDICT_WORDS[verdictKind(lastMetric, last)].glyph} {VERDICT_WORDS[verdictKind(lastMetric, last)].label} · {fmtDate(last.created_at)}
            </span>
          </span>
        </span>
      ) : (
        <Empty>No measured {meta.label.toLowerCase()} yet. A check-in of your {where.toLowerCase()} measures it.</Empty>
      )}
    </Frame>
  )
}

function SessionSummary({ sessionId, site, links }: { sessionId: string; site?: Site; links: WidgetLinks }) {
  const data = useData()
  const s = sessionId === 'latest' ? [...data.all].reverse().find((x) => usable(x) && (!site || x.site === site)) : data.all.find((x) => x.id === sessionId)
  return (
    <Frame title={s ? `${SITE_LABEL[s.site]} check-in · ${fmtDate(s.created_at)}` : 'Check-in'} link="Open" onLink={() => links.go(s ? `/result/${s.id}` : '/progress')}>
      {s ? <VerdictLine counts={verdictCounts(s)} /> : <Empty>No measured check-in yet.</Empty>}
    </Frame>
  )
}

function RoutineWidget({ slot, links }: { slot?: 'am' | 'pm'; links: WidgetLinks }) {
  const routine = useRoutine()
  const log = useRoutineLog()
  const used = log.data?.[0]?.used ?? {}
  const slots: ('am' | 'pm')[] = slot ? [slot] : ['am', 'pm']
  return (
    <Frame title={slot ? `${slotWords([slot])} routine` : 'Your routine today'} link="Routine" onLink={() => links.go('/routine')}>
      {routine.data ? (
        slots.map((sl) => {
          const items = activeIn(routine.data, sl)
          return (
            <div key={sl} className="flex flex-col gap-1.5">
              {slot ? null : <span className="text-[11.5px] text-ink-2">{slotWords([sl])}</span>}
              {items.length ? (
                items.map((e) => {
                  const ticked = (used[e.id] ?? []).includes(sl)
                  const p = e.product_id ? links.product(e.product_id) : null
                  return (
                    <span key={`${sl}${e.id}`} className="flex items-center gap-2.5">
                      <ProductThumb product={p} category={e.category} size={30} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{entryName(e)}</span>
                      <span className={`text-[11.5px] ${ticked ? 'text-willow-700' : 'text-ink-2'}`}>
                        {ticked ? (
                          <>
                            <Check size={12} className="inline align-[-1px]" aria-hidden /> used today
                          </>
                        ) : (
                          'not ticked'
                        )}
                      </span>
                    </span>
                  )
                })
              ) : (
                <Empty>Nothing in this slot.</Empty>
              )}
            </div>
          )
        })
      ) : (
        <Empty>{routine.status === 'error' ? 'Your routine couldn’t be loaded.' : 'Loading your routine…'}</Empty>
      )}
    </Frame>
  )
}

/** The brand's packshot (linked, never copied) or the category orb when there is none or it fails. */
export function ProductThumb({ product, category, size }: { product: Product | null; category: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (product?.image_url && !failed)
    return <img src={product.image_url} alt={product.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-[10px] bg-white object-contain" style={{ width: size, height: size }} />
  return <CategoryOrb category={product?.category ?? category} size={size} />
}

function ProductWidget({ productId, links }: { productId: string; links: WidgetLinks }) {
  const p = links.product(productId)
  const routine = useRoutine()
  // Already in use: say so (as the product sheet does) instead of offering a second entry for it.
  const entry = routine.data?.find((e) => e.product_id === productId && !e.ended_at)
  if (!p) return null
  return (
    <Frame title="Product" link="Details" onLink={() => links.onProduct(p)}>
      <span className="flex items-center gap-3">
        <ProductThumb product={p} category={p.category} size={52} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12px] text-ink-2">{metaLine(p.brand, p.category, p.size)}</span>
          <span className="text-[14px]">{p.name}</span>
          <span className="text-[12px] text-ink-2">
            {fmtPrice(p.price)} · checked {fmtDate(p.last_verified, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {entry ? (
          <span className="flex min-h-9 items-center rounded-pill bg-lime px-3.5 text-[12.5px]">✓ In your routine since {fmtDate(entry.started_at)}</span>
        ) : (
          <button type="button" onClick={() => links.onAdd(p)} className="hit44 min-h-9 rounded-pill bg-selected px-3.5 text-[12.5px] text-inverse">
            Add to routine
          </button>
        )}
        <button type="button" onClick={() => links.onProduct(p)} className="hit44 min-h-9 rounded-pill bg-white px-3.5 text-[12.5px]">
          Ingredients and stores
        </button>
      </span>
    </Frame>
  )
}

const SPOT_WORDS: Record<SpotStatus, string> = { new: 'New', still_there: 'Still there', fading: 'Fading', not_seen_last_time: 'Not seen last time', gone: 'Gone' }

function SpotDiaryWidget({ links }: { links: WidgetLinks }) {
  const spots = useSpots()
  const data = useData()
  const face = [...data.all].reverse().find((s) => s.site === 'face_full' && usable(s))
  const d = spots.data
  const counts = (Object.keys(SPOT_WORDS) as SpotStatus[]).map((k) => [k, d?.tracks.filter((t) => t.status === k).length ?? 0] as const).filter(([, n]) => n > 0)
  return (
    <Frame title="Spot diary" link="Diary" onLink={() => links.go(face ? `/result/${face.id}#spot-diary` : '/progress')}>
      {!d ? (
        <Empty>{spots.status === 'error' ? 'The spot diary couldn’t be loaded.' : 'Loading the spot diary…'}</Empty>
      ) : counts.length ? (
        <span className="flex flex-wrap gap-1.5">
          {counts.map(([k, n]) => (
            <span key={k} className="rounded-pill bg-white px-2.5 py-1 text-[12px]">
              {n} {SPOT_WORDS[k].toLowerCase()}
            </span>
          ))}
          <span className="self-center text-[11.5px] text-ink-2">
            over {d.sessions_used} check-in{d.sessions_used === 1 ? '' : 's'}
          </span>
        </span>
      ) : (
        <Empty>No spots followed yet. The diary starts after 3 face check-ins over 2 or more days.</Empty>
      )}
    </Frame>
  )
}

function ProductTestWidget({ links }: { links: WidgetLinks }) {
  const data = useData()
  const latest = (site: Site) => [...data.all].reverse().find((s) => s.site === site && usable(s))
  const rows: [string, Session | undefined][] = [
    ['Treated square', latest('forearm_treated')],
    ['Untouched square', latest('forearm_control')],
  ]
  return (
    <Frame title="Product test · forearm" link="Test" onLink={() => links.go('/test')}>
      {rows.some(([, s]) => s) ? (
        rows.map(([label, s]) => (
          <span key={label} className="flex flex-wrap items-center gap-2">
            <span className="w-[120px] text-[12.5px]">{label}</span>
            {s ? <VerdictLine counts={verdictCounts(s)} only={['changed', 'normal', 'baseline', 'notEnough']} /> : <Empty>no check-in yet</Empty>}
          </span>
        ))
      ) : (
        <Empty>No forearm test yet. It compares a treated square with an untouched one.</Empty>
      )}
    </Frame>
  )
}

export function Widget({ spec, links }: { spec: WidgetSpec; links: WidgetLinks }) {
  const p = spec.params
  switch (spec.kind) {
    case 'metric_trend':
      return p.metric_id && p.metric_id in METRIC_META ? <MetricTrend metricId={p.metric_id as MetricId} site={p.site as Site | undefined} links={links} /> : null
    case 'session_summary':
      return <SessionSummary sessionId={p.session_id ?? 'latest'} site={p.site as Site | undefined} links={links} />
    case 'routine':
      return <RoutineWidget slot={p.slot === 'am' || p.slot === 'pm' ? p.slot : undefined} links={links} />
    case 'product':
      return p.product_id ? <ProductWidget productId={p.product_id} links={links} /> : null
    case 'spot_diary':
      return <SpotDiaryWidget links={links} />
    case 'product_test':
      return <ProductTestWidget links={links} />
    default:
      return null
  }
}
