import { laneOf, type DecisionCard } from './decisions.ts'
import type { DecisionItem, EvidenceRequest } from './proofApi'
import type { Coverage } from './range'
import { int } from './ui/format.ts'

/*
 * The weekly digest (research/finals/06 §6.1 item 6), the pure parts: what an organisation's admins and analysts
 * would receive each Monday, composed from the same cards and requests as the Decisions home. Shown as a
 * preview page only: sending needs an email provider, which this version does not have. Nothing is projected:
 * every line is a card, a request or a coverage count that exists today.
 */

export type DigestLine = { title: string; line: string; to?: string }
export type Digest = {
  subject: string
  /** The next Monday it would go out on, as words. */
  monday: string
  waiting: DecisionCard[]
  waitingN: number
  results: DigestLine[]
  requests: DigestLine[]
  /** Coverage when the item file was connected, and now (live statuses); null without a range. */
  range: { then: Coverage; now: Coverage; since: string | null } | null
}

export type DigestInput = {
  orgName: string
  kind: 'retailer' | 'brand'
  cards: DecisionCard[]
  items: Record<string, DecisionItem>
  inbox: EvidenceRequest[]
  outbox: EvidenceRequest[]
  range: { then: Coverage; now: Coverage; since: string | null } | null
  now: number
}

const WEEK = 7 * 86_400_000
const recent = (iso: string | null | undefined, now: number) => Boolean(iso) && now - Date.parse(iso!) <= WEEK

/** The next Monday it would go out on (UTC): today when today is a Monday. */
export function mondayOf(now: number): Date {
  const d = new Date(now)
  const ahead = (8 - d.getUTCDay()) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ahead))
}

export function composeDigest(x: DigestInput): Digest {
  const open = x.cards.filter((c) => c.lane === 'decide' && laneOf(x.items[c.key], x.now) === 'decide')
  const resultCards = x.cards.filter((c) => c.lane === 'result' && laneOf(x.items[c.key], x.now) === 'decide')
  const results: DigestLine[] = [
    ...resultCards.map((c) => ({ title: c.title, line: `${c.figure} ${c.figureNote}${c.n !== null ? ` · n=${int(c.n)}` : ''}${c.interval ? ` · ${c.interval}` : ''}` })),
    ...x.outbox.filter((r) => r.status !== 'open' && recent(r.updated_at ?? r.created_at, x.now)).map((r) => ({ title: `${r.to_name ?? r.to_org} ${r.status === 'answered' ? 'answered' : 'declined'}: ${r.product ?? r.product_id}`, line: r.reply ? `“${r.reply}”` : 'No reply text.' })),
  ]
  const requests: DigestLine[] =
    x.kind === 'brand'
      ? x.inbox.filter((r) => r.status === 'open').map((r) => ({ title: `${r.from_name ?? r.from_org} asks about ${r.product ?? r.product_id}`, line: r.message }))
      : x.outbox.filter((r) => r.status === 'open').map((r) => ({ title: `Waiting on ${r.to_name ?? r.to_org}: ${r.product ?? r.product_id}`, line: r.message }))
  const monday = mondayOf(x.now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const parts = [`${open.length} ${open.length === 1 ? 'decision' : 'decisions'} waiting`, results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'} in` : null, requests.length ? `${requests.length} evidence ${requests.length === 1 ? 'request' : 'requests'}` : null].filter(Boolean)
  return { subject: `Proof · ${x.orgName}: ${parts.join(', ')}`, monday, waiting: open.slice(0, 5), waitingN: open.length, results, requests, range: x.range }
}

/** "Measured 40 → 43 · Collecting 21 → 19" (only the statuses that hold something). */
export function coverageChange(then: Coverage, now: Coverage): string {
  const keys: [keyof Coverage, string][] = [
    ['measured', 'Measured'],
    ['collecting', 'Collecting'],
    ['no_users', 'No users yet'],
    ['unrecognised', 'Not recognised'],
  ]
  return keys
    .filter(([k]) => then[k] || now[k])
    .map(([k, label]) => `${label} ${int(then[k])} → ${int(now[k])}`)
    .join(' · ')
}

/** The digest as Markdown (downloaded from the preview; exports pass through the naming policy). */
export function digestMarkdown(g: Digest): string {
  const lines = [`# ${g.subject}`, '', `Preview of the digest for ${g.monday}. Not sent: this version has no email provider.`, '']
  lines.push(`## Decisions waiting (${g.waitingN})`, '')
  if (g.waiting.length) for (const c of g.waiting) lines.push(`- **${c.title}** ${c.figure} ${c.figureNote}${c.n !== null ? ` (n=${int(c.n)})` : ''}. ${c.trigger}`)
  else lines.push('- Nothing waits for a decision.')
  lines.push('', '## Results in', '')
  if (g.results.length) for (const r of g.results) lines.push(`- **${r.title}** ${r.line}`)
  else lines.push('- No new results this week.')
  lines.push('', '## Evidence requests', '')
  if (g.requests.length) for (const r of g.requests) lines.push(`- **${r.title}** ${r.line}`)
  else lines.push('- None open.')
  lines.push('', '## Range coverage', '')
  lines.push(g.range ? `- ${coverageChange(g.range.then, g.range.now)}` : '- No range connected yet.')
  lines.push('', '---', 'Proof by Willow. Observational, aggregate data; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.', '')
  return lines.join('\n')
}
