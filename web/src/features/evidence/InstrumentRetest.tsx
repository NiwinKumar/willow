import type { MetricId } from '../../data/types'
import { METRIC_META } from '../../lib/metrics'
import { dayOf, evidence, REPO_BLOB } from './data'
import { Ext, Section, tile } from './parts'

type Cell = { pairs: number; false_change: number; false_change_pct: number | null; median_delta_over_band: number | null; median_band: number | null; no_verdict: number }
type Group = { photos: number; people: number; mst?: [number, number] | null; with_baseline: number; checkins: number; metrics: Record<string, Cell> }
type Rate = { pairs: number; before: number; after: number; before_pct: number | null; after_pct: number | null }
/** The fix checked on people it never saw: floors learned on half the people, rates on the other half. */
type FloorCheck = {
  seed: number
  learn_people: number
  check_people: number
  check_photos: number
  check_checkins: number
  floors: Record<string, number>
  median_band_before: Record<string, number | null>
  metrics: Record<string, Rate>
  by_mst: Record<string, Record<string, Rate>>
  all: { pairs: number; before: number; after: number }
}
/** The `instrument_retest` key of evidence.json, written by engine/scripts/instrument_retest.py (docs/EVIDENCE.md). */
export type InstrumentRetestData = {
  run_at: string
  engine_version: string
  source: string
  licence: string
  source_photos_checked: number
  source_photos_refused: number
  source_refused_by_reason: Record<string, number>
  people_checked: number
  per_person: number
  photos: number
  people: number
  photos_with_baseline: number
  baselines_failed: number
  retakes: number
  retakes_rejected: number
  rejected_by_reason: Record<string, number>
  checkins: number
  checkins_refused: number
  checkins_with_any_false_change: number
  pairs: number
  false_change: number
  false_change_pct: number | null
  baseline_photos: number
  checkin_photos: number
  tests_per_baseline: number
  metrics: Record<string, Cell>
  by_band: Record<string, Group>
  by_mst: Record<string, Group>
  floor_check?: FloorCheck
  retake_ranges: { room: { exposure_ev: [number, number]; wb_gain: [number, number] } }
}

const data = (evidence as { instrument_retest?: InstrumentRetestData }).instrument_retest

/** The engine's ITA groups (engine/app/config.py ITA_BANDS), lightest first. Descriptive only, never a ranking. */
const BANDS: [string, string][] = [
  ['very_light', 'Very light · ITA over 55°'],
  ['light', 'Light · 41° to 55°'],
  ['intermediate', 'Intermediate · 28° to 41°'],
  ['tan', 'Tan · 10° to 28°'],
  ['brown', 'Brown · −30° to 10°'],
  ['dark', 'Dark · under −30°'],
]
/** Groups by the dataset's expert Monk label: the person's own tone, whatever the light did to the photo. */
const MST: [string, string][] = [
  ['mst_1_3', 'Monk 1 to 3'],
  ['mst_4_7', 'Monk 4 to 7'],
  ['mst_8_10', 'Monk 8 to 10'],
]
/** Reasons the quality checks gave, in the words the check-in uses. */
const REASON: Record<string, string> = {
  pose_out_of_range: 'head turned or tilted too far',
  overexposed: 'too bright',
  underexposed: 'too dark',
  blurry: 'blurry',
  face_not_found: 'no face found',
  occlusion_suspected: 'something covering the face',
  failed: 'could not be measured',
}

const readingName = (id: string) => METRIC_META[id as MetricId]?.label ?? id.replace(/_/g, ' ')
const pctText = (c?: Cell) => (c && c.pairs ? `${c.false_change_pct}%` : '–')
const order = (m: Record<string, Cell>) => Object.keys(m).sort((a, b) => (m[b].false_change_pct ?? -1) - (m[a].false_change_pct ?? -1))

/** Share of readings called a change, one row per group and one column per reading (scrolls sideways on a phone). */
function GroupTable({ caption, rows, metrics }: { caption: string; rows: { key: string; label: string; sub?: string; g: Group }[]; metrics: string[] }) {
  return (
    <div className="overflow-x-auto rounded-[18px] bg-white/70" tabIndex={0} role="group" aria-label={caption}>
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <caption className="px-3.5 pt-3 text-left text-[15px]">{caption}</caption>
        <thead>
          <tr className="text-[12px] text-ink-2">
            <th scope="col" className="px-3.5 py-1.5 font-normal">
              Group
            </th>
            <th scope="col" className="px-2 py-1.5 font-normal">
              Photos
            </th>
            {metrics.map((id) => (
              <th key={id} scope="col" className="px-2 py-1.5 font-normal">
                {readingName(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, sub, g }) => (
            <tr key={key} className="border-t border-ink/[.07]">
              <th scope="row" className="px-3.5 py-1.5 font-normal">
                {label}
                {sub ? <span className="block text-[12px] text-ink-2">{sub}</span> : null}
              </th>
              <td className="px-2 py-1.5 tnum">
                {g.photos} <span className="text-ink-2">({g.people} people, {g.checkins} check-ins)</span>
              </td>
              {metrics.map((id) => (
                <td key={id} className="px-2 py-1.5 tnum">
                  {pctText(g.metrics[id])}
                  {g.metrics[id]?.pairs ? <span className="block text-[11.5px] text-ink-2">of {g.metrics[id].pairs}</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const names = (ids: string[]) => ids.map(readingName).join(', ')

/** The room-light retake range: the largest exposure change in stops, the largest red/blue change as a share. */
const stops = (ev: [number, number]) => Math.max(...ev.map(Math.abs))
const share = (g: [number, number]) => `${Math.round(Math.max(...g.map(Math.abs)) * 100)}%`

/** Each floored reading's unit, as the app writes it. */
const UNIT: Record<string, string> = { tone_ita: '°', redness: ' a*', glow: ' (index)', shine: '% of the T-zone', tone_evenness: ' (index)', dark_circles: ' L*' }
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–')
const sum = (r: Record<string, Rate>, k: 'pairs' | 'before' | 'after') => Object.values(r).reduce((s, x) => s + x[k], 0)

/** "Before and after the fix": the floors (engine config.ROOM_LIGHT_FLOOR), checked on held-out people, with their cost. */
function FloorFix({ f, order, room }: { f: FloorCheck; order: string[]; room: InstrumentRetestData['retake_ranges']['room'] }) {
  const floored = order.filter((id) => f.floors[id] !== undefined)
  const toneFloor = f.floors.tone_ita
  return (
    <div className="flex flex-col gap-3 rounded-[22px] bg-white/80 px-3.5 py-3.5">
      <h3 className="m-0 text-[17px] font-normal">The fix, checked on people it never saw</h3>
      <p className="m-0 max-w-[640px] text-[14px] leading-[1.5] text-[#2A2926]">
        Colour and light readings now have a second, wider edge to their normal range: how far a new room’s light alone moves them. It was learned from {f.learn_people} of the people and checked on the other {f.check_people} ({f.check_checkins} check-ins), so no one is both teacher and test. False alarms on those people: <span className="tnum">{pct(f.all.before, f.all.pairs)}</span> before the fix, <span className="tnum">{pct(f.all.after, f.all.pairs)}</span> after ({f.all.before} and {f.all.after} of {f.all.pairs} readings).
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="False alarms before and after the fix, and what it costs">
        <table className="w-full min-w-[600px] border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-ink-2">
              <th scope="col" className="py-1.5 pr-2 font-normal">
                Reading
              </th>
              <th scope="col" className="px-2 py-1.5 font-normal">
                Before
              </th>
              <th scope="col" className="px-2 py-1.5 font-normal">
                After
              </th>
              <th scope="col" className="py-1.5 pl-2 font-normal">
                Smallest change it can now call
              </th>
            </tr>
          </thead>
          <tbody>
            {order.map((id) => {
              const r = f.metrics[id]
              const floor = f.floors[id]
              const old = f.median_band_before[id]
              return (
                <tr key={id} className="border-t border-ink/[.07]">
                  <th scope="row" className="py-1.5 pr-2 font-normal">
                    {readingName(id)}
                  </th>
                  <td className="px-2 py-1.5 tnum">
                    {r.before} of {r.pairs} · {pct(r.before, r.pairs)}
                  </td>
                  <td className="px-2 py-1.5 tnum">
                    {r.after} of {r.pairs} · {pct(r.after, r.pairs)}
                  </td>
                  <td className="py-1.5 pl-2 tnum">
                    {floor !== undefined ? `${floor}${UNIT[id] ?? ''}${old ? ` · ${(floor / old).toFixed(1)}× the usual band before` : ''}` : <span className="text-ink-2">unchanged, no floor</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col p-0 text-[13.5px]">
        {MST.filter(([g]) => f.by_mst[g]).map(([g, label]) => (
          <li key={g} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-ink/[.07] py-1.5">
            <span>{label}</span>
            <span className="text-ink-2 tnum">
              {pct(sum(f.by_mst[g], 'before'), sum(f.by_mst[g], 'pairs'))} before, {pct(sum(f.by_mst[g], 'after'), sum(f.by_mst[g], 'pairs'))} after · {sum(f.by_mst[g], 'pairs')} readings
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        What it gives up: a real change smaller than the floor is no longer called, however steady someone’s photos are. {names(floored)} now need a bigger move to count, which is why the check-in asks for the same light every time. Blemishes, dark spots and lines keep their own band.
      </p>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        The floor was learned and checked on the same simulated room-light changes (exposure up to {stops(room.exposure_ev)} of a stop, colour up to {share(room.wb_gain)}), so “people it never saw” holds for people, not for new kinds of light.
        {toneFloor !== undefined ? ` Skin tone’s floor is about ${Math.round(toneFloor)}° of ITA, so a change in tone is in effect never called; in Willow a tone is a description, not a goal.` : ''}
      </p>
    </div>
  )
}

/**
 * "Same photo, retaken": an instrument test, not a people test. Real face photos (MST-E, every Monk tone) are retaken
 * in simulation (another room's light, framing, blur, noise, a new JPEG), a 5-photo baseline is built as the app does,
 * and further 3-photo check-ins are judged against it by the real engine. Nothing changed, so every "changed beyond
 * your normal range" is a false alarm; refusals by the quality checks are counted too. Left out when evidence.json
 * has no `instrument_retest` key.
 */
export function InstrumentRetest() {
  if (!data) return null
  const metrics = order(data.metrics)
  const bands = BANDS.filter(([b]) => data.by_band[b]).map(([b, label]) => {
    const g = data.by_band[b]
    return { key: b, label, sub: g.mst ? `Monk ${g.mst[0] === g.mst[1] ? g.mst[0] : `${g.mst[0]} to ${g.mst[1]}`}` : undefined, g }
  })
  const veryLight = data.by_band.very_light
  const monk = MST.filter(([k]) => data.by_mst?.[k]).map(([k, label]) => ({ key: k, label, g: data.by_mst[k] }))
  // which readings broke their band often after a change of room, and which held near the 5% it is built for
  const often = metrics.filter((id) => (data.metrics[id].false_change_pct ?? 0) > 15)
  const held = metrics.filter((id) => data.metrics[id].pairs && (data.metrics[id].false_change_pct ?? 100) <= 12)
  const room = data.retake_ranges.room
  const reasons = Object.entries(data.rejected_by_reason)
  const why = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, n]) => `${REASON[k] ?? k.replace(/_/g, ' ')} ${n}`)
      .join(', ')
  return (
    <Section
      id="retakes"
      title="Same photo, retaken: how often Willow cries wolf"
      lead={`This tests the instrument, not people over weeks: ${data.photos} real photos of ${data.people} consenting adults across all ten Monk skin tones, each retaken in simulation. Nothing about the skin changed between retakes, so every “changed beyond your normal range” below is a false alarm.`}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`flex flex-col gap-1 ${tile}`}>
          <span className="text-[13px] text-ink-2">False alarms, before the fix</span>
          <span className="text-[30px] leading-none tracking-[-0.02em] tnum">
            {data.false_change_pct ?? '–'}%
          </span>
          <span className="text-[13px] leading-[1.45] text-ink-2 tnum">
            {data.false_change} of {data.pairs} readings called a change. The band is built to allow about 5%.
          </span>
        </div>
        <div className={`flex flex-col gap-1 ${tile}`}>
          <span className="text-[13px] text-ink-2">Check-ins with one or more</span>
          <span className="text-[30px] leading-none tracking-[-0.02em] tnum">
            {data.checkins_with_any_false_change} <span className="text-[.5em] tracking-normal">of {data.checkins}</span>
          </span>
          <span className="text-[13px] leading-[1.45] text-ink-2">{metrics.length} readings each, so one false alarm somewhere is likelier than in any one reading.</span>
        </div>
        <div className={`flex flex-col gap-1 ${tile}`}>
          <span className="text-[13px] text-ink-2">Retakes refused</span>
          <span className="text-[30px] leading-none tracking-[-0.02em] tnum">
            {data.retakes_rejected} <span className="text-[.5em] tracking-normal">of {data.retakes}</span>
          </span>
          <span className="text-[13px] leading-[1.45] text-ink-2">
            By the quality checks{reasons.length ? `: ${why(data.rejected_by_reason)}` : ''}. {data.baselines_failed ? `${data.baselines_failed} photos never got a baseline (fewer than three usable retakes).` : ''}
          </span>
        </div>
      </div>

      {often.length ? (
        <p className="m-0 max-w-[640px] text-[14.5px] leading-[1.5] text-[#2A2926]">
          What it found (engine {data.engine_version}, before the fix): {names(often)} broke their band most often. Their band comes from five photos in one room’s light, and a new room’s light moves them further than that. {held.length ? `${names(held)} stayed near the 5% the band is built for.` : ''} So a reading of colour is only comparable in the same light as the baseline, which the check-in asks for; this test shows what happens when it is not.
        </p>
      ) : null}

      {data.floor_check ? <FloorFix f={data.floor_check} order={order(data.metrics)} room={room} /> : null}

      <div className="overflow-x-auto rounded-[18px] bg-white/70" tabIndex={0} role="group" aria-label="False alarms by reading">
        <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
          <caption className="px-3.5 pt-3 text-left text-[15px]">Before the fix, all photos: by reading</caption>
          <thead>
            <tr className="text-[12px] text-ink-2">
              <th scope="col" className="px-3.5 py-1.5 font-normal">
                Reading
              </th>
              <th scope="col" className="px-2 py-1.5 font-normal">
                Called a change
              </th>
              <th scope="col" className="px-2 py-1.5 font-normal">
                Moved, as a share of the band
              </th>
              <th scope="col" className="px-3.5 py-1.5 font-normal">
                No verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((id) => {
              const c = data.metrics[id]
              return (
                <tr key={id} className="border-t border-ink/[.07]">
                  <th scope="row" className="px-3.5 py-1.5 font-normal">
                    {readingName(id)}
                  </th>
                  <td className="px-2 py-1.5 tnum">
                    {c.false_change} of {c.pairs} · {pctText(c)}
                  </td>
                  <td className="px-2 py-1.5 tnum">{c.median_delta_over_band !== null ? `${Math.round(c.median_delta_over_band * 100)}% (median)` : '–'}</td>
                  <td className="px-3.5 py-1.5 tnum">{c.no_verdict}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {monk.length ? <GroupTable caption="Before the fix, by Monk skin tone (the dataset’s expert label), share called a change" rows={monk} metrics={metrics} /> : null}
      <GroupTable caption="Before the fix, by the engine’s own ITA group of each baseline photo, share called a change" rows={bands} metrics={metrics} />
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        The two groupings differ: ITA is read from each photo and moves with its light, so one person’s photos in different light land in different ITA groups{veryLight?.mst ? `, and the “Very light” row holds people from Monk ${veryLight.mst[0]} to ${veryLight.mst[1]}` : ''}. The Monk label belongs to the person, whatever the light did, which is why it is the fairness view.
      </p>

      <div className={`flex flex-col gap-1.5 ${tile}`}>
        <h3 className="m-0 text-[15px] font-normal">How it was run, and what it does not show</h3>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-[1.45] text-ink-2">
          <li>
            Only photos the app would accept as taken were retaken: of {data.source_photos_checked} photos of {data.people_checked} people, the quality checks refused {data.source_photos_refused} as they were ({why(data.source_refused_by_reason)}). Up to {data.per_person} accepted photos per person were used.
          </li>
          <li>
            Each photo was retaken as in the app: a baseline of {data.baseline_photos} photos, then {data.tests_per_baseline} later check-ins of {data.checkin_photos} photos, each check-in in a new room’s light (exposure up to {stops(room.exposure_ev)} of a stop, red and blue up to {share(room.wb_gain)}) with its own framing, tilt, blur, noise and JPEG per photo. The real engine measured every retake on a laptop ({data.engine_version}).
          </li>
          <li>Real people over weeks add what this cannot: sleep, sun, a new product, a different phone. That test needs volunteers and is not done.</li>
          <li>Small groups give rough rates: a group with few check-ins can swing by tens of percent on one alarm.</li>
          <li>
            Photos: {data.source}. {data.licence}
          </li>
        </ul>
      </div>
      <span className="text-[12.5px]">
        Run on {dayOf(data.run_at)}. <Ext href={`${REPO_BLOB}engine/scripts/instrument_retest.py`}>The script</Ext> · <Ext href={`${REPO_BLOB}docs/EVIDENCE.md`}>How to run it again</Ext>
      </span>
    </Section>
  )
}
