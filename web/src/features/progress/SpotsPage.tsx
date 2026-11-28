import { useMemo, useState } from 'react'

import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { WillowLoader } from '../../components/willow/WillowLoader'
import { useOwner, useSpotCheckIns } from '../../data/hooks'
import type { ViewName } from '../../data/types'
import type { SpotCheckIn, SpotCheckInView } from '../../lib/api'
import { MOLE_NOTE } from '../../lib/spotLabels'
import { AREA_LABEL, SPOT_CLOSE_UP, SPOT_NEAR, VIEW_LABEL, areaBox, areaCounts, areaFrame, areaPhoto, areasOf, boxAround, carry, countLine, dayLabel, fromAreaPoint, markNear, shownWeeks, startPoint, toAreaPoint, viewOf, viewsOf, type Box } from '../../lib/spotDiary'
import { Crumb, Page, StatusCard } from './parts'

const RING = { blemish: 'var(--willow-400)', spot: 'var(--aura-apricot)' } as const

/**
 * The spot diary (`/spots`, api GET /v1/spots/check-ins): your check-ins, in order. Pick one (or two to compare),
 * look at each photo (front, left cheek, right cheek) with every blemish and dark spot it counted, and follow one
 * area across the weeks. Counts are the check-in's own, as Progress shows them; nothing is matched across weeks, so
 * there are no "appeared" or "faded" totals to trust or doubt. Live accounts only.
 */
export default function SpotsPage() {
  const owner = useOwner()
  const shell = useShell()
  const q = useSpotCheckIns()
  const weeks = useMemo(() => q.data?.check_ins ?? [], [q.data])
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(true) // opens on the last two check-ins side by side
  const [all, setAll] = useState(false)
  const [view, setView] = useState<ViewName>('front')
  const [area, setArea] = useState<string | null | undefined>(undefined) // undefined: the forehead, until picked

  const crumb = <Crumb to="/progress" back="Progress" here="Spot diary" />
  if (!owner)
    return (
      <Page label="Spot diary">
        {crumb}
        <StatusCard title="The spot diary shows your own spots." body="It needs your own face check-ins, so it isn't part of the demo. Sign in and check in a few times to see it fill in." />
      </Page>
    )
  if (q.status === 'loading' && !weeks.length) return <WillowLoader inline label="Loading your check-ins" />
  if (q.status === 'error' && !weeks.length)
    return (
      <Page label="Spot diary">
        {crumb}
        <StatusCard title="Your spot diary did not load" body="Check your connection, then try again." action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
      </Page>
    )
  if (!weeks.length)
    return (
      <Page label="Spot diary">
        {crumb}
        <StatusCard
          title="Your spot diary starts with your first face check-in."
          body="Each check-in shows here with every blemish and dark spot on its photos, so you can compare weeks."
          action={
            <Button variant="ink" onClick={() => shell.openCheckIn()}>
              Take a face check-in
            </Button>
          }
        />
      </Page>
    )

  // the latest check-in unless the person picked; with compare on, two weeks side by side (older first)
  const ids = weeks.map((w) => w.id)
  const latest = comparing ? ids.slice(-2) : ids.slice(-1)
  const chosen = (picked.length ? picked : latest).filter((id) => ids.includes(id))
  const selected = weeks.filter((w) => chosen.includes(w.id)).slice(0, comparing ? 2 : 1)
  const views = viewsOf(selected[selected.length - 1])
  const v = views.includes(view) ? view : (views[0] ?? 'front')
  const areas = areasOf(viewOf(selected[selected.length - 1], v))
  const shownArea = area === undefined ? (areas.includes('forehead') ? 'forehead' : (areas[0] ?? null)) : area

  const pick = (id: string) => {
    if (!comparing) return setPicked([id])
    setPicked((cur) => {
      const base = cur.length ? cur : latest
      if (base.includes(id)) return base.length > 1 ? base.filter((x) => x !== id) : base
      const next = [...base.slice(-1), id]
      return next.sort((a, b) => ids.indexOf(a) - ids.indexOf(b))
    })
  }
  const list = shownWeeks(weeks, all)

  return (
    <Page label="Spot diary">
      {crumb}
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-serif text-[clamp(30px,3.4vw,44px)] leading-[1] font-normal tracking-[-0.01em]">Your spot diary</h1>
        <p className="m-0 max-w-[640px] text-[15px] leading-[1.45] text-ink-2">Every blemish and dark spot Willow counted, ringed on your photos.</p>
      </div>

      <section aria-label="Check-ins" className="flex flex-col gap-3 rounded-[32px] bg-surface/80 p-[clamp(16px,2.4vw,24px)] squircle">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px]">{comparing ? (picked.length ? 'Comparing two check-ins.' : 'Your last two check-ins, side by side.') : 'One check-in.'} <span className="text-ink-2">{comparing ? 'Tap any two dates to compare them.' : 'Tap a date to see it.'}</span></span>
          <button
            type="button"
            aria-pressed={comparing}
            onClick={() => {
              setComparing((c) => !c)
              setPicked(comparing ? selected.slice(-1).map((w) => w.id) : [])
            }}
            className={`min-h-10 rounded-pill px-4 text-[13.5px] ${comparing ? 'bg-selected text-inverse' : 'bg-white shadow-[inset_0_0_0_1px_var(--line-subtle)]'}`}
          >
            {comparing ? 'Show one check-in' : 'Compare two check-ins'}
          </button>
        </div>
        <div role="group" aria-label="Check-in dates" className="flex flex-wrap gap-2">
          {weeks.length > list.length ? (
            <button type="button" onClick={() => setAll(true)} className="min-h-11 rounded-pill px-3.5 text-[13.5px] text-ink-2 underline underline-offset-4">
              {weeks.length - list.length} earlier
            </button>
          ) : null}
          {list.map((w) => {
            const on = selected.some((s) => s.id === w.id)
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={on}
                aria-label={`${dayLabel(w.created_at, { day: 'numeric', month: 'long' })}: ${countLine(w.blemishes, w.dark_spots)}`}
                onClick={() => pick(w.id)}
                className={`flex min-h-11 flex-col items-start justify-center rounded-[18px] px-3.5 py-1.5 text-left ${on ? 'bg-selected text-inverse' : 'bg-white shadow-[inset_0_0_0_1px_var(--line-subtle)]'}`}
              >
                <span className="text-[14px] leading-tight">{dayLabel(w.created_at)}</span>
                <span className={`text-[11.5px] leading-tight ${on ? 'text-inverse/75' : 'text-ink-2'}`}>{countLine(w.blemishes, null)}</span>
              </button>
            )
          })}
        </div>
      </section>

      {views.length > 1 ? (
        <div role="tablist" aria-label="Photo" className="flex flex-wrap gap-2">
          {views.map((name) => (
            <button key={name} role="tab" aria-selected={name === v} type="button" onClick={() => setView(name)} className={`min-h-11 rounded-pill px-4 text-[14px] ${name === v ? 'bg-selected text-inverse' : 'bg-white/80 shadow-[inset_0_0_0_1px_var(--line-subtle)]'}`}>
              {VIEW_LABEL[name]}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`grid w-full gap-4 ${selected.length > 1 ? 'max-w-[980px] grid-cols-2' : 'max-w-[520px] grid-cols-1'}`}>
        {selected.map((w) => (
          <CheckInPhoto key={w.id} week={w} view={viewOf(w, v)} viewName={v} area={null} compact={selected.length > 1} />
        ))}
      </div>
      {selected.length > 1 ? <CompareLine a={selected[0]} b={selected[1]} view={v} /> : null}

      {areas.length ? (
        <section aria-label="Areas" className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">Follow an area across your check-ins</span>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <button key={a} type="button" aria-pressed={shownArea === a} onClick={() => setArea(shownArea === a ? null : a)} className={`min-h-10 rounded-pill px-3.5 text-[13.5px] ${shownArea === a ? 'bg-selected text-inverse' : 'bg-white/80 shadow-[inset_0_0_0_1px_var(--line-subtle)]'}`}>
                {AREA_LABEL[a]}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {shownArea ? <AreaTimeline key={shownArea} weeks={weeks} area={shownArea} prefer={v} current={selected[selected.length - 1]?.id} /> : null}

      <p className="max-w-[640px] text-[13px] leading-normal text-ink-2">
        Rings show what the engine counted: <span style={{ color: RING.blemish }}>●</span> blemishes, <span style={{ color: RING.spot }}>●</span> dark spots. Moles are never ringed or counted here. {MOLE_NOTE}
      </p>
    </Page>
  )
}

/** One photo of a check-in with every mark it counted, and its counts; with an area picked, that area's outline. */
function CheckInPhoto({ week, view, viewName, area, compact }: { week: SpotCheckIn; view: SpotCheckInView | undefined; viewName: ViewName; area: string | null; compact: boolean }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      {view ? (
        <MarkedPhoto view={view} area={area} label={`${VIEW_LABEL[viewName]}, ${dayLabel(week.created_at, { day: 'numeric', month: 'long' })}`} />
      ) : (
        <div className="grid aspect-[4/5] place-items-center rounded-[28px] bg-sunken p-6 text-center text-[14px] text-ink-2">No {VIEW_LABEL[viewName].toLowerCase()} photo at this check-in</div>
      )}
      <figcaption className="flex flex-col gap-0.5">
        <span className={compact ? 'text-[15px]' : 'text-[17px]'}>
          {dayLabel(week.created_at, { day: 'numeric', month: 'long' })}
          {view && view.blemishes != null ? <span className="text-ink-2"> · {VIEW_LABEL[viewName].toLowerCase()}: {countLine(view.blemishes, view.dark_spots)}</span> : null}
        </span>
        <span className="text-[13px] text-ink-2">Whole check-in, as in Progress: {countLine(week.blemishes, week.dark_spots)}</span>
        {!week.complete ? <span className="text-[12.5px] leading-snug text-ink-2">Measured before every spot was placed on the photo: only some are ringed. The counts are complete.</span> : null}
      </figcaption>
    </figure>
  )
}

/** "Right cheek: 31 → 16 blemishes", from the two photos' own counts. */
function CompareLine({ a, b, view }: { a: SpotCheckIn; b: SpotCheckIn; view: ViewName }) {
  const va = viewOf(a, view)
  const vb = viewOf(b, view)
  const line = (x: number | null | undefined, y: number | null | undefined, word: string) => (x != null && y != null ? `${x} → ${y} ${word}` : null)
  const photo = [line(va?.blemishes, vb?.blemishes, 'blemishes'), line(va?.dark_spots, vb?.dark_spots, 'dark spots')].filter(Boolean)
  const whole = [line(a.blemishes, b.blemishes, 'blemishes'), line(a.dark_spots, b.dark_spots, 'dark spots')].filter(Boolean)
  if (!photo.length && !whole.length) return null
  return (
    <p className="m-0 rounded-[20px] bg-white/70 px-4 py-3 text-[15px] leading-[1.45]">
      {dayLabel(a.created_at)} → {dayLabel(b.created_at)}
      {photo.length ? `, ${VIEW_LABEL[view].toLowerCase()}: ${photo.join(' · ')}` : ''}
      {whole.length ? `${photo.length ? '. Whole face' : ', whole face'}: ${whole.join(' · ')}` : ''}.
    </p>
  )
}

/** A photo (or the `box` part of it) with its marks ringed, in photo pixels; an area's outline when given. `target`:
 * a place to circle (the spot being followed); `onPick`: tap anywhere to pick a place (photo pixels). */
function MarkedPhoto({ view, area, box, label, rounded = 'rounded-[28px]', target, onPick, dim }: { view: SpotCheckInView; area?: string | null; box?: Box | null; label: string; rounded?: string; target?: { x: number; y: number; r: number } | null; onPick?: (x: number, y: number) => void; dim?: boolean }) {
  const W = view.photo.width ?? 1
  const H = view.photo.height ?? 1
  const b = box ?? { x: 0, y: 0, w: W, h: H }
  const roi = area ? view.rois.find((r) => r.name === area) : null
  const unit = Math.max(b.w, b.h) / 300 // stroke widths that read the same on a whole photo and a crop
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return
    const svg = e.currentTarget
    const m = svg.getScreenCTM()
    if (!m) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    onPick(pt.x, pt.y)
  }
  return (
    <div className={`relative overflow-hidden bg-sunken squircle ${rounded} ${box ? 'aspect-square' : 'aspect-[4/5]'}`}>
      <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label} onClick={pick} className={`absolute inset-0 size-full ${onPick ? 'cursor-crosshair' : ''}`}>
        <image href={view.photo.url} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
        {roi ? <polygon points={roi.polygon.map((p) => p.join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth={unit * 1.4} strokeLinejoin="round" opacity={0.9} /> : null}
        {view.marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={Math.max(m.r * 1.6, unit * 3)} fill="none" stroke={RING[m.kind]} strokeWidth={unit * 1.1} opacity={dim ? 0.55 : 1} />
        ))}
        {target ? (
          <g>
            <circle cx={target.x} cy={target.y} r={target.r} fill="none" stroke="#fff" strokeWidth={unit * 2.6} />
            <circle cx={target.x} cy={target.y} r={target.r} fill="none" stroke="var(--text-primary)" strokeWidth={unit * 1.2} strokeDasharray={`${unit * 3} ${unit * 2}`} />
          </g>
        ) : null}
      </svg>
    </div>
  )
}

/**
 * One area across the check-ins: the same patch of skin from each check-in's photo (the area's outline follows the face,
 * so the crop does too), large for the check-in on the slider and as a strip, with that area's counts from Progress.
 * Tap a spot to follow that place: a close-up of it from every check-in, and whether a mark was counted there, so a
 * spot that is fading, staying, or keeps coming back in the same place shows check-in by check-in. A place is followed by
 * where it sits in the area (its share across and down), not by matching marks, so nothing is claimed to be "the
 * same spot": the close-ups show it.
 */
function AreaTimeline({ weeks, area, prefer, current }: { weeks: SpotCheckIn[]; area: string; prefer: ViewName; current: string | undefined }) {
  const rows = weeks
    .map((w) => {
      const view = areaPhoto(w, area, prefer)
      const frame = view && areaFrame(view, area)
      return view && frame ? { w, view, box: areaBox(view, area)!, frame, counts: areaCounts(w, area) } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  const start = Math.max(0, rows.findIndex((r) => r.w.id === current))
  const [at, setAt] = useState<number | null>(null)
  // the place followed, at photo pixels of the check-in it was picked on
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null)
  const i = Math.min(at ?? start, Math.max(rows.length - 1, 0))
  if (!rows.length) return null
  const row = rows[i]
  // the place followed: the person's pick, else the biggest mark in the area on the latest check-in shown
  const latest = rows[Math.min(start, rows.length - 1)]
  type Row = (typeof rows)[number]
  const src = (picked && rows.find((r) => r.w.id === picked.id)) || latest
  const at0 = picked && src.w.id === picked.id ? picked : { ...fromAreaPoint(latest.frame, startPoint(latest.view, area, latest.frame)) }
  // where that place is on each check-in's photo: through the face landmarks around it (same view), else the area
  const placeOn = (r: Row) => {
    if (r === src) return { x: at0.x, y: at0.y }
    const viaFace = r.view.view === src.view.view ? carry(src.view.landmarks, r.view.landmarks, at0.x, at0.y) : null
    return viaFace ?? fromAreaPoint(r.frame, toAreaPoint(src.frame, at0.x, at0.y))
  }
  const near = (r: Row) => {
    const q = placeOn(r)
    return markNear(r.view, q.x, q.y, r.frame.s * SPOT_NEAR)
  }
  const ring = (r: Row) => ({ ...placeOn(r), r: r.frame.s * SPOT_NEAR * 1.4 })
  const closeUp = (r: Row) => {
    const q = placeOn(r)
    return boxAround(r.view, q.x, q.y, r.frame.s * SPOT_CLOSE_UP)
  }
  const marked = rows.filter((r) => near(r)).length
  return (
    <section aria-label={`${AREA_LABEL[area]} across your check-ins`} className="flex flex-col gap-4 rounded-[32px] bg-surface/80 p-[clamp(16px,2.4vw,24px)] squircle">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[20px] font-normal">{AREA_LABEL[area]} across your check-ins</h2>
        <span className="text-[13px] text-ink-2">Counts for this area, as in Progress</span>
      </div>
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <MarkedPhoto view={row.view} area={area} box={row.box} label={`${AREA_LABEL[area]}, ${dayLabel(row.w.created_at, { day: 'numeric', month: 'long' })}. Tap a spot to follow it.`} rounded="rounded-[24px]" target={ring(row)} onPick={(x, y) => setPicked({ id: row.w.id, x, y })} dim />
          <span className="text-[12.5px] text-ink-2">Tap any spot on this photo to follow it across your check-ins.</span>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-[22px]">{dayLabel(row.w.created_at, { day: 'numeric', month: 'long' })}</span>
          <span className="text-[16px]">{countLine(row.counts.blemishes, row.counts.darkSpots) || 'Not counted at this check-in'}</span>
          <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            Move through your check-ins
            <input type="range" min={0} max={rows.length - 1} step={1} value={i} onChange={(e) => setAt(Number(e.target.value))} aria-valuetext={dayLabel(row.w.created_at, { day: 'numeric', month: 'long' })} className="w-full accent-[var(--text-primary)]" />
          </label>
          <span className="flex justify-between text-[12px] text-ink-2">
            <span>{dayLabel(rows[0].w.created_at)}</span>
            <span>{dayLabel(rows[rows.length - 1].w.created_at)}</span>
          </span>
        </div>
      </div>
      <ol aria-label="The area at every check-in" className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
        {rows.map((r, k) => (
          <li key={r.w.id} className="w-[92px] shrink-0">
            <button type="button" onClick={() => setAt(k)} aria-pressed={k === i} className={`flex w-full flex-col gap-1 rounded-[18px] p-1 text-left ${k === i ? 'bg-selected text-inverse' : ''}`}>
              <MarkedPhoto view={r.view} area={area} box={r.box} label={`${AREA_LABEL[area]}, ${dayLabel(r.w.created_at)}`} rounded="rounded-[14px]" />
              <span className="px-1 text-[12px] leading-tight">{dayLabel(r.w.created_at)}</span>
              <span className={`px-1 text-[11px] leading-tight ${k === i ? 'text-inverse/75' : 'text-ink-2'}`}>{r.counts.blemishes ?? '–'} blem.</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-ink/10 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-[17px] font-normal">This spot at each check-in</h3>
          <span className="text-[13px] text-ink-2">A mark was counted here at {marked} of {rows.length} check-ins</span>
        </div>
        <ol aria-label="The spot at every check-in" className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
          {rows.map((r, k) => {
            const m = near(r)
            return (
              <li key={r.w.id} className="w-[104px] shrink-0">
                <button type="button" onClick={() => setAt(k)} className="flex w-full flex-col gap-1 rounded-[16px] p-1 text-left">
                  <MarkedPhoto view={r.view} box={closeUp(r)} label={`The spot on ${dayLabel(r.w.created_at)}: ${m ? (m.kind === 'spot' ? 'a dark spot counted' : 'a blemish counted') : 'nothing counted'}`} rounded="rounded-[14px]" target={ring(r)} />
                  <span className="px-1 text-[12px] leading-tight">{dayLabel(r.w.created_at)}</span>
                  <span className="flex items-center gap-1 px-1 text-[11px] leading-tight text-ink-2">
                    <span aria-hidden style={{ color: m ? RING[m.kind] : 'var(--line-strong, #bbb)' }}>{m ? '●' : '○'}</span>
                    {m ? (m.kind === 'spot' ? 'Dark spot' : 'Blemish') : 'Nothing counted'}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <p className="m-0 text-[12.5px] leading-snug text-ink-2">The same place on your face at each check-in, found from the face points around it (brows, nose, hairline…), so it stays put when your head turns or the photo is framed differently. Whether it is the very same spot, the close-ups show; Willow does not decide that.</p>
      </div>
    </section>
  )
}
