import { Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAuth } from '../../../lib/useAuth'
import { useOrg } from '../org'
import { setRequests, useRequests, withTransition } from '../orgData'
import { canAct, proofApi, proofError } from '../proofApi'
import type { ProductDetail } from '../types'
import { Button, int, pct, pts, SidePanel, TIERS } from '../ui'

/**
 * "Ask <brand> for evidence" on a product page (retailer organisations, when the product's brand has an
 * organisation on this instance): a message with the numbers as they are now, sent to the brand's inbox
 * (POST /v1/proof/orgs/{org}/requests). The brand answers on its Home; the answer lands in the retailer's Results.
 */
export function RequestEvidence({ x }: { x: ProductDetail }) {
  const { org, orgs, role } = useOrg()
  const { getIdToken } = useAuth()
  const requests = useRequests()
  const p = x.product
  const to = orgs.find((o) => o.kind === 'brand' && o.brands.includes(p.brand))
  const figure = p.rate !== null ? `${pct(p.rate)} saw a visible change${p.lift !== null ? `, ${pts(p.lift)} over non-users` : ''}` : TIERS[p.tier].label
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(() => `Before our next range review, can you share the evidence you hold for ${p.product}? In Proof it reads ${TIERS[p.tier].label.toLowerCase()}${p.n ? `: ${figure} (${int(p.n)} people at week 8)` : ''}.`)
  const [busy, setBusy] = useState(false)
  if (!org || org.kind !== 'retailer' || !to || !canAct(role)) return null
  const pending = (requests.data?.outbox ?? []).some((r) => r.product_id === p.product_id && r.status === 'open')
  const send = async () => {
    setBusy(true)
    try {
      const sent = await proofApi.sendRequest(await getIdToken(), org.id, { to_org: to.id, product_id: p.product_id, message: message.trim(), snapshot: { title: `${p.product}: evidence requested`.slice(0, 200), figure: figure.slice(0, 120), n: p.n } })
      withTransition(() => setRequests(org.id, (v) => ({ inbox: v?.inbox ?? [], outbox: [sent, ...(v?.outbox ?? [])] })))
      toast(`Sent to ${to.name}; their answer lands on your Home`)
      setOpen(false)
    } catch (e) {
      toast.error(proofError(e, 'send the request'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={pending} title={pending ? `A request to ${to.name} is waiting for an answer` : undefined}>
        <Send size={15} strokeWidth={1.6} aria-hidden /> {pending ? 'Evidence requested' : `Ask ${p.brand}`}
      </Button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title={`Ask ${to.name} for evidence`}
        subtitle={p.product}
        width={480}
        labelledBy="proof-request-title"
        footer={
          <div className="flex justify-end gap-2">
            <Button kind="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => void send()} disabled={busy || message.trim().length < 10}>
              <Send size={15} strokeWidth={1.6} aria-hidden /> {busy ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-proof-small text-ink-2">The brand sees your message, the product and the numbers below as they are today. It never sees your other decisions, your stock file or other brands’ requests.</p>
          <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink tnum">
            {figure}
            {p.n ? ` · n=${int(p.n)}` : ''}
          </p>
          <label htmlFor="req-msg" className="text-proof-small font-medium text-ink">
            Message
          </label>
          <textarea id="req-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={1000} className="w-full resize-y rounded-ctl border border-line bg-surface px-3 py-2 text-proof-body text-ink hover:border-line-strong" />
        </div>
      </SidePanel>
    </>
  )
}
