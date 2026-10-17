import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Skeleton } from '../../components/ui/Skeleton'
import { FACE_MAP } from '../../data/faceMap'
import type { Session, ViewName } from '../../data/types'
import type { SessionView, SpotDiary as Diary, SpotStatus, SpotTrack, SpotZone } from '../../lib/api'
import { ORDER, STAGE_COLOUR, STATUS_SHAPE, ZONE_NAME, fmtDays, isToday, stageName, statusText } from './diaryText'
import { fmtDate } from '../../lib/format'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { apply, fitAffine, scaleOf, type Affine, type Pt } from './faceFit'
import { useImageStatus } from './useImageStatus'
import { candidateView, shownViews, VIEW_LABEL, viewSession } from './views'

/** The zones a cheek photo shows (engine SIDE_ZONES); the front photo shows the rest. */
const SIDE_ZONES: Record<Exclude<ViewName, 'front'>, SpotZone[]> = { right: ['right_cheek', 'right_jaw'], left: ['left_cheek', 'left_jaw'] }
const viewOfZone = (z: SpotZone | null | undefined): ViewName => (z && SIDE_ZONES.right.includes(z) ? 'right' : z && SIDE_ZONES.left.includes(z) ? 'left' : 'front')

function Shape({ status, size = 11, selected }: { status: SpotStatus; size?: number; selected?: boolean }) {
  const s = STATUS_SHAPE[status]
  return <span aria-hidden className="block shrink-0 rounded-full" style={{ width: size, height: size, border: s.border, background: s.bg, boxShadow: selected ? `${s.halo === 'none' ? '' : `${s.halo}, `}0 0 0 5px rgba(255,255,255,.9), 0 0 0 6.5px var(--text-primary)` : s.halo }} />
}

/**
 * The spot diary (GET /v1/spots): each mark followed across face photos by its place on the face, with the
 * face map the design computed (now drawn), area summary, and one row per mark with a cell per photo.
 */
export function SpotDiary({
  status,
  diary,
  onRetry,
  stageSessionId,
  selected,
  onPick,
  onTake,
  photo = null,
  photoViews = [],
}: {
  status: 'idle' | 'loading' | 'ready' | 'error'
  diary: Diary | undefined
  onRetry: () => void
  /** The session on the photo stage above (its column is marked). */
  stageSessionId: string | null
  selected: string | null
  onPick: (t: SpotTrack) => void
  onTake: (() => void) | null
  /** The latest face check-in in the diary with a photo: the spots are drawn on it when it can be placed. */
  photo?: Session | null
  /** That check-in's photos by view, signed (front, left and right cheek), when it has cheek photos. */
  photoViews?: NonNullable<SessionView['session']['views']>
}) {
  const [zone, setZone] = useState<SpotZone | null>(null)
  const [all, setAll] = useState(false)
  // A status key chip picked: only those spots on the map and in the list (tap it again for all).
  const [show, setShow] = useState<SpotStatus | null>(null)
  const [viewPick, setViewPick] = useState<ViewName | null>(null)
  const phone = useMediaQuery('(max-width: 639px)')
  const d = status === 'ready' ? diary : undefined
  const ready = Boolean(d?.enough_data)
  const first = Boolean(d && !d.enough_data)
  const tracks = useMemo(() => (ready && d ? d.tracks : []), [ready, d])
  const sess = d?.sessions ?? []
  const areas = useMemo(() => (d?.zones ?? []).filter((z) => z.appeared > 0).sort((a, b) => b.appeared - a.appeared || b.visible_now - a.visible_now), [d])
  const busiest = areas[0]
  const zSel = zone && tracks.some((t) => t.zone === zone) ? zone : null
  const ordered = useMemo(() => {
    const byRecent = [...tracks].sort((a, b) => b.last_seen_index - a.last_seen_index || b.first_seen_index - a.first_seen_index)
    const firsts = ORDER.map((p) => byRecent.find((t) => t.status === p)).filter((t): t is SpotTrack => Boolean(t))
    const list = [...firsts, ...byRecent.filter((t) => !firsts.includes(t))]
    return list.filter((t) => (!zSel || t.zone === zSel) && (!show || t.status === show))
  }, [tracks, zSel, show])
  // A selected row stays visible even past the first five.
  const rows = all || ordered.slice(0, 5).some((t) => t.id === selected) || !selected ? (all ? ordered : ordered.slice(0, 5)) : [...ordered.slice(0, 4), ...ordered.filter((t) => t.id === selected)]
  // Columns: the most recent photos that fit (4 on a phone, 6 wider).
  const cols = sess.slice(-(phone ? 4 : 6))
  const lastSess = sess[sess.length - 1]
  const doneToday = Boolean(lastSess && isToday(lastSess.created_at))
  // The api starts the diary at 3 usable photos over 2 or more days (enough_data); say what is still missing.
  const photoDays = new Set(sess.map((x) => new Date(x.created_at).toDateString())).size
  const startsWhen =
    photoDays < 2 && sess.length >= 2 ? 'Spot diary starts tomorrow' : photoDays >= 2 && sess.length < 3 ? 'Spot diary starts with your next photo' : 'Spot diary starts on day 3'

  const title = ready && d ? `Your spots over ${fmtDays(Math.max(1, d.days_covered))}` : first ? 'Your spot diary' : 'Your spots'
  const sub =
    ready && d && lastSess
      ? `${sess.length} photos, ${fmtDate(sess[0].created_at)} to ${fmtDate(lastSess.created_at)}. Names are AI-suggested.`
      : status === 'loading'
        ? 'Matching spots across your face photos…'
        : 'Follows each spot from one face photo to the next.'
  // The map shows the spots the list shows: the area and the status picked.
  // With cheek photos: Front face / Left cheek / Right cheek, each with the spots of the zones it shows (picking a
  // cheek area or a cheek spot turns to its photo).
  const views = useMemo(() => shownViews(photo?.result, photoViews), [photo, photoViews])
  const multi = views.length > 1
  const wanted = viewPick ?? (zSel ? viewOfZone(zSel) : null) ?? 'front'
  const rv = multi ? (views.find((v) => v.view === wanted) ?? views[0]) : null
  const active: ViewName = rv?.view ?? 'front'
  const placed = useMemo(() => {
    if (!photo) return null
    if (!rv) return placeOnPhoto(photo, true)
    const sv = photoViews.find((v) => v.view === rv.view)
    return sv ? placeOnPhoto(viewSession(photo, rv, sv.preview), false) : null
  }, [photo, rv, photoViews])
  const mapped = useMemo(() => {
    // a cheek with no photo of its own stays on the front photo
    const inView = (t: SpotTrack) => !multi || viewOfZone(t.zone) === active || (active === 'front' && !views.some((v) => v.view === viewOfZone(t.zone)))
    return tracks.filter((t) => (!zSel || t.zone === zSel) && (!show || t.status === show) && inView(t))
  }, [tracks, zSel, show, multi, active, views])
  const pick = (t: SpotTrack) => {
    if (multi && viewOfZone(t.zone) !== active && views.some((v) => v.view === viewOfZone(t.zone))) setViewPick(viewOfZone(t.zone))
    onPick(t)
  }
  const sum = (k: 'visible_now' | 'appeared' | 'faded' | 'came_back') => (d?.zones ?? []).reduce((a, z) => a + z[k], 0)
  const zs = zSel ? d?.zones.find((z) => z.zone === zSel) : null
  const top = Boolean(zSel && busiest && zSel === busiest.zone && busiest.appeared > 1)
  const notes = d ? [d.unconfirmed ? `${d.unconfirmed} ${d.unconfirmed === 1 ? 'spot seen once is' : 'spots seen once are'} hidden` : '', d.sessions_not_mapped ? `${d.sessions_not_mapped} earlier ${d.sessions_not_mapped === 1 ? 'photo is' : 'photos are'} not in the diary yet` : ''].filter(Boolean).join(' · ') : ''

  return (
    <section id="spot-diary" aria-labelledby="diary-h" className="flex scroll-mt-24 flex-col gap-4 pt-12">
      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-[18px]">
        <div className="flex max-w-[640px] min-w-0 flex-col gap-2.5">
          <span className="eyebrow text-[12px]">■ Spot diary</span>
          <h2 id="diary-h" className="m-0 font-serif text-[clamp(28px,3.51vw,47px)] leading-[.95] font-normal tracking-[-0.01em]">
            {title}
          </h2>
          <p className="m-0 text-[15px] leading-normal text-ink-2">{sub}</p>
          {ready && busiest && busiest.appeared > 1 ? (
            <p className="m-0 text-[18px] leading-[1.45]">
              {ZONE_NAME[busiest.zone]} gets the most new spots: {busiest.appeared} of the {tracks.length} followed.
            </p>
          ) : null}
        </div>
        {ready ? (
          <div role="group" aria-label="Show spots that are" className="flex flex-wrap gap-1 rounded-[24px] bg-white/55 p-1.5 backdrop-blur-[12px]">
            {ORDER.map((p) => {
              const n = tracks.filter((t) => t.status === p).length
              const on = show === p
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  disabled={!n}
                  onClick={() => {
                    setShow(on ? null : p)
                    setAll(false)
                  }}
                  className={`hit44 flex min-h-9 items-center gap-2 rounded-pill px-3 text-[13px] whitespace-nowrap transition-colors duration-200 disabled:opacity-45 ${on ? 'bg-selected text-inverse' : 'bg-surface hover:bg-muted'}`}
                >
                  <span className={`grid place-items-center rounded-full ${on ? 'bg-white p-[3px]' : ''}`}>
                    <Shape status={p} size={on ? 10 : 12} />
                  </span>
                  {STATUS_SHAPE[p].word}
                  <span className="font-dot text-[16px] font-extrabold">{n}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {status === 'loading' || status === 'idle' ? (
        <div aria-busy="true" aria-label="Loading spot diary" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-4">
          <Skeleton className="aspect-[1/1.1]" rounded="rounded-[44px]" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[150px]" rounded="rounded-[32px]" />
            <Skeleton className="h-[150px]" rounded="rounded-[32px]" />
            <Skeleton className="h-24" rounded="rounded-[32px]" />
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div role="alert" className="flex animate-[wRise_.4s_both] flex-wrap items-center justify-between gap-4 rounded-[32px] bg-surface py-5 pr-5 pl-[26px]">
          <span className="text-[16px]">The spot diary did not load.</span>
          <Button variant="ink" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}

      {first ? (
        <div
          className="relative grid animate-[wRise_.5s_both] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-center gap-7 overflow-hidden rounded-[44px] p-[clamp(24px,4vw,44px)] squircle"
          style={{
            background: 'radial-gradient(70% 80% at 90% 10%, #FFFFFF 0%, transparent 55%), radial-gradient(80% 90% at 10% 100%, var(--aura-sky) 0%, transparent 60%), radial-gradient(70% 70% at 80% 90%, var(--aura-ice) 0%, transparent 65%), #C9DEFF',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.6), inset 0 0 70px rgba(255,255,255,.45), 0 40px 80px -50px rgba(31,92,255,.5)',
            color: '#0A1840',
          }}
        >
          <div className="flex flex-col items-start gap-4">
            <h3 className="m-0 font-serif text-[clamp(25px,2.86vw,36px)] leading-[.95] font-normal">{startsWhen}</h3>
            <p className="m-0 max-w-[440px] text-[16px] leading-[1.55]">Take a face photo each day in the same place and light. From the third photo on a second day, Willow shows which spots are new, which are fading and which have gone.</p>
            {doneToday ? (
              <span className="flex min-h-[52px] items-center rounded-pill bg-white/60 px-6 text-[15px] text-ink-2">✓ Done for today</span>
            ) : onTake ? (
              <Button variant="primary" size="lg" onClick={onTake} trailing={<span aria-hidden>→</span>}>
                {sess.length ? 'Take today’s photo' : 'Take your first face photo'}
              </Button>
            ) : null}
          </div>
          <ol aria-label="Your first three photos" className="m-0 grid list-none grid-cols-3 gap-2.5 p-0">
            {[0, 1, 2].map((i) => {
              const se = sess[i]
              const k = i - sess.length
              const label = se ? fmtDate(se.created_at) : doneToday ? (k === 0 ? 'Tomorrow' : `Day ${i + 1}`) : k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : `Day ${i + 1}`
              return (
                <li key={i} className="flex animate-[wRise_.5s_both] flex-col gap-2" style={{ animationDelay: `${i * 80}ms` }}>
                  <span
                    className="grid aspect-[3/4] place-items-center rounded-[24px] font-dot text-[22px] font-extrabold"
                    style={se ? { background: 'radial-gradient(70% 60% at 50% 40%, #E9C8B4, #B98D76 70%)', color: '#2A1810' } : { background: 'rgba(255,255,255,.28)', border: '1.5px dashed rgba(10,24,64,.45)', color: 'rgba(10,24,64,.55)' }}
                  >
                    <span aria-hidden>D{i + 1}</span>
                    <span className="sr-only">{se ? `Photo ${i + 1}, taken` : `Photo ${i + 1}, not taken yet`}</span>
                  </span>
                  <span className="pl-1 text-[13px]">{label}</span>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}

      {ready && d ? (
        <div className="flex flex-wrap items-start gap-4">
          <div
            className="flex min-w-0 flex-[1_1_300px] animate-[wRise_.5s_both] flex-col gap-[18px] rounded-[36px] p-5 transition-[background,box-shadow] duration-500 squircle"
            style={{
              background: top
                ? 'radial-gradient(80% 90% at 88% 8%, #FFB27A 0%, transparent 60%), radial-gradient(90% 90% at 8% 100%, #F25FA8 0%, transparent 62%), #FF7A57'
                : zSel
                  ? 'radial-gradient(90% 100% at 90% 0%, #E6DAFF 0%, transparent 60%), var(--bg-surface)'
                  : 'radial-gradient(90% 100% at 90% 0%, #FFD9C7 0%, transparent 60%), radial-gradient(80% 90% at 0% 100%, #E6DAFF 0%, transparent 60%), var(--bg-surface)',
              boxShadow: top ? 'inset 0 1px 0 rgba(255,255,255,.5), inset 0 0 50px rgba(255,255,255,.25), 0 30px 60px -36px rgba(255,90,60,.6)' : '0 30px 70px -50px rgba(0,0,0,.35)',
            }}
          >
            <div role="tablist" aria-label="Face area" className="flex flex-wrap gap-[3px] rounded-[22px] bg-white/45 p-1 backdrop-blur-[12px]">
              {[{ k: null as SpotZone | null, label: 'All', n: tracks.length }, ...areas.map((z) => ({ k: z.zone, label: ZONE_NAME[z.zone], n: z.appeared }))].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  aria-selected={zSel === t.k}
                  onClick={() => {
                    setZone(t.k)
                    setAll(false)
                    setViewPick(null)
                  }}
                  className={`flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-[13px] transition-[background,box-shadow] ${zSel === t.k ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,.08)]' : ''}`}
                >
                  {t.label}
                  <span className="font-dot text-[13px] font-extrabold opacity-75">{t.n}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              {placed ? <PhotoMap place={placed} tracks={mapped} selected={selected} onPick={pick} /> : <FaceMap diary={d} tracks={mapped} zone={zSel} selected={selected} onPick={pick} onZone={(z) => setZone(z)} />}
              {multi ? (
                <div className="absolute top-2.5 left-1/2 z-[2] w-max max-w-[calc(100%-16px)] -translate-x-1/2">
                  <SegmentedControl
                    glass
                    label="Which photo"
                    options={views.map((v) => ({ value: v.view, label: VIEW_LABEL[v.view] }))}
                    value={active}
                    onChange={(v) => {
                      setViewPick(v)
                      if (zSel && viewOfZone(zSel) !== v) setZone(null)
                    }}
                  />
                </div>
              ) : null}
            </div>
            {placed ? <span className="-mt-2 px-1 font-mono text-[11px] tracking-[.06em] text-ink-2">ON YOUR PHOTO · {fmtDate(placed.session.created_at).toUpperCase()}</span> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-1">
              <span className="text-[20px] tracking-[-0.01em]">{zSel ? ZONE_NAME[zSel] : 'Whole face'}</span>
              {top ? <span className="font-mono text-[11px] tracking-[.08em]">■ MOST NEW SPOTS</span> : null}
            </div>
            <div className="grid grid-cols-4 gap-2 px-1">
              {(
                [
                  [zs ? zs.visible_now : sum('visible_now'), 'visible now'],
                  [zs ? zs.appeared : sum('appeared'), 'appeared'],
                  [zs ? zs.faded : sum('faded'), 'faded'],
                  [zs ? zs.came_back : sum('came_back'), 'came back'],
                ] as const
              ).map(([v, k], i) => (
                <span key={k} className="flex min-w-0 animate-[wRise_.4s_both] flex-col gap-1.5" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="font-dot text-[28px] leading-none font-extrabold">{String(v).padStart(2, '0')}</span>
                  <span className={`text-[12px] leading-[1.3] ${top ? '' : 'text-ink-2'}`}>{k}</span>
                </span>
              ))}
            </div>
            <span className="px-1 text-[13px] leading-[1.45]">
              {zSel
                ? zs?.typical_days_visible
                  ? `Spots here usually stay visible ${fmtDays(zs.typical_days_visible.at_least) === fmtDays(zs.typical_days_visible.at_most) ? `about ${fmtDays(zs.typical_days_visible.at_most)}` : `between ${fmtDays(zs.typical_days_visible.at_least)} and ${fmtDays(zs.typical_days_visible.at_most)}`} (from ${zs.typical_days_visible.from} that faded).`
                  : 'How long spots last here shows after 3 have faded.'
                : 'Pick an area to see its spots and how long they usually last.'}
            </span>
          </div>

          <div className="flex min-w-0 flex-[2_1_460px] animate-[wRise_.5s_.08s_both] flex-col gap-0.5 rounded-[36px] bg-surface p-2.5 shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
            {!tracks.length ? (
              <p className="m-0 p-[18px] text-[15px] leading-normal">No spots followed so far. Spots seen only once are left out.</p>
            ) : !ordered.length ? (
              <p className="m-0 p-[18px] text-[15px] leading-normal">No {show ? `${STATUS_SHAPE[show].word.toLowerCase()} ` : ''}spots{zSel ? ` on the ${ZONE_NAME[zSel].toLowerCase()}` : ''}.</p>
            ) : (
              <>
                <div aria-hidden className="flex items-end gap-2.5 px-2.5 pt-2 pb-1.5">
                  <span className="min-w-0 flex-1 font-mono text-[10px] tracking-[.08em] text-ink-2">TAP A SPOT TO SEE IT ON THE PHOTO</span>
                  <span className="flex shrink-0 gap-1">
                    {cols.map((c) => (
                      <span key={c.id} className={`w-9 text-center font-mono text-[9.5px] leading-[1.3] tracking-[.02em] ${c.id === stageSessionId ? 'text-ink' : 'text-ink-2'}`}>
                        {fmtDate(c.created_at).toUpperCase()}
                      </span>
                    ))}
                  </span>
                </div>
                {rows.map((t, i) => {
                  const on = t.id === selected
                  const o0 = t.observations[t.observations.length - 1]
                  const col = STAGE_COLOUR[o0.stage] ?? ['#9A978F', '#DDD']
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onPick(t)}
                      aria-pressed={on}
                      className={`flex w-full animate-[wRise_.4s_both] items-center gap-2.5 rounded-[18px] px-2.5 py-2 text-left transition-[background,box-shadow] duration-300 hover:bg-sunken ${on ? 'bg-[#EFE9F8] shadow-[inset_0_0_0_1.5px_var(--text-primary)]' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                    >
                      <Shape status={t.status} />
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="text-[15px] whitespace-nowrap">{t.zone ? ZONE_NAME[t.zone] : 'On the face'}</span>
                          <span className="truncate font-mono text-[10px] tracking-[.05em] text-ink-2">
                            {stageName(o0).toUpperCase()}
                            {o0.label ? ' · AI-SUGGESTED' : ''}
                          </span>
                        </span>
                        <span className="text-[13px] leading-[1.35] text-ink-2">
                          {statusText(t, d)}
                          {t.came_back ? <span title="Came back where an earlier spot faded"> · ↺ came back</span> : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {cols.map((se) => {
                          const o = t.observations.find((q) => q.session_id === se.id)
                          const cur = on && se.id === stageSessionId
                          return (
                            <span
                              key={se.id}
                              title={`${fmtDate(se.created_at)}: ${o ? 'seen' : 'not seen'}`}
                              className="box-border size-9 rounded-[12px] transition-shadow duration-300"
                              style={{
                                border: o ? 0 : '1.5px dashed rgba(18,18,18,.3)',
                                background: o?.crop_url ? `center/cover no-repeat url("${o.crop_url}")` : o ? `radial-gradient(circle at 50% 46%, ${col[0]} 0 20%, ${col[1]} 62%)` : 'transparent',
                                boxShadow: cur ? '0 0 0 2px var(--bg-surface), 0 0 0 3.5px var(--text-primary)' : 'none',
                              }}
                            />
                          )
                        })}
                      </span>
                    </button>
                  )
                })}
                <div className="flex flex-wrap items-center justify-between gap-2.5 px-2.5 pt-2 pb-1">
                  <span className="text-[12px] text-ink-2">{notes}</span>
                  {ordered.length > 5 ? (
                    <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="min-h-11 rounded-pill bg-sunken px-4 text-[13px] hover:bg-muted">
                      {all ? 'Show fewer' : `Show all ${ordered.length}`}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The canonical face (data/faceMap.ts, the engine's geometry): zones tinted by how many marks appeared
 * there, one dot per followed mark in its status shape. The face is drawn as seen in a selfie (the
 * subject's right on the left), matching the photo above.
 */
function FaceMap({ diary, tracks, zone, selected, onPick, onZone }: { diary: Diary; tracks: SpotTrack[]; zone: SpotZone | null; selected: string | null; onPick: (t: SpotTrack) => void; onZone: (z: SpotZone | null) => void }) {
  const b = FACE_MAP.bounds
  const pad = 6
  const vb = `${b.min_x - pad} ${-b.max_y - pad} ${b.max_x - b.min_x + 2 * pad} ${b.max_y - b.min_y + 2 * pad}`
  const pts = (list: [number, number][]) => list.map(([x, y]) => `${x},${-y}`).join(' ')
  const maxApp = Math.max(1, ...diary.zones.map((z) => z.appeared))
  return (
    <svg viewBox={vb} className="mx-auto block h-auto w-full max-w-[260px]" role="group" aria-label="Face map of followed spots">
      <polygon points={pts(FACE_MAP.outline)} fill="rgba(255,255,255,.55)" stroke="rgba(18,18,18,.25)" strokeWidth={1} />
      {Object.entries(FACE_MAP.zones).map(([k, polys]) => {
        const z = diary.zones.find((q) => q.zone === k)
        const op = z && z.appeared ? 0.15 + (0.45 * z.appeared) / maxApp : 0
        return polys.map((poly, i) => (
          <polygon
            key={`${k}${i}`}
            points={pts(poly)}
            fill="var(--aura-coral)"
            fillOpacity={op}
            stroke={zone === k ? 'var(--text-primary)' : 'none'}
            strokeWidth={1.2}
            onClick={() => z?.appeared && onZone(zone === k ? null : (k as SpotZone))}
            className={z?.appeared ? 'cursor-pointer' : undefined}
          />
        ))
      })}
      {Object.values(FACE_MAP.features).map((f, i) =>
        f.closed ? <polygon key={i} points={pts(f.points)} fill="none" stroke="rgba(18,18,18,.35)" strokeWidth={0.8} /> : <polyline key={i} points={pts(f.points)} fill="none" stroke="rgba(18,18,18,.35)" strokeWidth={0.8} />,
      )}
      {tracks.map((t, i) => {
        const on = t.id === selected
        const s = STATUS_SHAPE[t.status]
        const r = on ? 6 : t.status === 'gone' ? 3.5 : 4.5
        const dashed = t.status === 'not_seen_last_time'
        const fill = t.status === 'gone' ? 'none' : t.status === 'not_seen_last_time' ? 'rgba(250,250,248,.8)' : 'var(--text-primary)'
        return (
          <g
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`${t.zone ? ZONE_NAME[t.zone] : 'Spot'}, ${s.word}`}
            aria-pressed={on}
            onClick={() => onPick(t)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(t)
              }
            }}
            className="cursor-pointer animate-[wDotIn_.45s_cubic-bezier(.2,.8,.2,1)_both]"
            style={{ animationDelay: `${200 + i * 55}ms`, transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            {/* a larger invisible target */}
            <circle cx={t.x_mm} cy={-t.y_mm} r={9} fill="transparent" stroke="transparent" strokeWidth={2} />
            {on ? <circle cx={t.x_mm} cy={-t.y_mm} r={r + 3} fill="#fff" stroke="var(--text-primary)" strokeWidth={1.2} /> : null}
            {t.status === 'new' ? <circle cx={t.x_mm} cy={-t.y_mm} r={r + 1.6} fill="none" stroke="var(--text-primary)" strokeWidth={0.8} /> : null}
            <circle cx={t.x_mm} cy={-t.y_mm} r={r} fill={fill} stroke="var(--text-primary)" strokeWidth={t.status === 'gone' ? 0.8 : 1.2} strokeDasharray={dashed ? '1.6 1.2' : undefined} />
            {t.status === 'fading' ? <path d={`M${t.x_mm},${-t.y_mm - r} A${r},${r} 0 0 1 ${t.x_mm},${-t.y_mm + r} Z`} fill="var(--bg-surface)" /> : null}
          </g>
        )
      })}
    </svg>
  )
}

type Placed = { session: Session; t: Affine; box: { x: number; y: number; w: number; h: number }; size: { width: number; height: number } }

const extent = (poly: Pt[]) => ({ x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), y1: Math.max(...poly.map((p) => p[1])) })

/** Area centroid of a polygon (shoelace). */
function centroid(poly: Pt[]): Pt | null {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    const k = x0 * y1 - x1 * y0
    a += k
    cx += (x0 + x1) * k
    cy += (y0 + y1) * k
  }
  return Math.abs(a) < 1e-6 ? null : [cx / (3 * a), cy / (3 * a)]
}

/**
 * The latest photo placed on the canonical face: an affine fit from its front-photo marks (face-map mm -> photo px),
 * with the face-map zones' centres when the photo has whole-face areas, so a face with marks on one cheek only
 * still lands. Null when it cannot be placed well (too few points, or they disagree by more than a few mm).
 * `frontOnly`: the session's own front photo, so its cheek photos' marks (in their own pixels) are left out.
 */
function placeOnPhoto(s: Session, frontOnly: boolean): Placed | null {
  const r = s.result
  if (!r || !s.preview) return null
  const candidates = frontOnly ? r.candidates.filter((c) => candidateView(c) === 'front') : r.candidates
  const pairs: { mm: Pt; px: Pt }[] = []
  for (const c of candidates) {
    const f = c.features ?? {}
    if (f.face_x_mm === undefined || f.face_y_mm === undefined) continue
    pairs.push({ mm: [f.face_x_mm, f.face_y_mm], px: [c.bbox[0] + c.bbox[2] / 2, c.bbox[1] + c.bbox[3] / 2] })
  }
  for (const roi of r.rois ?? []) {
    const zone = FACE_MAP.zones[roi.name]
    if (!zone?.[0] || roi.polygon.length < 3) continue
    const mm = centroid(zone[0])
    const px = centroid(roi.polygon)
    if (mm && px) pairs.push({ mm, px })
    // and its extent: the front's own areas run down the middle of the face, so their centres alone cannot
    // tell how wide the face is (the subject's right, x < 0, is on the photo's left; y is up in mm, down in px)
    const [a, b] = [extent(zone[0]), extent(roi.polygon)]
    pairs.push(
      { mm: [a.x0, a.y1], px: [b.x0, b.y0] },
      { mm: [a.x1, a.y1], px: [b.x1, b.y0] },
      { mm: [a.x0, a.y0], px: [b.x0, b.y1] },
      { mm: [a.x1, a.y0], px: [b.x1, b.y1] },
    )
  }
  const t = fitAffine(pairs)
  if (!t) return null
  const scale = scaleOf(t)
  const rms = Math.sqrt(pairs.reduce((acc, p) => acc + (apply(t, p.mm)[0] - p.px[0]) ** 2 + (apply(t, p.mm)[1] - p.px[1]) ** 2, 0) / pairs.length) / scale
  // mm: a flat map of a curved face is off by about a centimetre at the hairline and on a turned cheek; more
  // means the fit is wrong. Spots seen on the photo itself are drawn on their own marks, not with the fit.
  if (rms > 15) return null
  const size = r.image_size ?? { width: s.preview.width, height: s.preview.height }
  // Frame: the face outline in the photo with a little room, 4:5, inside the photo.
  const out = FACE_MAP.outline.map((p) => apply(t, p))
  const xs = out.map((p) => p[0])
  const ys = out.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  let w = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 0.8) * 1.12
  w = Math.min(w, size.width, size.height * 0.8)
  const h = w / 0.8
  const x = Math.min(Math.max(cx - w / 2, 0), size.width - w)
  const y = Math.min(Math.max(cy - h / 2, 0), size.height - h)
  return { session: frontOnly ? { ...s, result: { ...r, candidates } } : s, t, box: { x, y, w, h }, size }
}

/**
 * The followed spots on the latest face photo, each where it sits on the face (placed by placeOnPhoto, so a spot
 * that has faded shows where it was). Same shapes as the drawn face, with a white edge to read on any skin.
 */
function PhotoMap({ place, tracks, selected, onPick }: { place: Placed; tracks: SpotTrack[]; selected: string | null; onPick: (t: SpotTrack) => void }) {
  const { box, size, t } = place
  const url = place.session.preview!.url
  const status = useImageStatus(url)
  const k = scaleOf(t) // px per mm
  // the marks found on this very photo (a cheek photo carries only its own)
  const here = useMemo(() => new Set((place.session.result?.candidates ?? []).map((c) => c.id)), [place.session])
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-[320px] overflow-hidden rounded-[28px] squircle" style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" role="group" aria-label={`Followed spots on your photo from ${fmtDate(place.session.created_at)}`}>
        <image href={url} width={size.width} height={size.height} preserveAspectRatio="xMidYMid slice" className="transition-opacity duration-200" style={{ opacity: status === 'ready' ? 1 : 0 }} />
        {tracks.map((tr, i) => {
          // seen on this photo: its own box; else (faded, missed) where the fit puts its place on the face
          const o = tr.observations.find((q) => q.session_id === place.session.id)
          const [x, y]: Pt = o?.bbox && here.has(o.candidate_id) ? [o.bbox[0] + o.bbox[2] / 2, o.bbox[1] + o.bbox[3] / 2] : apply(t, [tr.x_mm, tr.y_mm])
          const on = tr.id === selected
          const r = (on ? 4.2 : tr.status === 'gone' ? 2.4 : 3) * k
          const gone = tr.status === 'gone'
          const dashed = tr.status === 'not_seen_last_time'
          const fill = gone ? 'none' : dashed ? 'rgba(255,255,255,.35)' : 'var(--text-primary)'
          const s = STATUS_SHAPE[tr.status]
          return (
            <g
              key={tr.id}
              role="button"
              tabIndex={0}
              aria-label={`${tr.zone ? ZONE_NAME[tr.zone] : 'Spot'}, ${s.word}`}
              aria-pressed={on}
              onClick={() => onPick(tr)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(tr)
                }
              }}
              className="cursor-pointer animate-[wDotIn_.45s_cubic-bezier(.2,.8,.2,1)_both] outline-none"
              style={{ animationDelay: `${150 + Math.min(i, 30) * 30}ms`, transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <circle cx={x} cy={y} r={Math.max(r * 2, 6 * k)} fill="transparent" />
              {on ? <circle cx={x} cy={y} r={r + 2.2 * k} fill="rgba(255,255,255,.9)" stroke="var(--text-primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
              {tr.status === 'new' ? <circle cx={x} cy={y} r={r + 1.3 * k} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
              {/* dark edge under the light one: visible on any skin tone */}
              <circle cx={x} cy={y} r={r} fill="none" stroke="rgba(18,18,18,.55)" strokeWidth={3.5} vectorEffect="non-scaling-stroke" />
              <circle cx={x} cy={y} r={r} fill={fill} stroke="#fff" strokeWidth={1.5} strokeDasharray={dashed ? '3 2.5' : undefined} vectorEffect="non-scaling-stroke" />
              {tr.status === 'fading' ? <path d={`M${x},${y - r} A${r},${r} 0 0 1 ${x},${y + r} Z`} fill="#fff" /> : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
