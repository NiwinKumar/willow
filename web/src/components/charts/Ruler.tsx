import { clamp } from '../../lib/format'
import { bandPosition } from './chartMath'

/**
 * The hero ruler: 41 ticks, the centre is the baseline, one normal range spans 8 ticks either side
 * (ticks 12 to 28 are bright), and the tall cursor sits at the reading. `ratio` = change ÷ normal range;
 * null keeps the cursor on the centre. Decorative: the label underneath carries the words.
 */
export function HeroRuler({ ratio, label }: { ratio: number | null; label: string }) {
  const cur = ratio === null || !Number.isFinite(ratio) ? 20 : clamp(20 + Math.round(ratio * 8), 2, 38)
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div aria-hidden className="flex h-[58px] items-end gap-[clamp(4px,.8vw,9px)]">
        {Array.from({ length: 41 }, (_, i) => (
          <span
            key={i}
            className="rounded-[2px] transition-[height] duration-[600ms]"
            style={{
              width: i === cur ? 4 : 2,
              height: i === cur ? 58 : i === 20 ? 34 : i % 5 === 0 ? 24 : 14,
              background: i === cur ? '#fff' : Math.abs(i - 20) <= 8 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.4)',
            }}
          />
        ))}
      </div>
      <span className="text-center font-mono text-[12px] tracking-[.03em] uppercase">{label}</span>
    </div>
  )
}

/**
 * The band bar under a metric's number: the white block is the normal range (35%..65%), the marker is the
 * reading. `card` = dotted rule and a tall bar marker (metric cards); `tile` = a track with a round marker
 * (day detail). Decorative: the delta and range are always written beside it.
 */
export function BandBar({ ratio, hasBand, hasValue, variant = 'card' }: { ratio: number | null; hasBand: boolean; hasValue: boolean; variant?: 'card' | 'tile' }) {
  const pos = bandPosition(hasBand ? ratio : null)
  if (variant === 'tile')
    return (
      <span aria-hidden className="relative block h-1.5 rounded-[6px] bg-ink/12">
        <span className="absolute inset-y-0 left-[35%] w-[30%] rounded-[6px] bg-white/75" style={{ opacity: hasBand ? 1 : 0 }} />
        <span className="absolute -top-[3px] left-1/2 h-3 w-[1.5px] bg-ink/40" />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-selected shadow-[0_0_0_3px_rgba(255,255,255,.8)] transition-[left] duration-[600ms] ease-standard"
          style={{ left: `${pos}%`, opacity: hasValue ? 1 : 0 }}
        />
      </span>
    )
  return (
    <span aria-hidden className="relative block h-[22px]">
      <span className="absolute inset-x-[6%] top-[10px] h-0.5 opacity-50" style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1.4px)', backgroundSize: '7px 2px' }} />
      <span className="absolute top-[3px] left-[35%] h-4 w-[30%] rounded-pill bg-white/60" style={{ opacity: hasBand ? 1 : 0.25 }} />
      <span className="absolute top-0 h-[22px] w-[3px] -translate-x-1/2 rounded-[3px] bg-current transition-[left] duration-[600ms]" style={{ left: `${pos}%`, opacity: hasValue ? 1 : 0 }} />
    </span>
  )
}
