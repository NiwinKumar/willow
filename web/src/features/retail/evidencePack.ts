import type { Evidence, ProductDetail } from './types'

/**
 * The claim-evidence pack of one product, built in the browser from GET /v1/retailer/products/{id}: the api's
 * claim-ready statements (cosmetic, observational, numbers only from the computed row) with their method,
 * window, n and cohort label, and the caveat on top. Three shapes: a print-friendly HTML page, Markdown, and
 * CSV rows. No numbers are added here; every figure is the api's.
 */

export const KIND_LABEL: Record<Evidence['kind'], string> = {
  efficacy: 'Efficacy',
  speed: 'Speed',
  segment: 'Who it works for',
  retention: 'Continuation',
}

const FALLBACK_CAVEAT = 'Observational real-world data, not a controlled trial. Do not present as clinical substantiation.'

export type PackInput = Pick<ProductDetail, 'product' | 'evidence' | 'evidence_caveat' | 'cohort' | 'filters'>

const RANGE_WORDS: Record<string, string> = { '30d': 'last 30 days', '90d': 'last 90 days', all: 'all time' }

function facts(d: PackInput) {
  const p = d.product
  const caveat = d.evidence_caveat ?? d.evidence.find((e) => e.caveat)?.caveat ?? FALLBACK_CAVEAT
  const method = d.evidence.find((e) => e.method)?.method ?? null
  const cohort = `${d.cohort.synthetic} simulated + ${d.cohort.real} real users`
  const scope = `${RANGE_WORDS[d.filters.range] ?? d.filters.range} to ${d.filters.today} · ${d.filters.cohort} cohort filter (${cohort})`
  return { p, caveat, method, scope }
}

/** A file-safe name: willow-proof-evidence-<product id>. */
export const packName = (d: PackInput, ext: 'html' | 'md' | 'csv') => `willow-proof-evidence-${d.product.product_id}.${ext}`

/** One statement as it should be pasted: the text, then n, window and cohort. */
export function statementLine(e: Evidence): string {
  return `${e.text} (n=${e.n}${e.window ? `, ${e.window}` : ''}${e.cohort_label ? `, ${e.cohort_label}` : ''})`
}

export function packMarkdown(d: PackInput): string {
  const { p, caveat, method, scope } = facts(d)
  const lines = [
    `# Evidence pack: ${p.product} (${p.brand})`,
    '',
    `${p.category_label} · Proof tier: ${p.tier_label ?? p.tier} · ${scope}`,
    '',
    `> **Caveat.** ${caveat}`,
    '',
  ]
  if (method) lines.push(`**Method.** ${method}`, '')
  lines.push('## Statements', '')
  if (!d.evidence.length) lines.push('No statement: fewer than 10 people reached week 8 with this product.')
  d.evidence.forEach((e, i) => {
    lines.push(`${i + 1}. **${KIND_LABEL[e.kind]}.** ${e.text}`, `   - n=${e.n}${e.window ? ` · window ${e.window}` : ''}${e.cohort_label ? ` · ${e.cohort_label}` : ''}`)
  })
  lines.push('', '---', 'Proof by Willow · Retail intelligence. Aggregates only; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.', '')
  return lines.join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A standalone, print-friendly page (system fonts, black on white, no scripts). */
export function packHtml(d: PackInput): string {
  const { p, caveat, method, scope } = facts(d)
  const items = d.evidence
    .map(
      (e) =>
        `<li><p class="k">${esc(KIND_LABEL[e.kind])}</p><p class="t">${esc(e.text)}</p><p class="m">n=${e.n}${e.window ? ` · window ${esc(e.window)}` : ''}${e.cohort_label ? ` · ${esc(e.cohort_label)}` : ''}</p></li>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence pack: ${esc(p.product)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff;max-width:720px;margin:40px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#555;margin:0 0 20px}
.caveat{border:1px solid #111;padding:10px 14px;margin:0 0 16px}.method{color:#333}
ol{padding-left:20px}li{margin:0 0 14px;break-inside:avoid}.k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#555;margin:0}
.t{margin:2px 0}.m{font:12px ui-monospace,Menlo,monospace;color:#555;margin:0}footer{border-top:1px solid #ccc;margin-top:24px;padding-top:8px;font-size:12px;color:#555}
@media print{body{margin:0 auto}}
</style></head><body>
<h1>${esc(p.product)}</h1>
<p class="sub">${esc(p.brand)} · ${esc(p.category_label)} · Proof tier: ${esc(p.tier_label ?? p.tier)}<br>${esc(scope)}</p>
<p class="caveat"><strong>Caveat.</strong> ${esc(caveat)}</p>
${method ? `<p class="method"><strong>Method.</strong> ${esc(method)}</p>` : ''}
<h2>Statements</h2>
${d.evidence.length ? `<ol>\n${items}\n</ol>` : '<p>No statement: fewer than 10 people reached week 8 with this product.</p>'}
<footer>Proof by Willow · Retail intelligence. Aggregates only; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.</footer>
</body></html>
`
}

/** CSV header and rows: one statement per row. */
export function packCsv(d: PackInput): { header: string[]; rows: (string | number)[][] } {
  return {
    header: ['product', 'brand', 'kind', 'statement', 'n', 'window', 'cohort', 'method'],
    rows: d.evidence.map((e) => [d.product.product, d.product.brand, KIND_LABEL[e.kind], e.text, e.n, e.window ?? '', e.cohort_label ?? '', e.method ?? '']),
  }
}
