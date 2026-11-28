import type { SpotCheckIn } from '../../lib/api'
import { AREA_LABEL, countLine, dayLabel } from '../../lib/spotDiary'

/**
 * Spot diary tile: the latest face check-in's counts (as Progress has them), its busiest areas, and how the blemish
 * count compares with the check-in before. Nothing summed across check-ins (those totals were unreliable).
 */
export function SpotDiaryTile({ weeks, onOpen, className = '' }: { weeks: SpotCheckIn[]; onOpen: () => void; className?: string }) {
  const last = weeks[weeks.length - 1]
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null
  const areas = Object.entries(last.by_zone)
    .map(([zone, c]) => ({ zone, n: c.blemishes ?? 0 }))
    .filter((a) => a.n > 0 && AREA_LABEL[a.zone])
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
  const max = areas[0]?.n ?? 0
  const diff = prev && last.blemishes != null && prev.blemishes != null ? last.blemishes - prev.blemishes : null
  const since = prev ? (diff === 0 ? `Same blemish count as ${dayLabel(prev.created_at)}` : diff != null ? `${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} blemishes than ${dayLabel(prev.created_at)}` : '') : 'Your first face check-in'
  const head = `${dayLabel(last.created_at)}: ${countLine(last.blemishes, last.dark_spots)}`
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Spot diary. ${head}. ${since}. Open the spot diary.`}
      className={`flex min-h-[200px] min-w-0 animate-[wRise_.55s_.24s_both] flex-col gap-3 rounded-lg squircle p-5 text-left text-ink transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #D8B8FF 0%, transparent 60%), radial-gradient(100% 100% at 100% 100%, #F25FA8 0%, transparent 65%), #E6D9FF', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(122,92,255,.55)' }}
    >
      <span className="font-mono text-[11px] tracking-[.08em]">■ SPOT DIARY</span>
      <span aria-hidden className="flex flex-1 flex-col justify-center gap-[7px]">
        {areas.map((a) => (
          <span key={a.zone} className="grid grid-cols-[96px_1fr_22px] items-center gap-2 text-[12px]">
            <span>{AREA_LABEL[a.zone]}</span>
            <span className="h-2 overflow-hidden rounded-[8px] bg-white/50">
              <span className="block h-full rounded-[8px] bg-selected transition-[width] duration-[800ms] ease-standard" style={{ width: `${Math.round((a.n / max) * 100)}%` }} />
            </span>
            <span className="text-right font-dot text-[13px]">{a.n}</span>
          </span>
        ))}
      </span>
      <span className="flex flex-col">
        <span className="text-[14px]">{head}</span>
        <span className="text-[12px]">{since}</span>
      </span>
    </button>
  )
}
