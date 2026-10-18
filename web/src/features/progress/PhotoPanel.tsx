import { forwardRef, useMemo, useState, type KeyboardEvent } from 'react'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { MetricId, Session, ViewName } from '../../data/types'
import type { SessionView } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { METRIC_META } from '../../lib/metrics'
import { MOLE_NOTE } from '../../lib/spotLabels'
import { leftOutPhotos, readableWarnings } from '../../lib/warnings'
import { MODE_LABEL, photoExpired, siteHasSpots } from './model'
import { frameFor, photoSize, toPct, type Box } from './frame'
import { PhotoFrame } from './PhotoFrame'
import { regionItems, type RegionItem } from './regions'
import { spotItems, spotLabelLine, spotShort, type SpotItem } from './spots'
import { useHoldCompare } from './useHoldCompare'
import { useImageStatus } from './useImageStatus'
import { candidateView, GROUP_LABEL, shownViews, VIEW_LABEL, VIEW_ORDER, viewSession } from './views'

/** A spot diary sighting shown on this photo: its box in this photo's pixels. */
export type DiaryFocus = { bbox: [number, number, number, number] | null; candidateId?: string | null; tag: string; area: string; status: string; backLabel: string; onBack: () => void }

type Overlay = 'spots' | 'redness' | 'areas' | 'none'
const OVERLAY_LABEL: Record<Overlay, string> = { spots: 'Spots', redness: 'Redness', areas: 'Areas', none: 'None' }

const LIST_LIMIT = 8
const fine = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

type Props = {
  session: Session
  focus: DiaryFocus | null
  /** The baseline this check-in is compared with: hold the photo to see it in place. */
  baseline?: Session | null
  /** GET /v1/sessions/{id} for this session (redness overlay, spot crops), when it has loaded. */
  view?: SessionView | null
  /** Metric ids in the order the Result lists them (goal order). */
  order?: MetricId[]
  onOpenMetric?: (id: MetricId) => void
}

/** Side photos measure only the marks on their cheek and jaw; tone, glow and the rest come from the front photo. */
const SIDE_METRICS: MetricId[] = ['pigment_spots', 'blemishes']

/**
 * The reference photo with what the engine found on it: spot candidates as numbered rings, the redness map
 * (when the engine drew one), the measured regions (tap one for its metrics) or nothing. Hold the photo (or
 * B) to see the baseline photo in place. A check-in with cheek photos has a glass Front face / Left cheek /
 * Right cheek toggle; each photo shows its own spots, redness and areas. Beside it the "Detected spots" panel
 * (grouped by photo when there are cheek photos), the mole note and the photo-quality card.
 */
export const PhotoPanel = forwardRef<HTMLElement, Props>(function PhotoPanel({ session, focus, baseline = null, view = null, order = [], onOpenMetric }, ref) {
  const [overlayPick, setOverlay] = useState<Overlay | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState<{ sid: string; n: number } | null>(null)
  const [region, setRegion] = useState<{ sid: string; key: string } | null>(null)
  const [all, setAll] = useState(false)
  const [viewPick, setViewPick] = useState<{ sid: string; focusId: string | null; v: ViewName } | null>(null)

  // The single-session view belongs to this session only (it may still be the previous one while scrubbing).
  const own = view?.session.id === session.id ? view.session : null
  const signedViews = useMemo(() => own?.views ?? [], [own])
  const views = useMemo(() => shownViews(session.result, signedViews), [session.result, signedViews])
  const multi = views.length > 1
  const allItems = useMemo(() => spotItems(session), [session])
  // Which photo is on the stage: the one picked, else the one the diary's spot is on, else the front.
  const focusId = focus?.candidateId ?? null
  const focusItem = focusId ? allItems.find((it) => it.c.id === focusId) : undefined
  const pickedView = viewPick?.sid === session.id && viewPick.focusId === focusId ? viewPick.v : null
  const wanted = pickedView ?? (focusItem ? candidateView(focusItem.c) : null)
  const rv = multi ? (views.find((v) => v.view === wanted) ?? views[0]) : null
  const active: ViewName = rv?.view ?? 'front'
  const sv = rv ? signedViews.find((v) => v.view === rv.view) : undefined
  const shown = useMemo(() => (rv && sv ? viewSession(session, rv, sv.preview) : session), [session, rv, sv])
  const pickView = (v: ViewName) => setViewPick({ sid: session.id, focusId, v })

  // Only the marks on the photo shown: without the cheek photos (still loading, failed, older sessions) that is the front.
  const items = allItems.filter((it) => candidateView(it.c) === active)
  const box = useMemo(() => frameFor(shown.site, shown.result, photoSize(shown), active), [shown, active])
  const regions = useMemo(() => regionItems(shown, order, active === 'front' ? undefined : SIDE_METRICS), [shown, order, active])
  const visible = items.filter((it) => showHidden || !it.hidden)
  const listed = allItems.filter((it) => showHidden || !it.hidden)
  const skin = allItems.filter((it) => !it.hidden)
  const labelsMissing = allItems.length > 0 && !Object.keys(session.label_details ?? {}).length
  const selN = picked?.sid === session.id ? picked.n : (visible[0]?.n ?? listed[0]?.n ?? null)
  const sel = listed.find((it) => it.n === selN) ?? null
  // Picking a spot in the list shows the photo it is on.
  const pick = (it: SpotItem) => {
    setPicked({ sid: session.id, n: it.n })
    if (multi && candidateView(it.c) !== active) pickView(candidateView(it.c))
  }
  const groups = multi ? VIEW_ORDER.filter((v) => views.some((x) => x.view === v)).map((v) => ({ v, items: listed.filter((it) => candidateView(it.c) === v) })) : [{ v: 'front' as ViewName, items: listed }]
  const spotsHere = siteHasSpots(session.site)
  const expired = !session.preview && photoExpired(session)
  const missing = expired ? 'Photos are deleted 30 days after upload. The measurements stay.' : 'No photo preview for this check-in. The numbers are measured from your photos.'
  const caption = `${session.capture_mode === 'uncalibrated' ? 'CAMERA PHOTO' : 'MEASURED REFERENCE PHOTO'} · ${fmtDate(session.created_at).toUpperCase()}${session.capture_mode === 'uncalibrated' ? ' · UNCALIBRATED' : ''}`
  // The diary's box is in the pixels of the photo its spot was found on.
  const focusHere = !focusItem || candidateView(focusItem.c) === active
  const focusPos = focus?.bbox && focusHere ? toPct(box, focus.bbox[0] + focus.bbox[2] / 2, focus.bbox[1] + focus.bbox[3] / 2) : null
  const focusSize = focus?.bbox ? Math.min(64, Math.max(28, (Math.max(focus.bbox[2], focus.bbox[3]) / box.w) * 420 + 14)) : 0

  const rednessUrl = (sv ? sv.redness_url : own?.overlay_urls?.redness) ?? null
  const crops = own?.crop_urls ?? {}

  // Overlay choices: only what this photo has. "None" whenever there is something to switch off.
  const choices: Overlay[] = [...(items.length ? (['spots'] as const) : []), ...(rednessUrl ? (['redness'] as const) : []), ...(regions.length ? (['areas'] as const) : [])]
  const options: Overlay[] = choices.length ? [...choices, 'none'] : []
  const overlay: Overlay = overlayPick && (options.includes(overlayPick) || overlayPick === 'none') ? overlayPick : (choices[0] ?? 'none')
  const redFailed = useImageStatus(overlay === 'redness' ? rednessUrl : null) === 'failed'
  const openRegion = overlay === 'areas' ? (regions.find((r) => region?.sid === session.id && r.key === region.key) ?? null) : null

  // Hold to compare with the baseline photo (its front photo: only on the front view).
  const canCompare = Boolean(active === 'front' && session.preview && baseline && baseline.id !== session.id && baseline.preview && !session.is_baseline)
  const hold = useHoldCompare(canCompare, session.id)
  const baseBox = useMemo(() => (baseline ? frameFor(baseline.site, baseline.result, photoSize(baseline)) : null), [baseline])
  const baseDate = baseline ? fmtDate(baseline.created_at) : ''

  const ring = (it: SpotItem) => {
    const [x, y, w, h] = it.c.bbox
    const p = toPct(box, x + w / 2, y + h / 2)
    if (p.left < 0 || p.left > 100 || p.top < 0 || p.top > 100) return null
    const on = it.n === selN
    return (
      <button
        key={it.n}
        type="button"
        onClick={() => pick(it)}
        aria-label={`Spot ${it.n}: ${it.kind}`}
        aria-pressed={on}
        className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
        style={{ left: `${p.left}%`, top: `${p.top}%`, zIndex: on ? 3 : 1 }}
      >
        <span
          className={`grid size-[26px] place-items-center rounded-full border-2 bg-white/30 text-[12px] font-semibold text-ink backdrop-blur-[2px] transition-transform duration-200 group-hover:scale-115 ${on ? 'animate-[wPulse_1.6s_ease-out_infinite]' : ''}`}
          style={{ borderColor: it.ring }}
        >
          {it.n}
        </span>
      </button>
    )
  }

  return (
    // Two columns for every site: a forearm photo on its own across a desktop page is taller than the screen.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4 pt-6">
      <section ref={ref} aria-label="Reference photo" className="flex scroll-mt-24 flex-col gap-3 rounded-[44px] bg-surface p-3.5 shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
        <div className={`relative ${canCompare ? 'touch-pan-y select-none [-webkit-touch-callout:none]' : ''}`} {...(canCompare ? hold.bind : {})}>
          <PhotoFrame session={shown} box={box} alt={`Your ${multi ? `${VIEW_LABEL[active].toLowerCase()} ` : ''}${MODE_LABEL[session.capture_mode]} photo from ${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}`} missing={missing}>
            {overlay === 'redness' && rednessUrl ? <RednessLayer url={rednessUrl} box={box} session={shown} /> : null}
            {overlay === 'areas' ? <RegionLayer regions={regions} box={box} open={openRegion?.key ?? null} onPick={(key) => setRegion(openRegion?.key === key ? null : { sid: session.id, key })} /> : null}
            {overlay === 'spots' ? visible.map(ring) : null}
            {focus && focusPos ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-[wDotIn_.45s_cubic-bezier(.2,.8,.2,1)_both,wRingPulse_1.8s_.5s_ease-out_infinite] rounded-full border-[2.5px] border-ink outline-[3px] outline-white/85 outline-solid"
                  style={{ left: `${focusPos.left}%`, top: `${focusPos.top}%`, width: focusSize, height: focusSize, zIndex: 4 }}
                />
                <span className="pointer-events-none absolute -translate-x-1/2 animate-[wFadeIn_.4s_.1s_both] rounded-pill bg-selected px-3 py-[7px] text-[12px] whitespace-nowrap text-inverse" style={{ left: `${focusPos.left}%`, top: `calc(${focusPos.top}% + ${focusSize / 2 + 8}px)`, zIndex: 4 }}>
                  {focus.tag}
                </span>
              </>
            ) : null}
          </PhotoFrame>
          {multi ? (
            <div className="absolute top-3.5 left-1/2 z-[6] w-max max-w-[calc(100%-24px)] -translate-x-1/2">
              <SegmentedControl glass label="Which photo" options={views.map((v) => ({ value: v.view, label: VIEW_LABEL[v.view] }))} value={active} onChange={pickView} />
            </div>
          ) : null}
          {focus && overlay !== 'areas' ? (
            <div className={`absolute inset-x-3.5 z-[5] ${multi ? 'top-[62px]' : 'top-3.5'} flex animate-[wRise_.35s_both] items-center gap-3 rounded-[22px] bg-surface/90 py-2.5 pr-2.5 pl-4 backdrop-blur-[14px]`}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px]">{focus.area}</span>
                <span className="text-[13px] text-ink-2">{focus.bbox && focusHere ? focus.status : 'Not seen on this photo'}</span>
              </span>
              <button type="button" onClick={focus.onBack} className="min-h-11 shrink-0 rounded-pill bg-selected px-3.5 text-[13px] text-inverse">
                Back to {focus.backLabel}
              </button>
            </div>
          ) : null}
          {session.preview && overlay === 'redness' ? (
            <span className="pointer-events-none absolute bottom-[72px] left-[18px] z-[5] max-w-[calc(100%-36px)] rounded-[16px] bg-white/80 px-3 py-2 text-[12px] leading-[1.35]">
              {redFailed ? 'The redness map could not be loaded. Reload the page to try again.' : 'Marked: where the camera sees more red than your usual skin. Not a medical assessment.'}
            </span>
          ) : null}
          {session.preview && options.length ? <OverlayPicker options={options} value={overlay} onChange={setOverlay} /> : null}
          {hold.armed && baseline && baseBox ? (
            <div aria-hidden={!hold.showBaseline} className={`pointer-events-none absolute inset-0 z-[6] transition-opacity duration-150 ${hold.showBaseline ? 'opacity-100' : 'opacity-0'}`}>
              <PhotoFrame session={baseline} box={baseBox} alt={`Your baseline photo from ${fmtDate(baseline.created_at, { day: 'numeric', month: 'long' })}`} missing="The baseline photo is not available." />
              <span className="absolute top-[18px] left-[18px] rounded-pill bg-lime px-2 py-0.5 font-mono text-[11px] tracking-[.06em] text-ink">BASELINE · {baseDate.toUpperCase()}</span>
            </div>
          ) : null}
        </div>
        {/* What photo this is, on the card under the photo (over it, it covered the face). */}
        <span className="px-2 pb-0.5 font-mono text-[11px] tracking-[.06em] text-ink-2">{caption}</span>
        {openRegion ? <RegionCard region={openRegion} onOpen={onOpenMetric} onClose={() => setRegion(null)} /> : null}
        {canCompare ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1.5 pb-1">
            <button
              type="button"
              aria-pressed={hold.pinned}
              onClick={hold.toggle}
              className={`flex min-h-11 items-center gap-2 rounded-pill px-4 text-[14px] transition-colors ${hold.pinned ? 'bg-selected text-inverse' : 'bg-sunken text-ink hover:bg-muted'}`}
            >
              <span aria-hidden className={`size-2.5 rounded-full ${hold.pinned ? 'bg-lime' : 'border-[1.5px] border-ink/40'}`} />
              Show baseline · {baseDate}
            </button>
            <span className="text-[13px] text-ink-2">{fine() ? 'Or hold the photo, or hold B' : 'Or press and hold the photo'}</span>
          </div>
        ) : null}
        <span className="sr-only" role="status">
          {hold.comparing ? `Showing your baseline photo from ${fmtDate(baseline!.created_at, { day: 'numeric', month: 'long' })}.` : ''}
        </span>
      </section>

      <section aria-label={spotsHere ? 'Detected spots' : 'Photo quality'} className="flex flex-col gap-3">
        {spotsHere ? (
          <div className="flex flex-col gap-3.5 rounded-[36px] bg-selected p-[clamp(20px,3vw,28px)] text-inverse squircle">
            <div className="flex flex-wrap items-baseline justify-between gap-2.5">
              <h3 className="m-0 text-[24px] font-normal">Detected spots</h3>
              <span className="font-dot text-[30px] font-extrabold text-lime" aria-label={`${skin.length} skin ${skin.length === 1 ? 'finding' : 'findings'}`}>
                {String(skin.length).padStart(2, '0')}
              </span>
            </div>
            <p className="m-0 text-[14px] leading-[1.45] text-white/75">
              {!allItems.length
                ? `No spots were found on ${multi ? 'these photos' : 'this photo'}.`
                : labelsMissing
                  ? 'Found by image measurement. AI labels weren’t available for this check-in, so candidates are shown without appearance labels.'
                  : 'Found by image measurement. Labels are AI suggestions about appearance, not diagnoses.'}
            </p>
            {sel ? (
              <div key={sel.n} className="flex animate-[wRise_.35s_both] items-center gap-3.5 rounded-[24px] bg-white/8 p-3.5">
                <SpotCrop key={`${session.id}-${sel.c.id}`} url={crops[sel.c.id] ?? null} n={sel.n} ring={sel.ring} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[17px]">
                    {sel.n} · {sel.kind}
                  </span>
                  <span className="text-[13px] text-white/85">{spotLabelLine(sel, labelsMissing)}</span>
                  {sel.agree ? (
                    <span className="flex items-center gap-1.5 text-[12px] text-white/70">
                      <span aria-hidden className="flex gap-[3px]">
                        {Array.from({ length: sel.agree.of }, (_, i) => (
                          <span key={i} className={`size-2 rounded-full ${i < sel.agree!.seen ? 'bg-lime' : 'bg-white/20'}`} />
                        ))}
                      </span>
                      Seen in {sel.agree.seen} of {sel.agree.of} photos
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            {listed.length ? (
              <div className="flex flex-col gap-1">
                {groups.map((g) => (
                  <div key={g.v} role={multi ? 'group' : undefined} aria-label={multi ? `${GROUP_LABEL[g.v]}: ${g.items.length} ${g.items.length === 1 ? 'spot' : 'spots'}` : undefined} className="flex flex-col gap-1">
                    {multi ? (
                      <span aria-hidden className="flex items-baseline justify-between px-3 pt-2.5 pb-0.5 font-mono text-[11px] tracking-[.06em] text-white/60">
                        {GROUP_LABEL[g.v].toUpperCase()}
                        <span>{String(g.items.length).padStart(2, '0')}</span>
                      </span>
                    ) : null}
                    {multi && !g.items.length ? <span className="px-3 pb-1 text-[13px] text-white/60">No spots found on this photo.</span> : null}
                {(all ? g.items : g.items.slice(0, LIST_LIMIT)).map((it) => (
                  <button
                    key={it.n}
                    type="button"
                    aria-pressed={it.n === selN}
                    onClick={() => pick(it)}
                    className={`flex min-h-11 w-full items-center gap-3.5 rounded-[18px] px-3 py-2.5 text-left transition-colors ${it.n === selN ? 'bg-white/14' : 'hover:bg-white/6'}`}
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-full border-2 text-[12px]" style={{ borderColor: it.ring }}>
                      {it.n}
                    </span>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[15px]">{it.kind}</span>
                      <span className="text-[12px] text-white/70">{spotShort(it, labelsMissing)}</span>
                    </span>
                  </button>
                ))}
                  </div>
                ))}
                {groups.some((g) => g.items.length > LIST_LIMIT) ? (
                  <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="min-h-11 self-start rounded-pill bg-white/10 px-4 text-[13px]">
                    {all ? 'Show fewer' : `Show all ${listed.length}`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {allItems.some((it) => it.hidden) ? (
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2.5 rounded-[18px] bg-white/6 px-3 py-2.5 text-[14px]">
                Show hair and artefacts
                <input type="checkbox" role="switch" checked={showHidden} onChange={() => setShowHidden((v) => !v)} className="size-[22px] accent-[var(--signal-baseline)]" />
              </label>
            ) : null}
          </div>
        ) : null}
        {spotsHere ? <div className="rounded-[28px] bg-surface px-[22px] py-[18px] text-[14px] leading-normal text-ink-2 squircle">Moles are not assessed. {MOLE_NOTE}</div> : null}
        <QualityCard session={session} />
      </section>
    </div>
  )
})

/** Spots / Redness / Areas / None, the design's glass radiogroup at the foot of the photo. Arrow keys move. */
function OverlayPicker({ options, value, onChange }: { options: Overlay[]; value: Overlay; onChange: (o: Overlay) => void }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const el = e.currentTarget
    const next = options[(options.indexOf(value) + d + options.length) % options.length]
    onChange(next)
    requestAnimationFrame(() => el.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div role="radiogroup" aria-label="Show on the photo" onKeyDown={move} className="absolute bottom-4 left-1/2 z-[5] flex max-w-[calc(100%-24px)] -translate-x-1/2 gap-[3px] rounded-pill bg-white/75 p-1 backdrop-blur-[16px]">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          tabIndex={value === o ? 0 : -1}
          onClick={() => onChange(o)}
          className={`min-h-10 rounded-pill px-3.5 text-[13px] whitespace-nowrap transition-colors max-[360px]:px-2.5 ${value === o ? 'bg-selected text-inverse' : 'text-ink'}`}
        >
          {OVERLAY_LABEL[o]}
        </button>
      ))}
    </div>
  )
}

/**
 * The engine's redness map (a PNG with alpha, the same pixel size and orientation as the photo), drawn in the
 * photo's own coordinates through the same frame crop.
 */
function RednessLayer({ url, box, session }: { url: string; box: Box; session: Session }) {
  const size = photoSize(session)
  return (
    <svg aria-hidden viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full animate-[wFadeIn_.3s_both]">
      <image href={url} width={size.width} height={size.height} preserveAspectRatio="xMidYMid slice" />
    </svg>
  )
}

/** The measured regions as outlines; each is a button that opens what was measured there. */
function RegionLayer({ regions, box, open, onPick }: { regions: RegionItem[]; box: Box; open: string | null; onPick: (key: string) => void }) {
  const key = (e: KeyboardEvent<SVGPolygonElement>, k: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onPick(k)
  }
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 z-[2] size-full animate-[wFadeIn_.3s_both]" role="group" aria-label="Measured areas">
      {regions.map((r) => {
        const on = r.key === open
        return (
          <g key={r.key}>
            {/* A dark edge under the light one keeps the outline visible on any skin tone and background. */}
            <polygon points={r.points} fill="none" stroke="rgba(18,18,18,.45)" strokeWidth={on ? 4.5 : 3.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" pointerEvents="none" />
            <polygon
              points={r.points}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${r.label}: ${r.metrics.length ? r.metrics.map((id) => METRIC_META[id].label).join(', ') : 'nothing measured here this time'}`}
              onClick={(e) => {
                e.stopPropagation()
                onPick(r.key)
              }}
              onKeyDown={(e) => key(e, r.key)}
              fill={on ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.08)'}
              strokeWidth={on ? 2.5 : 1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer stroke-white outline-none transition-[fill] duration-200 hover:fill-white/20"
            />
          </g>
        )
      })}
    </svg>
  )
}

/** What was measured in the tapped region, each metric opening its detail. */
function RegionCard({ region, onOpen, onClose }: { region: RegionItem; onOpen?: (id: MetricId) => void; onClose: () => void }) {
  return (
    <div role="group" aria-label={region.label} className="flex animate-[wRise_.35s_both] flex-col gap-2 rounded-[26px] bg-sunken py-2.5 pr-2 pl-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px]">{region.label}</span>
          <span className="text-[13px] text-ink-2">{region.metrics.length ? 'Measured here' : 'Nothing measured here this time'}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={`Close ${region.label}`} className="grid size-11 shrink-0 place-items-center rounded-full text-[16px] text-ink-2 hover:bg-sunken">
          <span aria-hidden>✕</span>
        </button>
      </div>
      {region.metrics.length ? (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {region.metrics.map((id) => (
            <button key={id} type="button" onClick={() => onOpen?.(id)} className="flex min-h-10 items-center gap-1.5 rounded-pill bg-selected px-3.5 text-[13px] text-inverse">
              {METRIC_META[id].label}
              <span aria-hidden>→</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** The engine's tight crop of the selected spot (signed by the api), else the design's drawn placeholder. */
function SpotCrop({ url, n, ring }: { url: string | null; n: number; ring: string }) {
  const [failed, setFailed] = useState(false)
  const cls = 'size-[76px] shrink-0 rounded-full border-2 shadow-[0_0_0_5px_rgba(255,255,255,.06)]'
  if (url && !failed) return <img src={url} alt={`Close-up of spot ${n}`} width={76} height={76} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`${cls} bg-white/10 object-cover`} style={{ borderColor: ring }} />
  return <span aria-hidden className={cls} style={{ borderColor: ring, background: 'radial-gradient(circle at 50% 50%, #6E4636 0%, #8A5D48 40%, #3A2A24 80%)' }} />
}

/** Which photos were used, or the engine's notes in plain words (design "quality" card). */
function QualityCard({ session }: { session: Session }) {
  const r = session.result
  if (!r) return null
  const left = leftOutPhotos(r)
  const notes = readableWarnings(r)
  const all = r.quality.passed && r.frames_used === session.n_frames
  const title = left ? (r.frames_used === 1 ? `Only 1 of ${session.n_frames} photos was used` : `${r.frames_used} of ${session.n_frames} photos were used`) : all ? (session.n_frames === 1 ? 'Your photo was usable' : `All ${session.n_frames} photos usable`) : 'Photo quality'
  const tone = left ? 'bg-[var(--action-primary)]' : session.is_baseline && all ? 'bg-lime' : 'bg-surface'
  return (
    <div className={`flex flex-col gap-1.5 rounded-[28px] px-[22px] py-[18px] squircle ${tone}`}>
      <span className="text-[15px]">{title}</span>
      {left ? <span className="text-[14px] leading-[1.45]">{left}</span> : null}
      {notes.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-[1.45]">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : !left ? (
        <span className="text-[14px] leading-[1.45]">No quality issues recorded for this check-in.</span>
      ) : null}
    </div>
  )
}
