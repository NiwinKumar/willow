/** Spot candidates of one session, named as the design names them, from real engine candidates and Gemini labels. */
import type { Candidate, Session } from '../../data/types.ts'
import { HIDDEN_RINGS, SPOT_NAME, type LabelDetail } from '../../lib/spotLabels.ts'
import { candidateView, VIEW_ORDER } from './views.ts'

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
  // "Seen in X of N": N is the photos of the mark's own view (front, or that cheek's). Engines before
  // features.frames_in_view: frames_used, which counts the front photos only, so a cheek mark gets no count.
  const photos = (c: Candidate) => c.features?.frames_in_view ?? (c.features?.view ? 0 : r.frames_used)
  // Numbered in the order the list shows them: front photo, then left cheek, then right cheek.
  const rank = (c: Candidate) => VIEW_ORDER.indexOf(candidateView(c))
  const ordered = [...r.candidates].sort((a, b) => rank(a) - rank(b))
  return ordered.map((c, i) => {
    const d = s.label_details?.[c.id] ?? null
    const hidden = Boolean(d && HIDDEN_RINGS.includes(d.label))
    const mole = d?.label === 'mole'
    const kind = hidden ? 'Hair or artefact' : mole ? 'Mole-like mark' : c.kind === 'spot' ? 'Dark spot' : 'Blemish candidate'
    const f = c.features?.seen_in_fraction
    const of = photos(c)
    return {
      n: i + 1,
      c,
      kind,
      detail: d,
      hidden,
      mole,
      // Ring hues tell the kinds apart on the photo; the list says the kind in words.
      ring: hidden ? 'var(--signal-noise)' : mole ? 'var(--aura-violet)' : c.kind === 'spot' ? 'var(--aura-apricot)' : 'var(--willow-400)',
      agree: of >= 2 && f !== undefined ? { seen: Math.round(f * of), of } : null,
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
