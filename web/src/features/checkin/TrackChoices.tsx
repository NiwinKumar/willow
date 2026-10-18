import { CHOICE_COPY, CHOICE_SITES, TRACK_CHOICES, type TrackChoice } from '../../lib/track'
import { SITE_CARD } from './model'

/**
 * Places to track, as a multi-select of cards (onboarding and You). At least one stays on: the last one
 * can't be turned off. Each card's colour is decoration, never data.
 */
export function TrackChoices({ value, onChange }: { value: TrackChoice[]; onChange: (next: TrackChoice[]) => void }) {
  const toggle = (c: TrackChoice) => {
    if (value.includes(c)) {
      if (value.length > 1) onChange(value.filter((x) => x !== c))
    } else onChange(TRACK_CHOICES.filter((x) => x === c || value.includes(x)))
  }
  return (
    <div role="group" aria-label="Places to track" className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
      {TRACK_CHOICES.map((c) => {
        const on = value.includes(c)
        const look = SITE_CARD[CHOICE_SITES[c][0]]
        const copy = CHOICE_COPY[c]
        const last = on && value.length === 1
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            aria-pressed={on}
            aria-disabled={last || undefined}
            title={last ? 'Keep at least one place' : undefined}
            className="w-lift-sm relative flex min-h-[clamp(88px,13vh,128px)] flex-col justify-between gap-3 rounded-[24px] p-3.5 text-left"
            style={{ background: look.bg, color: look.fg, boxShadow: on ? 'inset 0 0 0 2px #121212, inset 0 0 30px 4px rgba(255,255,255,.35)' : 'inset 0 0 30px 4px rgba(255,255,255,.35), 0 18px 40px -32px rgba(0,0,0,.45)' }}
          >
            <span className="flex items-start justify-between gap-2">
              {copy.tag ? <span className="rounded-pill bg-white/45 px-2 py-1 text-[11.5px]">{copy.tag}</span> : <span />}
              <span aria-hidden className={`grid size-6 flex-none place-items-center rounded-full border-[1.5px] border-white/80 text-[12px] text-inverse ${on ? 'bg-selected' : 'bg-white/30'}`}>
                {on ? '✓' : ''}
              </span>
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-[clamp(17px,2.2vh,20px)] leading-[1.1] tracking-[-0.01em]">{copy.title}</span>
              <span className="text-[13px] leading-[1.35] opacity-80">{copy.line}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
