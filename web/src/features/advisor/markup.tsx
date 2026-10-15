/**
 * The advisor's tiny inline markup (api/app/advisor_blocks.py), parsed into React elements — never HTML:
 * **bold**, ==highlight==, [product:ID] (the product's name; opens its sheet) and [metric:ID] (the metric's
 * label; opens its detail). Anything else is plain text, so a stray "*" or "[" just shows as typed.
 */
import type { ReactNode } from 'react'

import type { MetricId } from '../../data/types'
import { metricLabel, parse, type MarkupNode } from './markupParse'

export type MarkupLinks = {
  productName: (id: string) => string | null
  onProduct: (id: string) => void
  onMetric: (id: MetricId) => void
}

export function Markup({ text, links }: { text: string; links: MarkupLinks }) {
  const render = (nodes: MarkupNode[], key = ''): ReactNode[] =>
    nodes.map((n, i) => {
      const k = `${key}${i}`
      if (n.kind === 'text') return n.text
      if (n.kind === 'bold')
        return (
          <strong key={k} className="font-semibold">
            {render(n.children, `${k}.`)}
          </strong>
        )
      if (n.kind === 'mark')
        return (
          <mark key={k} className="rounded-[6px] bg-cta/70 px-1 text-ink [box-decoration-break:clone]">
            {render(n.children, `${k}.`)}
          </mark>
        )
      if (n.kind === 'product') {
        const name = links.productName(n.id)
        if (!name) return <span key={k}>this product</span>
        return (
          <button key={k} type="button" onClick={() => links.onProduct(n.id)} className="inline rounded-[6px] bg-sky/10 px-1 text-left font-medium text-[#1B3FA8] underline decoration-sky/40 underline-offset-2 hover:bg-sky/20">
            {name}
          </button>
        )
      }
      const label = metricLabel(n.id)
      if (!label) return <span key={k}>{n.id.replace(/_/g, ' ')}</span>
      return (
        <button key={k} type="button" onClick={() => links.onMetric(n.id as MetricId)} className="inline font-medium underline decoration-ink/30 decoration-dotted underline-offset-[3px] hover:decoration-ink">
          {label.toLowerCase()}
        </button>
      )
    })
  return <>{render(parse(text))}</>
}
