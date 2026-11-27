import { ArrowLeft, Download, Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { composeDigest, coverageChange, digestMarkdown, type DigestLine } from '../digest'
import { useDataTo } from '../freshness'
import { useHomeCards } from '../homeData'
import { useOrg } from '../org'
import { coverage, statusOf } from '../range'
import { purposeOf, sectionPath, useRetailState } from '../state'
import type { Insights } from '../types'
import { Badge, Bone, Button, downloadText, int } from '../ui'
import { InsightsGate } from './shared'

/*
 * Weekly digest preview (/retail/digest, from Home): what the organisation's admins and analysts would receive
 * each Monday: decisions waiting, results in, evidence requests and the range's coverage since the item file was
 * connected. Composed from the same cards as Home (homeData.ts, digest.ts). Clearly a preview: sending needs an
 * email provider, which this version does not have, so nothing is sent.
 */

export default function Digest() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-6">
          <Bone className="h-7 w-56" />
          <Bone className="h-[420px] w-full rounded-card" />
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Body({ d }: { d: Insights }) {
  const { carry } = useRetailState()
  const { org } = useOrg()
  const { mix, rows, prodState, decisions, requests, range, cards } = useHomeCards(d)
  const to = useDataTo(d)
  const [now] = useState(() => Date.now())
  const byId = useMemo(() => new Map(rows.map((r) => [r.product_id, r])), [rows])
  const rangeChange = useMemo(() => {
    if (!range || !rows.length) return null
    const then = coverage(range.rows)
    const now = coverage(range.rows.map((r) => ({ match: r.match, status: r.match && byId.get(r.match) ? statusOf(byId.get(r.match)!) : r.status })))
    return { then, now, since: range.at || null }
  }, [range, rows, byId])
  const g = useMemo(
    () => composeDigest({ orgName: org?.name ?? 'your organisation', kind: mix, cards, items: decisions.data?.items ?? {}, inbox: requests.data?.inbox ?? [], outbox: requests.data?.outbox ?? [], range: rangeChange, now }),
    [org, mix, cards, decisions.data, requests.data, rangeChange, now],
  )
  const loading = prodState.status === 'loading'
  const home = `${sectionPath('home')}${carry}`

  return (
    <div className="flex flex-col gap-6">
      <Link to={home} className="inline-flex h-6 w-fit items-center gap-1.5 text-proof-small text-ink-2 no-underline hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.6} aria-hidden /> Home
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-[760px] flex-col gap-1">
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-proof-title text-ink">
            Weekly digest <Badge tone="amber">Preview · not sent</Badge>
          </h1>
          <p className="m-0 text-proof-body text-ink-2">
            What the admins and analysts of {org?.name ?? 'your organisation'} would receive on <strong className="font-medium text-ink">{g.monday}</strong>. This version has no email provider, so nothing is sent; every line below is live from Home.
          </p>
          <p className="m-0 pt-0.5 text-proof-small text-ink-2">{purposeOf('digest')}</p>
        </div>
        <Button onClick={() => downloadText('proof-weekly-digest.md', digestMarkdown(g), 'text/markdown')} disabled={loading}>
          <Download size={15} strokeWidth={1.7} aria-hidden /> Download
        </Button>
      </header>

      <article aria-label="Digest preview" className="mx-auto flex w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-line bg-surface animate-[proofPage_.28s_var(--ease-standard)_both]">
        <div className="flex flex-col gap-1 border-b border-line bg-pf-bg2 px-5 py-4 text-proof-small text-ink-2">
          <span className="flex items-center gap-2">
            <Mail size={14} strokeWidth={1.7} aria-hidden /> Proof by Willow · every Monday, 08:00
          </span>
          <span className="text-proof-body font-medium text-ink [text-wrap:pretty]">{loading ? 'Composing…' : g.subject}</span>
          {to ? <span>{to.label} · aggregates only; groups under 10 people hidden</span> : null}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3 p-5">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-4 w-2/3" />
            <Bone className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <Block title={`Decisions waiting · ${g.waitingN}`} empty="Nothing waits for a decision.">
              {g.waiting.map((c) => (
                <Item key={c.key} title={c.title} line={`${c.figure} ${c.figureNote}${c.n !== null ? ` · n=${int(c.n)}` : ''}`} sub={c.type} />
              ))}
              {g.waitingN > g.waiting.length ? <li className="text-proof-small text-ink-2">and {g.waitingN - g.waiting.length} more on Home</li> : null}
            </Block>
            <Block title="Results in" empty="No new results this week.">
              {g.results.map((r, i) => (
                <Line key={i} r={r} />
              ))}
            </Block>
            <Block title={mix === 'brand' ? 'Evidence requests for you' : 'Evidence requests waiting on brands'} empty="None open.">
              {g.requests.map((r, i) => (
                <Line key={i} r={r} />
              ))}
            </Block>
            <Block title="Range coverage" empty={mix === 'brand' ? 'The retailer hasn’t connected an item file yet.' : 'No range connected yet: connect your item file to see coverage change week to week.'}>
              {g.range ? <Item title={`${int(g.range.now.measured)} of ${int(g.range.now.total)} products measured`} line={coverageChange(g.range.then, g.range.now)} sub={g.range.since ? `Since the item file was connected, ${new Date(g.range.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Since the item file was connected'} /> : null}
            </Block>
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
              <Button kind="primary" to={home}>
                Open Home
              </Button>
              <span className="text-proof-small text-ink-2">The email would link each line to its card.</span>
            </div>
          </>
        )}
      </article>
      <p className="m-0 text-center text-proof-small text-ink-2">Production path: a weekly scheduled job renders this same view for each organisation and sends it; each person can switch it off.</p>
    </div>
  )
}

function Block({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const kids = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  return (
    <section className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-b-0">
      <h2 className="m-0 text-proof-h text-ink">{title}</h2>
      {kids.length ? <ul className="m-0 flex list-none flex-col gap-3 p-0">{children}</ul> : <p className="m-0 text-proof-small text-ink-2">{empty}</p>}
    </section>
  )
}

function Item({ title, line, sub }: { title: string; line: string; sub?: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      {sub ? <span className="text-proof-label text-ink-2">{sub}</span> : null}
      <span className="text-proof-body font-medium text-ink [text-wrap:pretty]">{title}</span>
      <span className="text-proof-small text-ink-2 tnum [text-wrap:pretty]">{line}</span>
    </li>
  )
}

const Line = ({ r }: { r: DigestLine }) => <Item title={r.title} line={r.line} />
