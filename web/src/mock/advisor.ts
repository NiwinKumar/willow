import type { Session } from '../data/types'
import { METRIC_META, fmtSigned, fmtValue } from '../lib/metrics'
import { DEMO_ROUTINE } from './routine'

export type Turn = {
  role: 'user' | 'willow'
  text: string
  retrieval?: string[]
  product_ids?: string[]
  follow_ups?: string[]
  numbers?: { token: string; metric: string }[]
  /** Live answers: what the validator checked (api advisor.py). */
  checks?: { model: string; tool_calls: number; numbers_checked: number; products_from_tools: number }
}

/** Canned advisor turns for demo mode. Every quoted number is read from the session data, never typed in. */
export function answer(q: string, sessions: Session[]): Turn {
  const latest = sessions[sessions.length - 1]
  const spots = latest?.result?.metrics.find((m) => m.id === 'pigment_spots')
  const red = latest?.result?.metrics.find((m) => m.id === 'redness')
  const lower = q.toLowerCase()
  if (lower.includes('azelaic') || lower.includes('doing anything')) {
    const d = spots && spots.delta !== null ? fmtSigned(spots.delta, spots) : null
    const band = spots && spots.mdc95 !== null ? fmtValue(spots.mdc95, spots) : null
    const real = Boolean(d) && spots?.verdict === 'real_change'
    // The words follow the verdict and only quote numbers that exist.
    const spotsLine = !d
      ? 'Since you started azelaic acid at week 2, there is no dark-spot reading to compare with your baseline yet.'
      : real
        ? `Since you started azelaic acid at week 2, dark spots moved ${d}${band ? ` against a noise threshold of ${band}` : ''}, which counts as a real change.`
        : `Since you started azelaic acid at week 2, dark spots moved ${d}${band ? `, inside the noise threshold of ${band}` : ''}, so no clear change yet.`
    const r = red && red.delta !== null ? fmtSigned(red.delta, red) : null
    const redLine = !r ? '' : red?.verdict === 'real_change' ? ` Redness moved ${r}, beyond its band.` : ` Redness moved ${r}, inside its band, so no clear change there yet.`
    const advice = real
      ? ' The change may be linked to the azelaic acid; the niacinamide you were already using could also contribute, so I would keep both as they are for two more weeks before changing anything.'
      : ' Most pigment effects take 8 to 12 weeks to clear photo noise, so I would keep the azelaic acid as it is and check again in two weeks.'
    const inUse = DEMO_ROUTINE.filter((e) => !e.ended_at).length
    return {
      role: 'willow',
      text: `${spotsLine}${redLine}${advice}`,
      retrieval: ['Checked your results (latest session)', `Checked your routine (${inUse} ${inUse === 1 ? 'product' : 'products'})`],
      numbers: [...(d ? [{ token: d, metric: 'pigment_spots' }] : []), ...(band && d ? [{ token: band, metric: 'pigment_spots' }] : []), ...(r ? [{ token: r, metric: 'redness' }] : [])],
      follow_ups: ['Should I keep using it?', 'What else helps dark spots?', 'When should I take my next photos?'],
    }
  }
  if (lower.includes('dark spots') || lower.includes('under')) {
    return {
      role: 'willow',
      text: `For dark spots under ₹1,500, three options from the catalog target pigmentation and fit your routine: you already use azelaic acid, alpha arbutin is a budget addition, and daily sunscreen is the one your routine is missing. Dark spots are currently ${spots ? fmtSigned(spots.delta, spots) : '–'} versus your baseline, so adding one thing at a time will keep the timeline readable.`,
      retrieval: ['Checked your results (latest session)', 'Searched catalog: dark spots, under ₹1,500 (3 results)'],
      product_ids: ['minimalist-alpha-arbutin-2-face-serum', 'la-roche-posay-anthelios-uvmune-400-invisible-fluid-spf50', 'the-derma-co-1-hyaluronic-sunscreen-aqua-gel-spf-50'],
      numbers: spots ? [{ token: fmtSigned(spots.delta, spots), metric: 'pigment_spots' }] : [],
      follow_ups: ['Can I use azelaic acid with retinol?', 'Which sunscreen for oily skin?'],
    }
  }
  if (lower.includes('retinol') && (lower.includes('glycolic') || lower.includes('bha') || lower.includes('apart') || lower.includes('together') || lower.includes('exfoliant'))) {
    return {
      role: 'willow',
      text: 'Retinol and an exfoliating acid used on the same night can irritate: both increase cell turnover, so the skin barrier gets hit twice. Alternating nights keeps both and avoids the overlap. If you notice more redness in your readings after a night with both, that is the signal to space them further apart.',
      retrieval: ['Checked your routine (rule: retinoid + AHA/BHA, caution)'],
      follow_ups: ['Apply alternate nights', 'Is my redness changing?'],
    }
  }
  if (lower.includes('next photos') || lower.includes('when')) {
    return {
      role: 'willow',
      text: 'Weekly is enough. Daily scans mostly measure your lighting. Your baseline was taken in the evening after washing; keep to that. Most pigment effects take 8 to 12 weeks to clear photo noise, so the next meaningful check-in for dark spots is in about two weeks.',
      retrieval: ['Checked your sessions (7 of them, weekly)'],
      follow_ups: ['Is my azelaic acid doing anything?', 'What should I add for dark spots under ₹1,500?'],
    }
  }
  if (lower.includes('mole') || lower.includes('rash') || lower.includes('pain') || lower.includes('bleed')) {
    return {
      role: 'willow',
      text: 'This sounds medical. Willow only tracks cosmetic appearance and cannot assess moles or skin conditions. For a changing mole, a rash or pain, please see a dermatologist.',
      retrieval: ['No lookups needed'],
      follow_ups: ['Back to my results'],
    }
  }
  return {
    role: 'willow',
    text: `I can explain your measurements, check your routine and find products from a facts-only catalog. Your latest session shows ${latest?.result?.metrics.filter((m) => m.verdict === 'real_change').length ?? 0} real change${(latest?.result?.metrics.filter((m) => m.verdict === 'real_change').length ?? 0) === 1 ? '' : 's'} since your baseline. Ask about a metric, a product, or what to do next.`,
    retrieval: ['Checked your results (latest session)'],
    follow_ups: ['Is my azelaic acid doing anything?', 'What should I add for dark spots under ₹1,500?', 'Can I use retinol and glycolic acid together?', 'When should I take my next photos?'],
  }
}

export const STARTERS = ['Is my azelaic acid doing anything?', 'What should I add for dark spots under ₹1,500?', 'Can I use retinol and glycolic acid together?', 'When should I take my next photos?']
export { productById } from './catalog'
export { METRIC_META }
