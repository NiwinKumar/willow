/**
 * Parser for the advisor's tiny inline markup (api/app/advisor_blocks.py): **bold**, ==highlight==,
 * [product:ID] and [metric:ID]. Anything else is plain text, so a stray "*" or "[" shows as typed.
 */
import type { MetricId } from '../../data/types'
import { METRIC_META } from '../../lib/metrics'

const TOKEN = /\[(product|metric):([A-Za-z0-9_.-]{1,120})\]/y

export type MarkupNode = { kind: 'text'; text: string } | { kind: 'bold'; children: MarkupNode[] } | { kind: 'mark'; children: MarkupNode[] } | { kind: 'product'; id: string } | { kind: 'metric'; id: string }

export function parse(src: string): MarkupNode[] {
  const out: MarkupNode[] = []
  let text = ''
  let i = 0
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '**' || two === '==') {
      const end = src.indexOf(two, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ kind: two === '**' ? 'bold' : 'mark', children: parse(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (src[i] === '[') {
      TOKEN.lastIndex = i
      const m = TOKEN.exec(src)
      if (m) {
        flush()
        out.push({ kind: m[1] as 'product' | 'metric', id: m[2] })
        i = TOKEN.lastIndex
        continue
      }
    }
    text += src[i]
    i++
  }
  flush()
  return out
}

export const metricLabel = (id: string) => (id in METRIC_META ? METRIC_META[id as MetricId].label : null)

/** The words without markup (copying an answer). */
export function plainText(src: string, productName: (id: string) => string | null): string {
  const walk = (nodes: MarkupNode[]): string =>
    nodes.map((n) => (n.kind === 'text' ? n.text : n.kind === 'product' ? (productName(n.id) ?? 'this product') : n.kind === 'metric' ? (metricLabel(n.id)?.toLowerCase() ?? n.id.replace(/_/g, ' ')) : walk(n.children))).join('')
  return walk(parse(src))
}
