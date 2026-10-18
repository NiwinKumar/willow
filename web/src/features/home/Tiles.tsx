import type { PlanDot } from '../routine/productTests'
import type { ForearmRead } from './forearm'

/** One plan dot: filled on a day with a treated photo, ringed today, faint for days gone by, outlined to come. */
export function PlanDotMark({ dot, ring = 'rgba(255,255,255,.85)' }: { dot: PlanDot; ring?: string }) {
  return (
    <span
      className="aspect-square rounded-full"
      style={{
        background: dot === 'photo' ? 'var(--willow-900)' : dot === 'past' ? 'rgba(15,59,58,.22)' : 'transparent',
        boxShadow: dot === 'today' ? `inset 0 0 0 1.5px var(--willow-900), 0 0 0 2px ${ring}` : dot === 'future' ? 'inset 0 0 0 1px rgba(15,59,58,.3)' : 'none',
      }}
    />
  )
}

/** Product test tile: "{product} on your forearm", day N of M with the plan's dots (or day N since the treated baseline), and where it stands. */
export function ProductTestTile({ read, onOpen, className = '' }: { read: ForearmRead; onOpen: () => void; className?: string }) {
  const { day, of, name, dots, standing } = read
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Product test${name ? `: ${name} on your forearm` : ''}, day ${day}${of ? ` of ${of}` : ''}. ${standing.t}. Open the product test.`}
      className={`flex min-h-[200px] min-w-0 animate-[wRise_.55s_.2s_both] flex-col justify-between gap-2.5 rounded-lg squircle p-5 text-left text-willow-900 transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #B8E986 0%, transparent 60%), radial-gradient(100% 100% at 100% 100%, #4FB866 0%, transparent 62%), #CDEFB5', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(15,59,58,.55)' }}
    >
      <span className="font-mono text-[11px] tracking-[.08em]">■ PRODUCT TEST</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[13px]">Day</span>
        <span className="font-dot text-[46px] leading-[.85]">{day}</span>
        {of ? <span className="text-[13px]">of {of} days</span> : null}
      </span>
      <span aria-hidden className="grid w-full max-w-[300px] grid-cols-[repeat(14,1fr)] gap-[3px]">
        {dots.map((d, i) => (
          <PlanDotMark key={i} dot={d} />
        ))}
      </span>
      <span className="flex flex-col">
        <span className="line-clamp-2 text-[14px]">{name ? `${name} on your forearm` : 'Arm with product vs arm without'}</span>
        <span className="text-[12px]">
          <span aria-hidden>{standing.g} </span>
          {standing.t}
        </span>
      </span>
    </button>
  )
}
