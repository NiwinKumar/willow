import type { ResearchView } from './proofApi'
import { GLOSSARY } from './ui/glossary.ts'

/*
 * The Research page's words and the downloadable "Methods appendix", built from GET /v1/proof/research (the api
 * reads every threshold from its own code) plus the fixed claim rules. Pure, so the page and the file say the
 * same thing. Where this api build sends no research, the page says so instead of retyping numbers.
 */

export type Block = { title: string; paras: string[]; list?: string[]; table?: { head: string[]; rows: string[][] } }

/** What may be said from Proof evidence, and what may not (docs/RETAIL_BRAND.md voice; research/finals/06 §3.2, §5). */
export const CLAIMS_CAN = [
  'State the measurement and its basis together: “A visible change in redness in 48% of 214 users by week 8 (observational, Proof by Willow)”.',
  'Name the comparison: “+17 points over people with the same goals who did not use it”.',
  'Say “associated with”, “seen in”, “measured in use”; quote n and the window every time.',
  'Use “Proven in use” only with its basis beside it: the tier rule is published and the same for every product.',
  'Quote what users said as self-reported, never as measured.',
]
export const CLAIMS_CANNOT = [
  '“Clinically proven”, “dermatologist proven” or anything that reads as a controlled trial: Proof is observational.',
  '“Treats”, “cures”, “heals”, “repairs” or any condition or disease name: Proof measures cosmetic appearance only.',
  '“Causes”, “guaranteed” or a promise to an individual: outcomes are rates in a group.',
  'Anything from the simulated cohort, or a mixed one, in external copy: those claims cannot be exported.',
  'A ranking of people or skin tones: tone bands are buckets for “works for whom”, never an order.',
]
export const CLAIM_LINE = (n: string, weeks: string) => `Measured in ${n} users over ${weeks} weeks, observational.`

export function researchBlocks(r: ResearchView | null, opts: { competitorNames: boolean | null }): Block[] {
  const blocks: Block[] = []
  const weeks = r?.weeks ?? 8
  blocks.push({
    title: 'How a change is measured',
    paras: [
      r?.method ?? 'Each person is measured against their own baseline from repeated photos.',
      r?.noise?.rule ?? `A metric counts as changed only when it moves beyond the person’s own noise band and still holds at week ${weeks}.`,
      ...(r?.noise?.band_photos ? [`The noise band (MDC95) comes from ${r.noise.band_photos} repeated photos at baseline: the smallest change those photos can tell apart from noise, at 95% confidence.`] : []),
      ...(r?.window ? [`Window: ${r.window}.`] : []),
      'The comparison group is people with the same goals who did not use the product, measured the same way. Lift is the difference in the share with a visible change, in percentage points, with a 95% (Wilson) interval.',
    ],
  })
  if (r?.tiers?.length)
    blocks.push({
      title: 'Proof tiers and thresholds',
      paras: ['The same rule for every product, computed in code; payment never changes a tier.'],
      table: { head: ['Tier', 'Rule', 'Minimum people'], rows: r.tiers.map((t) => [t.label, t.rule, String(t.min_n)]) },
    })
  if (r?.holdout)
    blocks.push({ title: 'Randomised holdout (campaign lift)', paras: [r.holdout.rule, 'This is the one randomised comparison in Proof: it measures what the campaign caused (adoption), not what the product does to skin.'] })
  if (r?.suppression) blocks.push({ title: 'Suppression', paras: [r.suppression.rule] })
  blocks.push({
    title: 'Cohort',
    paras: [
      r?.cohort ? `${r.cohort.real.toLocaleString('en-GB')} real consented people and ${r.cohort.simulated.toLocaleString('en-GB')} simulated people${r.cohort.label ? ` (${r.cohort.label})` : ''}.` : 'Cohort counts are unavailable right now (the warehouse did not answer); the method above still stands.',
      ...(r?.data_from && r?.data_to ? [`Readings from ${r.data_from} to ${r.data_to}.`] : []),
      ...(r?.simulated ? [`${r.simulated.note} Simulated generator: ${r.simulated.people.toLocaleString('en-GB')} people over ${r.simulated.weeks} weeks, fixed seed ${r.simulated.seed}.`] : []),
      ...(r?.consent ? [`Consent basis: ${r.consent}`] : []),
    ],
  })
  if (r?.metrics?.length)
    blocks.push({
      title: 'Metric dictionary',
      paras: ['Classical computer vision makes every number; no AI model measures, scores or diagnoses. Skin tone is descriptive only and never an outcome.'],
      table: {
        head: ['Metric', 'Unit', 'Wanted direction', 'Lower means', 'Higher means', 'Outcome'],
        rows: r.metrics.map((m) => [m.name, m.unit_display ?? m.unit ?? '—', m.better ? (m.better === 'higher' ? 'Higher' : 'Lower') : 'None (descriptive)', m.lower_means ?? '—', m.higher_means ?? '—', m.outcome ? 'Yes' : 'No']),
      },
    })
  blocks.push({ title: 'What you can say', paras: [r?.caveat ?? 'Observational real-world data, not a controlled trial.'], list: CLAIMS_CAN })
  blocks.push({ title: 'What you cannot say', paras: [], list: CLAIMS_CANNOT })
  const v = r?.visibility
  blocks.push({
    title: 'Data-sharing terms',
    paras: [opts.competitorNames === null ? 'Competitor naming is a retailer policy.' : `Competitor names: ${opts.competitorNames ? 'shown to brands (the retailer’s policy)' : 'hidden from brands; other brands read “Brand A”, “Brand B” (the retailer’s policy)'}.`],
    list: [...(v?.brands_see ?? []).map((x) => `Brands see: ${x}`), ...(v?.brands_never_see ?? []).map((x) => `Brands never see: ${x}`), ...(v?.retailer_never_sees ?? []).map((x) => `The retailer never sees: ${x}`)],
  })
  blocks.push({ title: 'Glossary', paras: [], list: Object.values(GLOSSARY).map((g) => `${g.term}: ${g.text}`) })
  return blocks
}

export function appendixMarkdown(blocks: Block[], head: { org: string; date: string; dataTo: string | null }): string {
  const out = [`# Methods appendix · Proof by Willow`, '', `${head.org} · generated ${head.date}${head.dataTo ? ` · ${head.dataTo}` : ''}`, '']
  for (const b of blocks) {
    out.push(`## ${b.title}`, '')
    for (const p of b.paras) out.push(p, '')
    if (b.table) {
      out.push(`| ${b.table.head.join(' | ')} |`, `|${b.table.head.map(() => '---').join('|')}|`)
      for (const r of b.table.rows) out.push(`| ${r.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`)
      out.push('')
    }
    if (b.list?.length) {
      for (const l of b.list) out.push(`- ${l}`)
      out.push('')
    }
  }
  out.push('---', 'Aggregates only; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.', '')
  return out.join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function appendixHtml(blocks: Block[], head: { org: string; date: string; dataTo: string | null }): string {
  const body = blocks
    .map((b) => {
      const paras = b.paras.map((p) => `<p>${esc(p)}</p>`).join('')
      const table = b.table ? `<table><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''
      const list = b.list?.length ? `<ul>${b.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''
      return `<section><h2>${esc(b.title)}</h2>${paras}${table}${list}</section>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Methods appendix · Proof by Willow</title>
<style>
body{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff;max-width:820px;margin:40px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#555;margin:0 0 24px}h2{font-size:16px;margin:28px 0 8px}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}th,td{border-bottom:1px solid #ddd;text-align:left;padding:6px 8px;vertical-align:top}th{background:#fafafa}
section{break-inside:avoid-page}footer{border-top:1px solid #ccc;margin-top:28px;padding-top:8px;font-size:12px;color:#555}
</style></head><body>
<h1>Methods appendix</h1>
<p class="sub">Proof by Willow · ${esc(head.org)} · generated ${esc(head.date)}${head.dataTo ? ` · ${esc(head.dataTo)}` : ''}</p>
${body}
<footer>Aggregates only; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.</footer>
</body></html>
`
}
