import { Send } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '../../../lib/useAuth'
import { agoText } from '../autopilot'
import { kindOfKey, STATUS_WORD, TYPE_LABEL } from '../decisions'
import { useOrg } from '../org'
import { setRequests, withTransition } from '../orgData'
import { canAct, proofApi, proofError, ROLE_LABEL, type DecisionLogEntry, type EvidenceRequest } from '../proofApi'
import { Badge, Bone, Button, EmptyState, int, Panel, Tabs } from '../ui'

/* Evidence requests between the retailer and its brands, and the organisation's decision log (Home). */

const orgName = (orgs: { id: string; name: string }[], id: string) => orgs.find((o) => o.id === id)?.name ?? id

export function Requests({ inbox, outbox, loading, className }: { inbox: EvidenceRequest[]; outbox: EvidenceRequest[]; loading: boolean; className?: string }) {
  const { org, orgs } = useOrg()
  const [tab, setTab] = useState<'inbox' | 'sent'>(org?.kind === 'brand' || (inbox.length > 0 && !outbox.length) ? 'inbox' : 'sent')
  const list = tab === 'inbox' ? inbox : outbox
  return (
    <Panel
      title="Evidence requests"
      id="requests-h"
      className={className}
      description={org?.kind === 'brand' ? 'The retailer asks for evidence before a range review; answer here and it lands on their Home.' : 'Ask a brand for evidence from a card; their answer lands in Results.'}
      flush
    >
      <div className="px-5">
        <Tabs
          label="Requests"
          value={tab}
          onChange={setTab}
          panelId="requests-panel"
          tabs={[
            { id: 'inbox', label: 'Inbox', count: inbox.filter((r) => r.status === 'open').length },
            { id: 'sent', label: 'Sent', count: outbox.length },
          ]}
        />
      </div>
      <div id="requests-panel" role="tabpanel" className="flex flex-col">
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-4 w-1/2" />
          </div>
        ) : list.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((r) => (
              <RequestRow key={r.id} r={r} incoming={tab === 'inbox'} other={(tab === 'inbox' ? r.from_name : r.to_name) ?? orgName(orgs, tab === 'inbox' ? r.from_org : r.to_org)} />
            ))}
          </ul>
        ) : (
          <EmptyState compact title={tab === 'inbox' ? 'No requests for you' : 'No requests sent'} body={tab === 'inbox' ? 'When the retailer asks for evidence on one of your products, it appears here.' : org?.kind === 'brand' ? 'Brands answer requests; the retailer sends them.' : 'Send one from an “Over-shelved, under-delivering” card.'} />
        )}
      </div>
    </Panel>
  )
}

function RequestRow({ r, incoming, other }: { r: EvidenceRequest; incoming: boolean; other: string }) {
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const answer = async (status: 'answered' | 'declined') => {
    if (!org) return
    setBusy(true)
    try {
      const t = await getIdToken()
      const next = await proofApi.answerRequest(t, org.id, r.id, { status, reply: reply.trim() || (status === 'declined' ? 'Declined' : '') })
      withTransition(() => setRequests(org.id, (v) => ({ inbox: (v?.inbox ?? []).map((x) => (x.id === r.id ? { ...x, ...next } : x)), outbox: v?.outbox ?? [] })))
      toast(status === 'answered' ? 'Answer sent' : 'Request declined')
    } catch (e) {
      toast.error(proofError(e, 'answer the request'))
    } finally {
      setBusy(false)
    }
  }
  const tone = r.status === 'answered' ? 'green' : r.status === 'declined' ? 'gray' : 'amber'
  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-proof-body font-medium text-ink">{r.product ?? r.product_id}</span>
        <Badge tone={tone}>{r.status === 'open' ? 'Waiting' : r.status === 'answered' ? 'Answered' : 'Declined'}</Badge>
        <span className="ml-auto text-proof-label text-ink-2">
          {incoming ? `From ${other}` : `To ${other}`} · {agoText(r.created_at)}
        </span>
      </div>
      <p className="m-0 text-proof-small text-ink-2 [text-wrap:pretty]">{r.message}</p>
      {r.snapshot?.figure ? (
        <p className="m-0 text-proof-label text-ink-2 tnum">
          At the time: {r.snapshot.figure}
          {r.snapshot.n !== null && r.snapshot.n !== undefined ? ` · n=${int(r.snapshot.n)}` : ''}
        </p>
      ) : null}
      {r.reply ? <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink">“{r.reply}”</p> : null}
      {incoming && r.status === 'open' && canAct(role) ? (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`reply-${r.id}`}>
            Your answer
          </label>
          <textarea id={`reply-${r.id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={600} placeholder="Your answer: what evidence you hold, a study date, or what you will change" className="w-full resize-y rounded-ctl border border-line bg-surface px-3 py-2 text-proof-small text-ink placeholder:text-ink-2 hover:border-line-strong" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" kind="primary" onClick={() => void answer('answered')} disabled={busy || reply.trim().length < 3}>
              <Send size={14} strokeWidth={1.7} aria-hidden /> Send answer
            </Button>
            <Button size="sm" kind="ghost" onClick={() => void answer('declined')} disabled={busy}>
              Decline
            </Button>
            <Link to={`/retail/products/${encodeURIComponent(r.product_id)}`} className="ml-auto self-center text-proof-small text-ink-2 no-underline hover:text-ink">
              Open the product’s proof →
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function DecisionLog({ log }: { log: DecisionLogEntry[] }) {
  if (!log.length) return <EmptyState compact title="No decisions yet" body="Accept, dismiss or snooze a card on Home and it is recorded here: who, when, and the numbers at the time." />
  const sorted = [...log].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {sorted.map((e, i) => {
        const kind = kindOfKey(e.key)
        return (
          <li key={`${e.key}-${e.at}-${i}`} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={e.status === 'accepted' || e.status === 'done' ? 'green' : e.status === 'dismissed' ? 'gray' : 'amber'}>{STATUS_WORD[e.status]}</Badge>
              <span className="text-proof-label text-ink-2">
                {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {e.by_role ? ` · ${ROLE_LABEL[e.by_role]}` : ''}
              </span>
            </span>
            <span className="text-proof-body font-medium text-ink">{e.snapshot?.title ?? (kind ? TYPE_LABEL[kind] : e.key)}</span>
            {e.snapshot?.figure ? (
              <span className="text-proof-small text-ink-2 tnum">
                {e.snapshot.figure}
                {e.snapshot.n !== null && e.snapshot.n !== undefined ? ` · n=${int(e.snapshot.n)}` : ''}
              </span>
            ) : null}
            {e.reason ? <span className="text-proof-small text-ink-2">Reason: {e.reason}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

