import type { SpotDiary, SpotStatus, SpotZone } from '../../lib/api'
import { plural } from '../../lib/format'
import { fmtDays } from '../progress/diaryText'

const STATUS: Record<SpotStatus, { g: string; t: string }> = {
  new: { g: '▲', t: 'New' },
  fading: { g: '◐', t: 'Fading' },
  still_there: { g: '●', t: 'Still there' },
  gone: { g: '○', t: 'Faded' },
  not_seen_last_time: { g: '◌', t: 'Not seen last time' },
}

const ZONE_LABEL: Record<SpotZone, string> = {
  forehead: 'Forehead',
  nose: 'Nose',
  right_cheek: 'Right cheek',
  left_cheek: 'Left cheek',
  around_mouth: 'Around mouth',
  chin: 'Chin',
  right_jaw: 'Right jaw',
  left_jaw: 'Left jaw',
}

/** Spot diary tile: up to five marks by status, the busiest areas, one summary line. Only with enough data. */
export function SpotDiaryTile({ diary, onOpen, className = '' }: { diary: SpotDiary; onOpen: () => void; className?: string }) {
  const tracks = diary.tracks.filter((t) => t.confirmed)
  const order: SpotStatus[] = ['new', 'fading', 'still_there', 'not_seen_last_time', 'gone']
  const shown = [...tracks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).slice(0, 5)
  const count = (s: SpotStatus) => tracks.filter((t) => t.status === s).length
  const parts = (['fading', 'new', 'still_there'] as const).filter((s) => count(s) > 0).map((s) => `${count(s)} ${STATUS[s].t.toLowerCase()}`)
  const summary = parts.length ? parts.join(', ') : plural(tracks.length, 'mark followed', 'marks followed')
  const zones = [...diary.zones].filter((z) => z.appeared > 0).sort((a, b) => b.appeared - a.appeared).slice(0, 3)
  const max = zones[0]?.appeared ?? 0
  const busiest = zones.length && (zones.length === 1 || zones[1].appeared < max) ? `${ZONE_LABEL[zones[0].zone]} gets new spots most often` : `Across ${plural(diary.sessions_used, 'check-in', 'check-ins')}, ${fmtDays(diary.days_covered)}`
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Spot diary: ${summary}. ${busiest}. Open the spot diary.`}
      className={`flex min-h-[200px] min-w-0 animate-[wRise_.55s_.24s_both] flex-col gap-3 rounded-lg squircle p-5 text-left text-ink transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #D8B8FF 0%, transparent 60%), radial-gradient(100% 100% at 100% 100%, #F25FA8 0%, transparent 65%), #E6D9FF', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(122,92,255,.55)' }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[.08em]">■ SPOT DIARY</span>
        <span aria-hidden className="flex gap-1">
          {shown.map((t) => (
            <span key={t.id} title={STATUS[t.status].t} className="grid size-[22px] place-items-center rounded-full bg-white/60 text-[10px]">
              {STATUS[t.status].g}
            </span>
          ))}
        </span>
      </span>
      <span aria-hidden className="flex flex-1 flex-col justify-center gap-[7px]">
        {zones.map((z) => (
          <span key={z.zone} className="grid grid-cols-[86px_1fr_18px] items-center gap-2 text-[12px]">
            <span>{ZONE_LABEL[z.zone]}</span>
            <span className="h-2 overflow-hidden rounded-[8px] bg-white/50">
              <span className="block h-full rounded-[8px] bg-selected transition-[width] duration-[800ms] ease-standard" style={{ width: `${Math.round((z.appeared / max) * 100)}%` }} />
            </span>
            <span className="text-right font-dot text-[13px]">{z.appeared}</span>
          </span>
        ))}
      </span>
      <span className="flex flex-col">
        <span className="text-[14px]">{summary.charAt(0).toUpperCase() + summary.slice(1)}</span>
        <span className="text-[12px]">{busiest}</span>
      </span>
    </button>
  )
}
