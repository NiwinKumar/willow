import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ForearmChart } from '../../components/charts'
import { useShell } from '../../components/shell/ShellContext'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { VerdictGlyph } from '../../components/willow/Verdict'
import { WillowLoader } from '../../components/willow/WillowLoader'
import { matchControl } from '../../data/live'
import type { CaptureMode, Metric, Session } from '../../data/types'
import { useData } from '../../data/useData'
import { fmtDate, fmtHours, parseDate, plural } from '../../lib/format'
import { fmtSigned, fmtValue } from '../../lib/metrics'
import { VERDICT_WORDS, verdictKind, type VerdictKind } from '../../lib/verdict'
import { PlanDotMark } from '../home/Tiles'
import { MAX_TEST_DAYS, MIN_TEST_DAYS, VERDICT_AFTER_DAYS, planDots, testDay, useProductTestWrites, useProductTests } from '../routine/productTests'
import { StartTest } from '../routine/StartTest'
import { baselineFor, dayOf, metricOf, sessionState } from './model'
import { Crumb, Page, Pills } from './parts'


/** What the test compares: skin tone (ITA°, descriptive) or redness (each arm against its own baseline). */
type ArmMetric = 'tone_ita' | 'redness'
const ARM: Record<ArmMetric, { short: string; name: string; unit: string; axis: string; note: string }> = {
  tone_ita: {
    short: 'ITA°',
    name: 'ITA°',
    unit: '°',
    axis: 'ITA° · lower means darker · descriptive, not better or worse',
    note: 'A change in tone, such as darkening from a self-tanner, is reported as change, not as better or worse.',
  },
  redness: {
    short: 'REDNESS',
    name: 'Redness',
    unit: '',
    axis: 'Redness · higher means more red than that arm’s own baseline',
    note: 'Redness is compared with each arm’s own skin only. Heat, exercise or a hot shower can raise it on both arms, which is what the control arm is there to show.',
  },
}
const isArmMetric = (v: string | null): v is ArmMetric => v === 'tone_ita' || v === 'redness'

/**
 * Treated vs control (old ControlCompare kinds): each arm against its own baseline and band; the verdict is on
 * the difference of the two changes, against their combined uncertainty (independent errors add in quadrature).
 */
type Kind = 'treated' | 'both_more' | 'not_attributable' | 'treated_small_gap' | 'noise' | 'no_band' | 'missing'
const KIND: Record<Kind, { glyph: VerdictKind; words: string }> = {
  treated: { glyph: 'changed', words: 'Treated-side change' },
  both_more: { glyph: 'changed', words: 'Both changed, treated more' },
  not_attributable: { glyph: 'normal', words: 'Shared drift' },
  treated_small_gap: { glyph: 'notEnough', words: 'Not separable yet' },
  noise: { glyph: 'normal', words: 'No clear difference' },
  no_band: { glyph: 'notEnough', words: 'No normal range yet' },
  missing: { glyph: 'notCompared', words: 'No comparison' },
}

function compare(t: Metric, c: Metric | null, tb: Metric | null, cb: Metric | null) {
  if (!c || !cb || c.delta === null || t.delta === null) return { kind: 'missing' as Kind, dd: null, band: null }
  if (tb?.mdc95 === null || tb?.mdc95 === undefined || cb.mdc95 === null) return { kind: 'no_band' as Kind, dd: t.delta - c.delta, band: null }
  const dd = t.delta - c.delta
  const band = Math.hypot(tb.mdc95, cb.mdc95)
  const treatedReal = t.verdict === 'real_change'
  const controlReal = c.verdict === 'real_change'
  // The gap counts only beyond the noise for a difference, and in the direction the treated side moved.
  const ddReal = Math.abs(dd) > band && Math.sign(dd) === Math.sign(t.delta)
  const kind: Kind = treatedReal && !controlReal && ddReal ? 'treated' : treatedReal && controlReal && ddReal ? 'both_more' : controlReal ? 'not_attributable' : treatedReal ? 'treated_small_gap' : 'noise'
  return { kind, dd, band }
}

/** Product test (design "Treated vs control"): forearm_treated against forearm_control, ITA° or redness over time. */
export default function ProductTest() {
  const data = useData()
  const shell = useShell()
  const [params, setParams] = useSearchParams()
  const tests = useProductTests()
  const test = data.mode === 'live' ? tests.running : null
  const testWrites = useProductTestWrites()
  const [lengthBusy, setLengthBusy] = useState(false)
  const treatedAll = useMemo(() => data.series('forearm_treated')?.sessions ?? [], [data])
  const controlAll = useMemo(() => data.series('forearm_control')?.sessions ?? [], [data])
  const measured = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)
  const latestT = [...treatedAll].reverse().find(measured) ?? null
  // Each arm is compared with its own baseline, taken the way its latest check-in was (camera photo or RAW).
  const mode: CaptureMode = latestT?.capture_mode ?? 'uncalibrated'
  const treated = useMemo(() => treatedAll.filter((s) => s.capture_mode === mode && measured(s)), [treatedAll, mode])
  const current = treated[treated.length - 1] ?? null
  const tBase = baselineFor(current, treatedAll)
  const control = matchControl(current, controlAll)
  const cBase = baselineFor(control, controlAll)
  // Redness is offered when this mode's treated check-ins measured it (the engine reads both on the square).
  const hasRedness = treated.some((s) => metricOf(s, 'redness')?.value != null)
  const qMetric = params.get('metric')
  const metricId: ArmMetric = isArmMetric(qMetric) && (qMetric === 'tone_ita' || hasRedness) ? qMetric : 'tone_ita'
  const look = ARM[metricId]
  const deg = (v: number | null, m: Pick<Metric, 'unit' | 'mdc95'>) => (v === null ? '—' : `${fmtValue(v, m)}${look.unit}`)
  const sdeg = (v: number | null, m: Pick<Metric, 'unit' | 'mdc95'>) => (v === null ? '—' : `${fmtSigned(v, m)}${look.unit}`)
  const setParam = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.set(k, v)
        return n
      },
      { replace: true },
    )

  if ((data.status === 'loading' || data.status === 'idle') && !data.all.length) return <WillowLoader inline label="Loading your product test" />

  const crumb = <Crumb to="/routine" back="Routine" here="Product test" />
  const photograph = () => shell.openCheckIn({ add: ['forearm_treated', 'forearm_control'] })
  const td = test ? testDay(test) : null
  const dots = test ? planDots(test, treatedAll) : []

  const end = async () => {
    if (!test) return
    try {
      await testWrites.end(test.id)
    } catch {
      toast("Couldn't end the test. Nothing changed; try again.")
      return
    }
    toast(`Ended the test of ${test.name}. Its photos and readings stay.`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => void testWrites.patch(test.id, { ended_at: null }).catch(() => toast("Couldn't undo. The test stays ended.")),
      },
    })
  }
  const setLength = async (days: number) => {
    if (!test || days === test.length_days) return
    setLengthBusy(true)
    try {
      await testWrites.patch(test.id, { length_days: days })
    } catch {
      toast("Couldn't change the test's length. Try again.")
    } finally {
      setLengthBusy(false)
    }
  }

  // The running test's plan: product, day N of M, one dot per day, verdict after day 14, length, end.
  const plan =
    test && td ? (
      <section aria-label="Test plan" className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[36px] p-[clamp(20px,3vw,28px)] text-willow-900 squircle" style={{ background: 'radial-gradient(120% 140% at 0% 0%, #B8E986 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, #4FB866 0%, transparent 60%), #DDF3C9' }}>
        <div className="flex flex-[1_1_300px] flex-col gap-2">
          <span className="font-mono text-[12px] tracking-[.08em]">■ ON YOUR FOREARM · SINCE {fmtDate(test.started_at).toUpperCase()}</span>
          <span className="text-[clamp(20px,2.2vw,26px)] tracking-[-0.01em]">{test.name}</span>
          <span className="text-[14px] leading-[1.45]">{td.ready ? (td.complete ? 'The plan is complete. Keep photographing to follow it further, or end the test.' : 'Past day 14: each check-in below gets a verdict.') : `Too early for a verdict: Willow gives one after day ${VERDICT_AFTER_DAYS}. Keep photographing both arms together every few days.`}</span>
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <label className="flex items-center gap-2 text-[13px]">
              Length
              <select value={test.length_days} disabled={lengthBusy} onChange={(e) => void setLength(Number(e.target.value))} className="min-h-11 rounded-pill bg-white/70 px-3 text-[14px] text-ink">
                {Array.from({ length: (MAX_TEST_DAYS - MIN_TEST_DAYS) / 7 + 1 }, (_, i) => MIN_TEST_DAYS + i * 7).map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void end()}>
              End test
            </Button>
          </span>
        </div>
        <div className="flex flex-[0_1_280px] flex-col gap-2.5">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px]">Day</span>
            <span className="font-dot text-[44px] leading-[.9]">{td.day}</span>
            <span className="text-[15px]">of {td.of} days</span>
          </span>
          <span role="img" aria-label={`${plural(dots.filter((d) => d === 'photo').length, 'day', 'days')} with a treated photo out of ${td.of}`} className="grid gap-[5px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
            {dots.map((d, i) => (
              <PlanDotMark key={i} dot={d} />
            ))}
          </span>
          <span className="text-[12px]">● treated photo · ○ to come · verdict after day {VERDICT_AFTER_DAYS}</span>
        </div>
      </section>
    ) : null

  if (!current)
    return (
      <Page label="Product test">
        {crumb}
        {plan}
        {test ? (
          <EmptyState
            title="Photograph both arms to start"
            body="Take the first photos of both squares together before you apply the product: they are the starting point every later check-in is compared with."
            action={
              <Button variant="ink" size="lg" onClick={photograph}>
                Photograph both arms
              </Button>
            }
          />
        ) : (
          <>
            <EmptyState
              title="No product test yet"
              body="A product test compares a treated square of skin on one forearm with an untreated square on the other, photographed together. Start with a baseline of each square, before you apply the product."
            />
            {data.mode === 'live' && tests.status === 'ready' ? (
              <section aria-label="Start a product test" className="card flex max-w-[640px] flex-col gap-3 bg-surface p-[clamp(20px,3vw,28px)]">
                <h2 className="m-0 text-[20px] font-normal">Start a test</h2>
                <StartTest preset={{ name: params.get('start') === 'self-tanner' ? 'Self-tanner' : '' }} />
                <span className="text-[13px] text-ink-2">To test a routine product, open it on the Routine page and choose “Start a forearm test”.</span>
              </section>
            ) : (
              <Button variant="ink" size="lg" className="self-start" onClick={photograph}>
                Photograph both arms
              </Button>
            )}
          </>
        )}
        <Disclaimer />
      </Page>
    )

  const t = metricOf(current, metricId)
  const c = metricOf(control, metricId)
  const tb = metricOf(tBase, metricId)
  const cb = metricOf(cBase, metricId)
  const isBase = sessionState(current) === 'baseline'
  // Calendar days in the person's own time zone: a baseline at 21:00 and a check-in at 08:00 next morning is day 1.
  const daysSince = (s: Session, base: Session) => Math.max(0, Math.round((parseDate(dayOf(s)).getTime() - parseDate(dayOf(base)).getTime()) / 86_400_000))
  const dayN = tBase ? daysSince(current, tBase) : 0
  const res = t && !isBase ? compare(t, c, tb, cb) : null
  // A running test gives no verdict before day 14 (values are still shown).
  const early = Boolean(td && !td.ready && !isBase)
  const fm: Pick<Metric, 'unit' | 'mdc95'> = { unit: t?.unit ?? (metricId === 'tone_ita' ? 'deg' : 'a_star'), mdc95: tb?.mdc95 ?? t?.mdc95 ?? 1 }

  // Chart: every treated check-in in this mode, with the control taken within 3 hours of it.
  const when = (s: Session) => (s.hours_since_baseline !== undefined ? fmtHours(s.hours_since_baseline).replace('Baseline', 'BASE').toUpperCase() : tBase ? `DAY ${daysSince(s, tBase)}` : fmtDate(s.created_at).toUpperCase())
  const tv = treated.map((s) => metricOf(s, metricId)?.value ?? null)
  const cv = treated.map((s) => metricOf(matchControl(s, controlAll), metricId)?.value ?? null)
  const labels = treated.map(when)

  const arm = (name: string, m: Metric | null, base: Metric | null, session: Session | null, bg: string, glow: string) => {
    const kind: VerdictKind | null = early && session ? 'notEnough' : m && session ? verdictKind(m, session) : null
    return (
      <div className="flex min-h-[320px] flex-col justify-between gap-[18px] rounded-[44px] p-[26px] text-white squircle" style={{ background: bg, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -30px 60px ${glow}, 0 40px 80px -50px rgba(0,0,0,.6)` }}>
        <span className="flex flex-wrap justify-between gap-2">
          <span className="text-[20px]">{name}</span>
          <span className="flex items-center gap-1.5 rounded-pill bg-white/14 px-3 py-[7px] text-[12px]">
            {kind ? <VerdictGlyph kind={kind} onDark /> : <VerdictGlyph kind="notCompared" onDark />}
            {early && session ? 'Too early' : kind ? VERDICT_WORDS[kind].label : session ? VERDICT_WORDS.notCompared.label : 'No photo'}
          </span>
        </span>
        <span className="flex flex-col items-center gap-1.5">
          {m && (isBase ? m.value : m.delta) !== null ? <span className="font-dot text-[clamp(45px,4vw,48px)] leading-[.9] tnum">{isBase ? deg(m.value, fm) : sdeg(m.delta, fm)}</span> : <span className="text-[40px] leading-[.9] opacity-70">—</span>}
          <span className="text-[15px] opacity-85">{isBase ? `${look.name} at the start` : `${look.name} change vs its own baseline`}</span>
        </span>
        <span className="flex flex-wrap justify-between gap-2 text-[14px] opacity-90">
          <span>{m && base && !isBase ? `from ${deg(base.value, fm)} to ${deg(m.value, fm)}` : m ? '' : 'no photo within 3 hours'}</span>
          <span>{base?.mdc95 !== null && base?.mdc95 !== undefined ? `normal range ±${fmtValue(base.mdc95, fm)}${look.unit}` : 'no normal range yet'}</span>
        </span>
      </div>
    )
  }

  const copy = (() => {
    if (early && td) return { h: `Too early for a verdict: day ${td.day} of ${td.of}.`, b: `Willow gives a verdict after day ${VERDICT_AFTER_DAYS}, once both arms have had time to show a difference. The changes so far are shown above as values only. Keep photographing both arms together every few days.` }
    if (isBase) return { h: 'Day 0: your starting point.', b: 'This is the treated arm’s baseline. Later check-ins of both arms are compared with their own baselines, then with each other.' }
    if (!res || !t) return { h: 'Not enough to compare yet.', b: `This check-in has no ${metricId === 'tone_ita' ? 'tone' : 'redness'} reading to compare.` }
    const tr = sdeg(t.delta, fm)
    const un = c ? sdeg(c.delta, fm) : '—'
    const dd = res.dd !== null ? sdeg(res.dd, fm) : '—'
    const band = res.band !== null ? `±${fmtValue(res.band, fm)}${look.unit}` : ''
    switch (res.kind) {
      case 'missing':
        return { h: 'The control arm wasn’t photographed with this check-in.', b: `The treated arm moved ${tr}. Without an untreated photo taken within 3 hours, Willow can’t separate the product from shared drift such as light or time of day. ${cBase ? 'Photograph both arms next time.' : 'Set a baseline for the untreated square first.'}` }
      case 'no_band':
        return { h: 'These baselines have too few photos for a band.', b: `Treated moved ${tr} and untreated ${un}. A baseline with fewer than 3 usable photos has no noise band, so Willow can’t say whether either change is real. Values are shown, verdicts are withheld. Take 3 or more photos of each square for the next baseline.` }
      case 'treated':
        return { h: 'The treated arm changed beyond its noise band. The control arm didn’t.', b: `Both arms were photographed together. The control moved ${un}, inside its band, so shared drift such as lighting explains little of the treated arm’s ${tr}. The ${dd} difference is larger than the combined uncertainty of ${band}, so it may be linked to the product.` }
      case 'both_more':
        return { h: 'Both arms changed, the treated arm more.', b: `Both moved outside their bands (treated ${tr}, untreated ${un}), so something besides the product, such as light, sun or temperature, moved both. The treated arm moved ${dd} more, beyond the combined uncertainty of ${band}; that extra part may be linked to the product.` }
      case 'not_attributable':
        return { h: t.verdict === 'real_change' ? 'Both arms changed by a similar amount.' : 'Only the untreated arm changed.', b: `Treated moved ${tr} and untreated ${un}. When the untreated arm moves too, the cause is likely shared: light, season or camera. This does not point to the product.` }
      case 'treated_small_gap':
        return { h: 'The treated arm changed, but not clearly more than the control.', b: `The treated arm moved ${tr}, outside its own band, while the untreated arm moved ${un}. The ${dd} difference is still inside the combined uncertainty of ${band}, so it can’t yet be separated from drift such as light or time of day.` }
      default:
        return { h: 'Neither arm moved beyond its normal range.', b: `Treated moved ${tr} and untreated ${un}; the ${dd} difference is inside the combined uncertainty of ${band}. There is no measurable change to attribute to anything yet.` }
    }
  })()

  return (
    <Page label="Product test">
      {crumb}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-[clamp(8px,2vw,24px)] pb-2">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">
            ■ {test ? test.name.toUpperCase() : 'TREATED VS CONTROL'} · {td ? `DAY ${td.day} OF ${td.of}` : `DAY ${dayN}`} · {look.short}
          </span>
          <h1 className="m-0 font-serif text-[clamp(31px,3vw,44px)] leading-[.9] font-normal">Treated arm vs control arm</h1>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {hasRedness ? (
            <Pills
              label="Compare"
              options={(['tone_ita', 'redness'] as ArmMetric[]).map((m) => ({ value: m, label: ARM[m].name }))}
              value={metricId}
              onChange={(m) => setParam('metric', m)}
            />
          ) : null}
        </div>
      </div>
      {plan}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3.5">
        {arm('Arm with product', t, tb, current, 'radial-gradient(80% 60% at 50% 0%, #F567B5 0%, #8E3A9E 40%, #2A0F36 80%)', 'rgba(245,103,181,.25)')}
        {arm('Arm without product', c, cb, control, 'radial-gradient(80% 60% at 50% 0%, #6E8BFF 0%, #2B3A9E 40%, #0B0F33 80%)', 'rgba(110,139,255,.25)')}
        <div className="flex min-h-[320px] flex-col justify-between gap-4 rounded-[44px] bg-surface p-[26px] shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
          <span className="text-[20px]">Difference between the changes</span>
          <span className="flex flex-col items-center gap-1.5">
            {res?.dd !== null && res?.dd !== undefined ? <span className="font-dot text-[clamp(45px,4vw,48px)] leading-[.9] tnum">{sdeg(res.dd, fm)}</span> : <span className="text-[40px] leading-[.9] text-ink-3">—</span>}
            <span className="text-[15px] text-ink-2">{res?.band !== null && res?.band !== undefined ? `combined uncertainty ±${fmtValue(res.band, fm)}${look.unit}` : 'combined uncertainty —'}</span>
          </span>
          <span className="flex items-center gap-2 self-start rounded-pill bg-selected px-3.5 py-[9px] text-[14px] text-inverse">
            <VerdictGlyph kind={early ? 'notEnough' : res ? KIND[res.kind].glyph : 'baseline'} onDark />
            {early ? `Too early · after day ${VERDICT_AFTER_DAYS}` : res ? KIND[res.kind].words : 'Baseline'}
          </span>
        </div>
      </div>
      <section aria-label="Both arms over time" className="flex flex-col gap-3.5 rounded-[44px] bg-black p-[clamp(20px,3vw,32px)] text-white squircle">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="m-0 text-[26px] font-light">Both arms, check-in by check-in</h2>
          <span className="text-[13px] text-white/60">{look.axis}</span>
        </div>
        <ForearmChart
          series={[
            { name: 'Treated', values: tv, color: 'var(--aura-pink)' },
            { name: 'Control', values: cv, color: '#6E8BFF', gapText: 'no control photo' },
          ]}
          labels={labels}
          format={(v) => fmtValue(v, fm)}
          unit={look.unit}
          caption={`${look.name} per check-in, treated and control arm`}
          summary={`${look.name} over ${plural(treated.length, 'check-in', 'check-ins')}. Treated: ${tv.map((v) => (v === null ? 'missing' : fmtValue(v, fm))).join(', ')}. Control: ${cv.map((v) => (v === null ? 'missing' : fmtValue(v, fm))).join(', ')}.`}
        />
        <div className="flex flex-wrap gap-[18px] text-[14px]">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-3.5 rounded-full bg-pink" />
            Treated
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-3.5 rounded-full bg-[#6E8BFF]" />
            Control
          </span>
        </div>
      </section>
      <section className="flex flex-col gap-2.5 rounded-[36px] bg-surface/85 p-[clamp(22px,3vw,30px)] squircle">
        <h2 className="m-0 text-[22px] font-normal">{copy.h}</h2>
        <p className="m-0 max-w-[860px] leading-[1.55] text-ink-2">{copy.b}</p>
        <p className="m-0 text-[14px] leading-normal text-ink-2">{look.note}</p>
        <Button variant="ink" size="lg" onClick={photograph} className="mt-1.5 self-start">
          Photograph both arms
        </Button>
      </section>
      <Disclaimer />
    </Page>
  )
}
