import { ChevronDown, Info } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import type { Metric } from '../data/types'
import { METRIC_META, UNIT_LABEL, decimalsFor, directionText, fmtSigned } from '../lib/metrics'
import { DUR, EASE_OUT, SPRING_STAMP } from '../lib/motion'
import { BandBar } from './BandBar'
import { ConfidenceChip, VerdictChip } from './Chip'
import { NumberValue } from './NumberValue'

type Props = {
  metric: Metric
  baselineValue: number | null
  baselineMdc: number | null
  reach: number
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
  stamp?: boolean
  /** The baseline has no noise band (one photo): show the change without a verdict. */
  noBand?: boolean
  children?: React.ReactNode
}

/** One metric, same anatomy every time: label + confidence, value + delta, band bar, verdict + wording. */
export function MetricRow({ metric: m, baselineValue, baselineMdc, reach, selected, expanded, onSelect, onToggle, stamp = false, noBand = false, children }: Props) {
  const reduce = useReducedMotion()
  const meta = METRIC_META[m.id]
  const unit = UNIT_LABEL[m.unit]
  const dec = decimalsFor(m)
  const dirText = m.verdict === 'real_change' ? directionText(m) : ''
  return (
    <li className={`relative border-b border-border transition-colors duration-150 ${selected ? 'bg-surface' : ''}`}>
      <div className="flex items-start gap-3 px-5 py-3 sm:px-6">
        {/* No aria-label: the value, change and verdict inside are what a screen reader should hear. */}
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" aria-pressed={selected} title="Select to show its regions on the photo">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{meta.label}</span>
            <ConfidenceChip confidence={m.confidence} />
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <NumberValue value={m.value} decimals={dec} unit={unit} />
            {m.delta !== null ? (
              <span className={`font-mono text-[15px] ${m.verdict === 'real_change' ? 'text-signal-700' : 'text-text-2'}`}>
                {fmtSigned(m.delta, m)} <span className="font-sans text-[12px] text-text-3">vs baseline</span>
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <BandBar value={m.value} baseline={baselineValue} mdc95={baselineMdc} verdict={m.verdict} reach={reach} label={bandLabel(m, baselineValue, baselineMdc)} />
          </div>
          <div className="mt-1 flex min-h-6 flex-wrap items-center gap-2">
            <motion.span
              key={`${m.id}-${m.verdict}`}
              initial={stamp && m.verdict === 'real_change' && !reduce ? { scale: 1.12, rotate: -2, opacity: 0 } : false}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ ...SPRING_STAMP, opacity: { duration: DUR.fast } }}
              className="inline-flex"
            >
              <VerdictChip verdict={m.verdict} noBand={noBand} />
            </motion.span>
            {dirText ? <span className="text-[13px] text-text-2">{dirText}</span> : null}
            {m.verdict === 'no_baseline' && m.id === 'tone_ita' && meta.note ? <span className="text-[13px] text-text-3">{meta.note}</span> : null}
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${meta.label} details` : `Show ${meta.label} details`}
          className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-(--radius-control) text-text-2 hover:bg-surface-2 active:scale-95"
        >
          {expanded ? <ChevronDown size={18} aria-hidden /> : <Info size={18} aria-hidden />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="detail"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 sm:px-6">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

function bandLabel(m: Metric, baseline: number | null, mdc: number | null): string {
  if (baseline === null || mdc === null) return `${METRIC_META[m.id].label}: first reading`
  const where = m.verdict === 'real_change' ? 'outside' : m.verdict === 'low_quality' ? 'not comparable to' : 'inside'
  return `${METRIC_META[m.id].label}: ${where} your noise band, ${fmtSigned(m.delta, m)} from baseline, band plus or minus ${mdc.toFixed(decimalsFor(m))}`
}
