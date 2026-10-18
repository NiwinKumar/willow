import type { ProductDetail as Detail } from '../types'
import { int, MIN_GROUP, pct } from '../ui'
import { FlowChart, type FlowNode, type FlowTone } from '../ui/widgets'

/*
 * The product journey (/retail/products/:id#journey): one flow from trying the product to how it feels, with the
 * non-users with the same goals as one group from the market (no outcome split: that comparison is in the
 * outcome figures), on the api's `journey` (retail_intel._journey). Each group splits once into its own
 * parts, so every band is a real count of people; a part under 10 people is left out and its group shows a dashed
 * stub. "How it feels" is self-reported and never part of the Proof tier.
 */

const TONE: Record<string, FlowTone> = {
  used: 'lead',
  non: 'mute',
  w8: 'lead',
  early: 'ghost',
  change: 'good',
  none: 'warn',
  early_using: 'lead',
  early_stopped: 'warn',
  ch_kept: 'good',
  ch_stopped: 'warn',
  no_kept: 'lead',
  no_stopped: 'warn',
  ch_working: 'good',
  ch_mixed: 'mixed',
  ch_quiet: 'mute',
  no_working: 'good',
  no_mixed: 'mixed',
  no_quiet: 'mute',
}

export function ProductJourney({ x, weeksN, className = '' }: { x: Detail; weeksN: number; className?: string }) {
  const j = x.journey
  if (!j || j.nodes.length < 2) return null
  const nodes: FlowNode[] = j.nodes.map((n) => ({ id: n.id, col: n.col, label: n.id === 'non' ? 'Not using it' : n.label, sub: n.id === 'non' ? 'Market · same goals' : undefined, n: n.n, more: n.more, tone: TONE[n.id] ?? 'mute' }))
  const byId = new Map(j.nodes.map((n) => [n.id, n]))
  const n = (id: string) => byId.get(id)?.n ?? null
  const of = (a: number, b: number) => `${int(a)} of ${int(b)} (${pct(a / b)})`

  const SAY: Record<string, (me: number, p: number) => string> = {
    w8: (me, p) => `${of(me, p)} people who tried it have reached the week-${weeksN} reading.`,
    early: (me, p) => `${of(me, p)} people who tried it have fewer than ${weeksN} weeks of readings so far.`,
    change: (me, p) => `${of(me, p)} people who reached week ${weeksN} saw a visible change in what it targets.`,
    none: (me, p) => `${of(me, p)} people who reached week ${weeksN} saw no visible change yet.`,
    early_using: (me, p) => `${of(me, p)} people not yet at week ${weeksN} are still using it.`,
    early_stopped: (me, p) => `${of(me, p)} people not yet at week ${weeksN} have stopped using it.`,
    ch_kept: (me, p) => `${of(me, p)} people who saw a change were still using it at week ${weeksN}.`,
    ch_stopped: (me, p) => `${of(me, p)} people who saw a change had stopped using it by week ${weeksN}.`,
    no_kept: (me, p) => `${of(me, p)} people who saw no change were still using it at week ${weeksN}.`,
    no_stopped: (me, p) => `${of(me, p)} people who saw no change had stopped using it by week ${weeksN}.`,
  }
  const feelSay = (word: string) => (me: number, p: number) => `${of(me, p)} people still using it ${word}.`
  for (const head of ['ch', 'no']) {
    SAY[`${head}_working`] = feelSay('said “It’s working for me”')
    SAY[`${head}_mixed`] = feelSay('said they are not sure yet or it is not for them')
    SAY[`${head}_quiet`] = feelSay('have not said how it feels')
  }

  const used = n('used')
  const w8 = n('w8')
  const change = n('change')
  const summary =
    used && w8 && change
      ? `${int(used)} people tried it; ${int(w8)} reached week ${weeksN}, and ${int(change)} of them (${pct(change / w8)}) saw a visible change. Point at any group to follow its path.`
      : used
        ? `${int(used)} people tried it. Point at any group to follow its path.`
        : 'Point at any group to follow its path.'

  return (
    <section id="journey" aria-label="Product journey" className={`flex min-w-0 flex-col ${className}`}>
      <FlowChart
        title="From trying it to how it feels"
        columns={['Started', `Week ${weeksN} reading`, 'Outcome', `Still using?`, 'How it feels']}
        nodes={nodes}
        links={j.links}
        summary={summary}
        describe={(node, parent) => (parent && SAY[node.id] ? SAY[node.id](node.n, parent.n) : node.id === 'used' ? `${int(node.n)} people tried it.` : node.id === 'non' ? `${int(node.n)} people with the same goals who are not using it, from the market. Their outcome is in the figures above.` : `${node.label}: ${int(node.n)} people.`)}
        legend={[
          { tone: 'good', label: 'Visible change, still using, working for them' },
          { tone: 'warn', label: 'No visible change or stopped' },
          { tone: 'mixed', label: 'Not sure or not for me' },
          { tone: 'ghost', label: `Not at week ${weeksN} yet` },
          { tone: 'mute', label: 'No answer, or not using it' },
        ]}
        footnote={<>Each person is counted once. A dashed stub marks a part under {MIN_GROUP} people, left out so none can be worked out. “Still using” is at the week-{weeksN} reading; how it feels is self-reported and not part of the Proof tier. Willow does not track repeat purchases.</>}
        ariaLabel={`Product journey: ${summary}`}
      />
    </section>
  )
}
