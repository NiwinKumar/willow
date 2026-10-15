/** The Result hero for each session state (design `heroes`). */
import type { Metric, Session } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { METRIC_META } from '../../lib/metrics'
import { VERDICT_WORDS, type VerdictKind } from '../../lib/verdict'
import { REASON_SHORT, bandOf, bandText, counts, deltaText, leadMetric, noBand, sessionState, usableLine, usedFrames } from './model'

const G = {
  orange: 'radial-gradient(52% 62% at 50% 52%, #FF6A00 0%, #FF8A2A 20%, #F7A866 40%, #E4BFA9 58%, #C4C3D2 78%, #AEB8CC 100%)',
  violet: 'radial-gradient(52% 62% at 50% 52%, #6B4CFF 0%, #9A79FF 22%, #E0A4E6 46%, #F0C7DD 66%, #E3DDEA 100%)',
  blue: 'radial-gradient(52% 62% at 50% 52%, #1F5CFF 0%, #4F8EFF 22%, #93C2F4 46%, #CFE1F0 70%, #E6EBF0 100%)',
  grey: 'radial-gradient(60% 70% at 50% 50%, #F7F6F3 0%, #E7E5E0 60%, #D9D7D1 100%)',
  coral: 'radial-gradient(52% 62% at 50% 60%, #FF5A3A 0%, #E0452A 25%, #9E2E1C 55%, #3A1208 100%)',
}

export type Chip = { g: VerdictKind | 'text'; t: string; mark?: string }
export type Hero = { bg: string; shadow: string; fg: string; eyebrow: string; kicker: string; big: string; bigLabel: string; chips: Chip[]; ruler: { ratio: number | null; label: string } | null; text: string; grey?: boolean }

const pad = (n: number) => String(n).padStart(2, '0')

/** The hero for each session state (design `heroes`), every number from the session and its baseline. */
export function heroFor(s: Session, baseline: Session | null, ordered: Metric[]): Hero {
  const st = sessionState(s)
  const c = counts(s)
  const photos = usableLine(s)
  const bDay = baseline ? fmtDate(baseline.created_at).toUpperCase() : ''
  const lead = leadMetric(ordered, s)
  const leadBand = lead ? bandOf(baseline, lead.id) : null
  const chipsFor = (kinds: VerdictKind[]): Chip[] => kinds.filter((k) => c[k] > 0).map((k) => ({ g: k, t: `${c[k]} ${VERDICT_WORDS[k].label.toLowerCase()}` }))
  if (st === 'rejected') {
    const reasons = [...new Set(s.result?.quality.reasons ?? [])]
    return {
      bg: G.coral,
      shadow: 'rgba(224,69,42,.6)',
      fg: '#fff',
      eyebrow: 'NO USABLE PHOTOS',
      kicker: 'This check-in couldn’t be measured',
      big: pad(usedFrames(s)),
      bigLabel: `of ${s.n_frames} ${s.n_frames === 1 ? 'photo' : 'photos'} passed the quality checks`,
      chips: reasons.map((r) => ({ g: 'text', mark: '!', t: REASON_SHORT[r] ?? r })),
      ruler: null,
      text: 'Nothing was compared and your baseline is unchanged. The reasons and fixes are below.',
    }
  }
  if (st === 'unmeasured')
    return {
      bg: G.grey,
      shadow: 'rgba(0,0,0,.2)',
      fg: 'var(--text-primary)',
      grey: true,
      eyebrow: 'SAVED · NOT MEASURED',
      kicker: 'Your photos are kept',
      big: '—',
      bigLabel: 'not measured',
      chips: [{ g: 'text', mark: '✓', t: `${s.n_frames} ${s.n_frames === 1 ? 'photo' : 'photos'} stored privately` }],
      ruler: null,
      text: 'Willow did not measure this place when these photos were saved, so there are no numbers for them.',
    }
  if (st === 'former')
    return {
      bg: G.grey,
      shadow: 'rgba(0,0,0,.2)',
      fg: 'var(--text-primary)',
      grey: true,
      eyebrow: 'AN EARLIER BASELINE',
      kicker: photos,
      big: '—',
      bigLabel: 'not compared',
      chips: [],
      ruler: null,
      text: 'This was your baseline until you chose another one, so it is not compared with it. Its values are kept for reference.',
    }
  if (st === 'baseline') {
    const used = usedFrames(s)
    const banded = (s.result?.metrics ?? []).filter((m) => m.mdc95 !== null).length
    return {
      bg: G.violet,
      shadow: 'rgba(107,76,255,.55)',
      fg: '#16093A',
      eyebrow: `BASELINE SET · ${fmtDate(s.created_at).toUpperCase()}`,
      kicker: 'Your starting point',
      big: pad(used),
      bigLabel: used >= 3 ? `${used === 1 ? 'photo' : 'photos'} set your normal range` : `usable ${used === 1 ? 'photo' : 'photos'}: not enough for a normal range`,
      chips: used >= 3 ? [{ g: 'baseline', t: `${banded} normal ${banded === 1 ? 'range' : 'ranges'} measured` }] : [{ g: 'notEnough', t: 'No normal range yet' }],
      ruler: { ratio: null, label: 'Every later reading is compared with this point' },
      text:
        used >= 3
          ? `Later ${s.capture_mode === 'uncalibrated' ? 'Quick' : 'RAW'} check-ins of this place are compared with this one. A change only counts when it is bigger than that reading’s normal range.`
          : 'A baseline needs 3 or more usable photos to measure how much your readings wobble on their own. Check in again with more photos and make that one your baseline.',
    }
  }
  // compared
  if (noBand(s)) {
    const label = lead && lead.delta !== null ? `${METRIC_META[lead.id].label} · ${deltaText(lead)} · no normal range yet` : 'No normal range yet'
    return {
      bg: G.blue,
      shadow: 'rgba(31,92,255,.55)',
      fg: '#0A1840',
      eyebrow: `COMPARED WITH ${bDay || 'YOUR BASELINE'} · NO NORMAL RANGE`,
      kicker: 'Changes shown, not judged',
      big: String(c.values),
      bigLabel: 'readings compared · none can be called a change yet',
      chips: chipsFor(['notEnough', 'notCompared']),
      ruler: { ratio: null, label },
      text: 'Your baseline has fewer than 3 usable photos, so Willow cannot tell a change from normal photo-to-photo variation. A baseline with more photos fixes this.',
    }
  }
  const n = c.changed
  // Ember means "Changed" only (DESIGN.md rule 3): with nothing changed the hero is the calm violet the
  // day detail uses for a within-range day, not orange.
  return {
    bg: n ? G.orange : G.violet,
    shadow: n ? 'rgba(255,106,0,.6)' : 'rgba(107,76,255,.45)',
    fg: n ? '#1F0E04' : '#16093A',
    eyebrow: `SINCE YOUR BASELINE${bDay ? ` · ${bDay}` : ''}`,
    kicker: 'Readings beyond your normal range',
    big: String(n),
    bigLabel: n === 1 ? 'reading changed more than your photos usually vary' : n ? 'readings changed more than your photos usually vary' : 'no reading moved beyond your normal range',
    chips: chipsFor(['changed', 'normal', 'notEnough', 'notCompared']),
    ruler:
      lead && lead.delta !== null
        ? { ratio: leadBand ? lead.delta / leadBand : null, label: `${METRIC_META[lead.id].label} · ${deltaText(lead)} vs baseline${leadBand !== null ? ` · range ${bandText(lead, leadBand)}` : ''}` }
        : null,
    text: n
      ? `${n === 1 ? 'One reading' : `${n} readings`} moved further than your normal photo-to-photo variation. ${c.normal ? 'The others stayed within it.' : ''}`.trim()
      : 'That is common in the first weeks of a routine. Keep light, pose and distance the same.',
  }
}
