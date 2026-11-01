import { Volume2, VolumeX } from 'lucide-react'

import { setVoice, useVoiceState } from './narration'

/**
 * The journeys' narration switch. When the browser hasn't let the narration start (a page opened directly, no tap
 * yet), it becomes a clear "Play narration" button: one tap unlocks it and the current slide is read.
 */
export function VoiceToggle() {
  const voice = useVoiceState()
  if (voice === 'blocked')
    return (
      <button type="button" onClick={() => setVoice(true)} className="flex min-h-11 shrink-0 items-center gap-2 rounded-pill bg-selected px-3 sm:px-4 text-[13.5px] text-inverse">
        <Volume2 size={17} strokeWidth={1.8} aria-hidden />
        <span className="hidden sm:inline">Play narration</span>
        <span className="sm:hidden">Play</span>
      </button>
    )
  const on = voice === 'on'
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Narration" onClick={() => setVoice(!on)} className="flex min-h-11 items-center gap-1.5 rounded-pill px-2 sm:px-3 text-[13px] text-ink-2 hover:bg-ink/5">
      {on ? <Volume2 size={17} strokeWidth={1.6} /> : <VolumeX size={17} strokeWidth={1.6} />}
      <span className="hidden sm:inline">Narration</span>
    </button>
  )
}
