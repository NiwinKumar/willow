/** Spot candidates of one session, named as the design names them, from real engine candidates and Gemini labels. */
import type { Candidate, Session } from '../../data/types'
import { HIDDEN_RINGS, SPOT_NAME, type LabelDetail } from '../../lib/spotLabels'

export type SpotItem = {
  n: number
  c: Candidate
  /** "Dark spot", "Blemish candidate", "Mole-like mark", "Hair or artefact". */
  kind: string
  detail: LabelDetail | null
  hidden: boolean
  mole: boolean
  ring: string
  /** "Seen in 3 of 4 photos", or null for a one-photo session. */
  agree: { seen: number; of: number } | null
}

export function spotItems(s: Session): SpotItem[] {
  const r = s.result
  if (!r) return []
  const frames = r.frames_used
  return r.candidates.map((c, i) => {
    const d = s.label_details?.[c.id] ?? null
    const hidden = Boolean(d && HIDDEN_RINGS.includes(d.label))
    const mole = d?.label === 'mole'
    const kind = hidden ? 'Hair or artefact' : mole ? 'Mole-like mark' : c.kind === 'spot' ? 'Dark spot' : 'Blemish candidate'
    const f = c.features?.seen_in_fraction
    return {
      n: i + 1,
      c,
      kind,
      detail: d,
      hidden,
      mole,
      // Ring hues tell the kinds apart on the photo; the list says the kind in words.
      ring: hidden ? 'var(--signal-noise)' : mole ? 'var(--aura-violet)' : c.kind === 'spot' ? 'var(--aura-apricot)' : 'var(--willow-400)',
      agree: frames >= 2 && f !== undefined ? { seen: Math.round(f * frames), of: frames } : null,
    }
  })
}

/** "AI-suggested: freckle · high confidence" for the selected spot. */
export function spotLabelLine(it: SpotItem, labelsMissing: boolean): string {
  if (it.hidden) return 'Excluded from skin findings'
  if (it.mole) return 'Not assessed: moles are outside what Willow looks at'
  if (!it.detail) return labelsMissing ? 'AI label unavailable · engine candidate only' : 'No AI label for this one'
  if (it.detail.label === 'uncertain') return 'AI-suggested: unclear what this is'
  return `AI-suggested: ${SPOT_NAME[it.detail.label][0].toLowerCase()} · ${it.detail.confidence} confidence`
}

/** The short line under a spot in the list. */
export function spotShort(it: SpotItem, labelsMissing: boolean): string {
  if (it.hidden) return 'Excluded'
  if (it.mole) return 'Not assessed'
  const name = it.detail && it.detail.label !== 'uncertain' ? SPOT_NAME[it.detail.label][0] : labelsMissing ? 'Label unavailable' : 'Unclear'
  return it.agree ? `${name} · in ${it.agree.seen} of ${it.agree.of} photos` : name
}
