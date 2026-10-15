import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

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
import { fmtDate, fmtHours } from '../../lib/format'
import { fmtSigned, fmtValue } from '../../lib/metrics'
import { VERDICT_WORDS, verdictKind, type VerdictKind } from '../../lib/verdict'
import { MODE_LABEL, baselineFor, metricOf, sessionState } from './model'
import { Crumb, Page, Pills } from './parts'

const isMode = (v: string | null): v is CaptureMode => v === 'calibrated_raw' || v === 'uncalibrated'
const deg = (v: number | null, m: Pick<Metric, 'unit' | 'mdc95'>) => (v === null ? '—' : `${fmtValue(v, m)}°`)
const sdeg = (v: number | null, m: Pick<Metric, 'unit' | 'mdc95'>) => (v === null ? '—' : `${fmtSigned(v, m)}°`)

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

/** Product test (design "Treated vs control"): forearm_treated against forearm_control, ITA° over time. */
export default function ProductTest() {
  const data = useData()
  const shell = useShell()
  const [params, setParams] = useSearchParams()
  const treatedAll = useMemo(() => data.series('forearm_treated')?.sessions ?? [], [data])
  const controlAll = useMemo(() => data.series('forearm_control')?.sessions ?? [], [data])
  const measured = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)
  const latestT = [...treatedAll].reverse().find(measured) ?? null
  const qMode = params.get('mode')
  const mode: CaptureMode = isMode(qMode) ? qMode : (latestT?.capture_mode ?? 'uncalibrated')
  const modes = (['calibrated_raw', 'uncalibrated'] as CaptureMode[]).filter((m) => treatedAll.some((s) => s.capture_mode === m && measured(s)))
  const treated = useMemo(() => treatedAll.filter((s) => s.capture_mode === mode && measured(s)), [treatedAll, mode])
  const current = treated[treated.length - 1] ?? null
  const tBase = baselineFor(current, treatedAll)
  const control = matchControl(current, controlAll)
  const cBase = baselineFor(control, controlAll)

  if ((data.status === 'loading' || data.status === 'idle') && !data.all.length) return <WillowLoader inline label="Loading your product test" />

  const crumb = <Crumb to="/routine" back="Routine" here="Product test" />
  const photograph = () => shell.startCheckIn('forearm_treated', mode)
  if (!current)
    return (
      <Page label="Product test">
        {crumb}
        <EmptyState
          title="No product test yet"
          body="A product test compares a treated square of skin on one forearm with an untreated square on the other, photographed together. Start with a baseline of each square, before you apply the product."
          action={
            <Button variant="ink" size="lg" onClick={photograph}>
              Photograph both arms
            </Button>
          }
        />
        <Disclaimer />
      </Page>
    )

  const t = metricOf(current, 'tone_ita')
  const c = metricOf(control, 'tone_ita')
  const tb = metricOf(tBase, 'tone_ita')
  const cb = metricOf(cBase, 'tone_ita')
  const isBase = sessionState(current) === 'baseline'
  const dayN = tBase ? Math.max(0, Math.floor((new Date(current.created_at).getTime() - new Date(tBase.created_at).getTime()) / 86_400_000)) : 0
  const res = t && !isBase ? compare(t, c, tb, cb) : null
  const fm: Pick<Metric, 'unit' | 'mdc95'> = { unit: 'deg', mdc95: tb?.mdc95 ?? t?.mdc95 ?? 1 }

  // Chart: every treated check-in in this mode, with the control taken within 3 hours of it.
  const when = (s: Session) => (s.hours_since_baseline !== undefined ? fmtHours(s.hours_since_baseline).replace('Baseline', 'BASE').toUpperCase() : tBase ? `DAY ${Math.max(0, Math.floor((new Date(s.created_at).getTime() - new Date(tBase.created_at).getTime()) / 86_400_000))}` : fmtDate(s.created_at).toUpperCase())
  const tv = treated.map((s) => metricOf(s, 'tone_ita')?.value ?? null)
  const cv = treated.map((s) => metricOf(matchControl(s, controlAll), 'tone_ita')?.value ?? null)
  const labels = treated.map(when)

  const arm = (name: string, m: Metric | null, base: Metric | null, session: Session | null, bg: string, glow: string) => {
    const kind: VerdictKind | null = m && session ? verdictKind(m, session) : null
    return (
      <div className="flex min-h-[320px] flex-col justify-between gap-[18px] rounded-[44px] p-[26px] text-white squircle" style={{ background: bg, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -30px 60px ${glow}, 0 40px 80px -50px rgba(0,0,0,.6)` }}>
        <span className="flex flex-wrap justify-between gap-2">
          <span className="text-[20px]">{name}</span>
          <span className="flex items-center gap-1.5 rounded-pill bg-white/14 px-3 py-[7px] text-[12px]">
            {kind ? <VerdictGlyph kind={kind} onDark /> : <VerdictGlyph kind="notCompared" onDark />}
            {kind ? VERDICT_WORDS[kind].short : 'Missing'}
          </span>
        </span>
        <span className="flex flex-col items-center gap-1.5">
          {m && (isBase ? m.value : m.delta) !== null ? <span className="font-dot text-[clamp(45px,4vw,48px)] leading-[.9] tnum">{isBase ? deg(m.value, fm) : sdeg(m.delta, fm)}</span> : <span className="text-[40px] leading-[.9] opacity-70">—</span>}
          <span className="text-[15px] opacity-85">{isBase ? 'ITA° at the start' : 'ITA° change vs its own baseline'}</span>
        </span>
        <span className="flex flex-wrap justify-between gap-2 text-[14px] opacity-90">
          <span>{m && base && !isBase ? `from ${deg(base.value, fm)} to ${deg(m.value, fm)}` : m ? '' : 'no photo within 3 hours'}</span>
          <span>{base?.mdc95 !== null && base?.mdc95 !== undefined ? `band ±${fmtValue(base.mdc95, fm)}` : 'no band yet'}</span>
        </span>
      </div>
    )
  }

  const copy = (() => {
    if (isBase) return { h: 'Day 0: your starting point.', b: 'This is the treated arm’s baseline. Later check-ins of both arms are compared with their own baselines, then with each other.' }
    if (!res || !t) return { h: 'Not enough to compare yet.', b: 'This check-in has no tone reading to compare.' }
    const tr = sdeg(t.delta, fm)
    const un = c ? sdeg(c.delta, fm) : '—'
    const dd = res.dd !== null ? sdeg(res.dd, fm) : '—'
    const band = res.band !== null ? `±${fmtValue(res.band, fm)}°` : ''
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
            ■ TREATED VS CONTROL · {MODE_LABEL[mode].toUpperCase()} · DAY {dayN} · ITA°
          </span>
          <h1 className="m-0 font-serif text-[clamp(31px,3vw,44px)] leading-[.9] font-normal">Treated arm vs control arm</h1>
        </div>
        {modes.length > 1 ? <Pills label="Capture mode" tone="white" options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} value={mode} onChange={(m) => setParams({ mode: m }, { replace: true })} /> : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3.5">
        {arm('Treated forearm', t, tb, current, 'radial-gradient(80% 60% at 50% 0%, #F567B5 0%, #8E3A9E 40%, #2A0F36 80%)', 'rgba(245,103,181,.25)')}
        {arm('Control forearm', c, cb, control, 'radial-gradient(80% 60% at 50% 0%, #6E8BFF 0%, #2B3A9E 40%, #0B0F33 80%)', 'rgba(110,139,255,.25)')}
        <div className="flex min-h-[320px] flex-col justify-between gap-4 rounded-[44px] bg-surface p-[26px] shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
          <span className="text-[20px]">Difference between the changes</span>
          <span className="flex flex-col items-center gap-1.5">
            {res?.dd !== null && res?.dd !== undefined ? <span className="font-dot text-[clamp(45px,4vw,48px)] leading-[.9] tnum">{sdeg(res.dd, fm)}</span> : <span className="text-[40px] leading-[.9] text-ink-3">—</span>}
            <span className="text-[15px] text-ink-2">{res?.band !== null && res?.band !== undefined ? `combined uncertainty ±${fmtValue(res.band, fm)}°` : 'combined uncertainty —'}</span>
          </span>
          <span className="flex items-center gap-2 self-start rounded-pill bg-selected px-3.5 py-[9px] text-[14px] text-inverse">
            <VerdictGlyph kind={res ? KIND[res.kind].glyph : 'baseline'} onDark />
            {res ? KIND[res.kind].words : 'Baseline'}
          </span>
        </div>
      </div>
      <section aria-label="Both arms over time" className="flex flex-col gap-3.5 rounded-[44px] bg-black p-[clamp(20px,3vw,32px)] text-white squircle">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="m-0 text-[26px] font-light">Both arms, check-in by check-in</h2>
          <span className="text-[13px] text-white/60">ITA° · lower means darker · descriptive, not better or worse</span>
        </div>
        <ForearmChart
          series={[
            { name: 'Treated', values: tv, color: 'var(--aura-pink)' },
            { name: 'Control', values: cv, color: '#6E8BFF', gapText: 'no control photo' },
          ]}
          labels={labels}
          format={(v) => fmtValue(v, fm)}
          unit="°"
          caption="ITA° per check-in, treated and control arm"
          summary={`ITA° over ${treated.length} check-ins. Treated: ${tv.map((v) => (v === null ? 'missing' : fmtValue(v, fm))).join(', ')}. Control: ${cv.map((v) => (v === null ? 'missing' : fmtValue(v, fm))).join(', ')}.`}
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
        <p className="m-0 text-[14px] leading-normal text-ink-2">A change in tone, such as darkening from a self-tanner, is reported as change, not as better or worse.</p>
        <Button variant="ink" size="lg" onClick={photograph} className="mt-1.5 self-start">
          Photograph both arms
        </Button>
      </section>
      <Disclaimer />
    </Page>
  )
}
