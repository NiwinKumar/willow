import { ArrowRight, BellOff, Check, CheckCircle2, Clock, Copy, Download, FileText, Inbox, Megaphone, MessageSquareText, MoreHorizontal, Send, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, type Campaign } from '../../../lib/api'
import { setQueryData } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { ProductImage } from '../../routine/productUi'
import { agoText } from '../autopilot'
import { DISMISS_REASONS, TYPE_LABEL, type CardAction, type CardKind, type DecisionCard } from '../decisions'
import { askAboutCard, KIND_ICON, vt } from './cardModel'
import { useOrg } from '../org'
import { setRequests, withTransition } from '../orgData'
import { isNotMember, proofApi, proofError, type EvidenceRequest } from '../proofApi'
import { sectionPath, useRetailState } from '../state'
import { Button, copyText, downloadText, int, Menu, MenuItem, MenuLabel, SidePanel, useTooltip } from '../ui'

/*
 * Home's decision cards and lane items (sections/Home.tsx). A card: its type, the product, the trigger sentence,
 * the figure with n and interval, one primary action (filled) and at most one quiet secondary (a link or ghost).
 * Icons say what an action does: a brief opens a reading panel (FileText) with Copy and Download inside it; a
 * request sends (Send); a link goes (→). "Ask about this" opens Ask with a question about the card prefilled.
 */

export type Brief = { title: string; sub: string; file: string; body: string; onUsed?: () => void }
export type BriefOpener = (b: Brief) => void

function AskAbout({ onAsk, what }: { onAsk: () => void; what: string }) {
  const tip = useTooltip('Ask about this')
  return (
    <>
      <button type="button" {...tip.trigger} onClick={onAsk} aria-label={`Ask about: ${what}`} className="hit44 grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 opacity-70 transition-[opacity,background,color] hover:bg-pf-hover hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100">
        <MessageSquareText size={14} strokeWidth={1.7} aria-hidden />
      </button>
      {tip.node}
    </>
  )
}

/** A brief, read in a side panel before it is copied or saved (the action that used to download blind). */
export function BriefPanel({ brief, onClose }: { brief: Brief | null; onClose: () => void }) {
  const [last, setLast] = useState<Brief | null>(brief)
  if (brief && brief !== last) setLast(brief)
  const b = brief ?? last
  const used = () => {
    b?.onUsed?.()
  }
  return (
    <SidePanel
      open={Boolean(brief)}
      onClose={onClose}
      title={b?.title ?? 'Brief'}
      subtitle={b?.sub}
      width={560}
      labelledBy="proof-brief-title"
      footer={
        b ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind="primary"
              onClick={() => {
                void copyText(b.body, 'Brief copied').then((ok) => ok && used())
              }}
            >
              <Copy size={15} strokeWidth={1.7} aria-hidden /> Copy brief
            </Button>
            <Button
              onClick={() => {
                downloadText(b.file, b.body, 'text/markdown')
                used()
              }}
            >
              <Download size={15} strokeWidth={1.7} aria-hidden /> Download .md
            </Button>
            <span className="ml-auto text-proof-label text-ink-2">Copying or saving it marks the card as accepted.</span>
          </div>
        ) : null
      }
    >
      {b ? <pre className="m-0 whitespace-pre-wrap break-words font-geist text-proof-body text-ink [text-wrap:pretty]">{b.body}</pre> : null}
    </SidePanel>
  )
}

export function CardView({ c, index, canDecide, legacy, result = false, onDecide, onAsk, onBrief, lead = false, rail = false }: { c: DecisionCard; index: number; canDecide: boolean; legacy: boolean; result?: boolean; onDecide: (status: 'accepted' | 'dismissed' | 'snoozed', reason?: string) => void; onAsk?: (q: string) => void; onBrief: BriefOpener; lead?: boolean; rail?: boolean }) {
  const k = KIND_ICON[c.kind]
  const Icon = k.icon
  const ivTip = useTooltip(c.interval ?? '')
  return (
    <article style={{ ...vt(c.key), animationDelay: `${Math.min(index % 6, 5) * 40}ms` }} className={`group/card flex h-full min-w-0 flex-col gap-3 rounded-card border bg-surface p-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong animate-[proofPage_.28s_var(--ease-standard)_both] ${lead ? 'border-line-strong shadow-raised' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-ctl ${k.tone}`}>
          <Icon size={13} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate text-proof-small text-ink-2">{c.type}</span>
        {onAsk ? <AskAbout onAsk={() => onAsk(askAboutCard(c))} what={c.title} /> : null}
        {canDecide && !legacy ? <CardMenu onDecide={onDecide} /> : null}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        {c.product ? (
          <Link to={`/retail/products/${encodeURIComponent(c.product.id)}`} aria-hidden tabIndex={-1} className="shrink-0 overflow-hidden rounded-ctl border border-line bg-pf-bg2 p-0.5">
            <ProductImage product={{ image_url: c.product.image_url, category: c.product.category || 'serum', name: c.product.name }} size={32} decorative />
          </Link>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          {/* In Needs you's fixed slots the words clamp (2 + 3 lines, the whole text on hover); the board shows all. */}
          <h3 title={rail ? c.title : undefined} className={`m-0 text-proof-body font-medium text-ink [text-wrap:pretty] ${rail ? 'line-clamp-2' : ''}`}>{c.title}</h3>
          <p title={rail ? c.trigger : undefined} className={`m-0 text-proof-small text-ink-2 [text-wrap:pretty] ${rail ? 'line-clamp-3' : ''}`}>{c.trigger}</p>
        </div>
      </div>
      {c.effect ? (
        // A range call's expected effect, with what it rests on: the decision's consequence, never a projection beyond the rows.
        <div className="flex flex-col gap-1 rounded-ctl bg-sunken px-3 py-2.5">
          <p title={rail ? c.effect.text : undefined} className={`m-0 text-proof-small text-ink [text-wrap:pretty] ${rail ? 'line-clamp-2' : ''}`}>
            <span className="font-medium">Expected effect.</span> {c.effect.text}
          </p>
          {rail ? null : <p className="m-0 text-proof-label text-ink-2 [text-wrap:pretty]">{c.effect.basis}</p>}
        </div>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum">{c.figure}</span>
        <span className="text-proof-small text-ink-2">{c.figureNote}</span>
        <span className="ml-auto flex items-center gap-2 text-proof-label text-ink-2 tnum">
          {c.n !== null ? <span>n={int(c.n)}</span> : null}
          {c.interval ? (
            <>
              <span {...ivTip.trigger} tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-2">
                interval
              </span>
              {ivTip.node}
            </>
          ) : null}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <ActionButton a={c.primary} c={c} primary canDecide={canDecide} onAccept={() => onDecide('accepted')} result={result} onBrief={onBrief} />
        {c.secondary ? <ActionButton a={c.secondary} c={c} canDecide={canDecide} onAccept={() => onDecide('accepted', 'evidence requested')} result={result} onBrief={onBrief} quiet /> : null}
      </div>
    </article>
  )
}

/** Dismiss (with a reason) and Snooze for a week. */
export function CardMenu({ onDecide }: { onDecide: (status: 'dismissed' | 'snoozed', reason?: string) => void }) {
  return (
    <Menu label="More: snooze or dismiss" align="right" width={240} triggerClass="hit44 grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 hover:bg-pf-hover hover:text-ink" trigger={<MoreHorizontal size={15} strokeWidth={1.7} aria-hidden />}>
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              close()
              onDecide('snoozed', 'snoozed for 7 days')
              toast('Snoozed for a week')
            }}
          >
            <BellOff size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> Snooze for a week
          </MenuItem>
          <MenuLabel>Dismiss because…</MenuLabel>
          {DISMISS_REASONS.map((r) => (
            <MenuItem
              key={r}
              onClick={() => {
                close()
                onDecide('dismissed', r)
                toast(`Dismissed · ${r}`)
              }}
            >
              <X size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> {r}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

function ActionButton({ a, c, primary = false, canDecide, onAccept, result, onBrief, quiet = false }: { a: CardAction; c: DecisionCard; primary?: boolean; canDecide: boolean; onAccept: () => void; result: boolean; onBrief: BriefOpener; quiet?: boolean }) {
  const navigate = useNavigate()
  const { carry } = useRetailState()
  const { org, orgs } = useOrg()
  const { getIdToken } = useAuth()
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const kind = primary ? 'primary' : 'secondary'
  // The primary action decides (accepts) and does the thing; a secondary link only opens the evidence.
  const run = async () => {
    if (a.kind === 'link') {
      if (primary && canDecide) onAccept()
      navigate(a.to)
      return
    }
    if (a.kind === 'accept') {
      onAccept()
      toast(result ? 'Noted · moved to the log' : `Accepted · ${c.title}`)
      return
    }
    if (a.kind === 'brief') {
      // A brief is read first (a side panel with Copy and Download), not dropped into Downloads unseen.
      onBrief({ title: a.label, sub: c.title, file: a.file, body: a.body, onUsed: canDecide ? onAccept : undefined })
      return
    }
    if (a.kind === 'request') {
      const to = orgs.find((o) => o.kind === 'brand' && o.brands.includes(a.brand))
      if (!org || !to) return
      setBusy(true)
      try {
        const t = await getIdToken()
        const sent = await proofApi.sendRequest(t, org.id, { to_org: to.id, product_id: a.productId, message: a.message, snapshot: { title: c.title.slice(0, 200), figure: `${c.figure} ${c.figureNote}`.slice(0, 120), n: c.n } })
        withTransition(() => setRequests(org.id, (v) => ({ inbox: v?.inbox ?? [], outbox: [sent, ...(v?.outbox ?? []).filter((x) => x.id !== sent.id)] })))
        onAccept()
        toast(`Evidence request sent to ${to.name}`)
      } catch (e) {
        toast.error(proofError(e, 'send the request'))
      } finally {
        setBusy(false)
      }
      return
    }
    if (a.kind === 'autopilot') {
      if (!user) return
      setBusy(true)
      try {
        const t = await getIdToken()
        const v = await api.autopilotAct(t, a.activityId, a.act)
        setQueryData(['autopilot', user.uid], { rules: v.rules, activity: v.activity })
        if (a.act === 'approve') {
          onAccept()
          toast(v.campaign_id ? 'Approved · the campaign has started' : (v.outcome ?? 'Approved'))
        } else toast('Declined')
      } catch (e) {
        if (isNotMember(e)) toast.error('AutoCampaign needs an analyst or admin', { description: 'Approving starts a campaign, so it needs a role that can act for an organisation.', action: { label: 'Choose how to explore', onClick: () => navigate(`/retail${carry}${carry ? '&' : '?'}choose=1`) } })
        else toast.error(proofError(e, a.act === 'approve' ? 'approve the proposal' : 'decline the proposal'))
      } finally {
        setBusy(false)
      }
    }
  }
  // The icon says what the action does: a brief opens to read, a request sends; links just go.
  const icon = a.kind === 'brief' ? <FileText size={14} strokeWidth={1.7} aria-hidden /> : a.kind === 'request' ? <Send size={14} strokeWidth={1.7} aria-hidden /> : a.kind === 'accept' && primary ? <Check size={14} strokeWidth={1.8} aria-hidden /> : null
  const needsRole = (a.kind === 'accept' || a.kind === 'request' || a.kind === 'autopilot') && !canDecide
  if (quiet && a.kind === 'link')
    return (
      <Link to={a.to} className="hit44 inline-flex h-8 items-center gap-1 rounded-ctl px-1.5 text-proof-small text-ink-2 no-underline transition-colors hover:text-ink">
        {a.label}
      </Link>
    )
  return (
    <Button size="sm" kind={quiet ? 'ghost' : kind} onClick={() => void run()} disabled={busy || needsRole} title={needsRole ? 'Viewers can read; an analyst or admin decides' : undefined}>
      {icon}
      {busy ? 'Working…' : a.label}
      {a.kind === 'link' && primary ? <ArrowRight size={14} strokeWidth={1.7} aria-hidden className="transition-transform duration-150 group-hover/card:translate-x-0.5" /> : null}
    </Button>
  )
}

export function ProgressItem({ vkey, kind, title, figure, n, meta, waiting, actions, sub, done = false }: { vkey: string; kind: CardKind | null; title: string; figure: string; n: number | null; meta: string; waiting?: string; actions?: ReactNode; sub?: string; done?: boolean }) {
  return (
    <article style={vt(vkey)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 animate-[proofPage_.28s_var(--ease-standard)_both]">
      <div className="flex items-center gap-2 text-proof-small text-ink-2">
        {done ? <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden className="text-proof-leaf" /> : <Clock size={14} strokeWidth={1.8} aria-hidden className="text-pf-amber" />}
        <span className="truncate">{kind ? TYPE_LABEL[kind] : 'Decision'}</span>
      </div>
      <h3 className="m-0 text-proof-body font-medium text-ink [text-wrap:pretty]">{title}</h3>
      {sub ? <p className="m-0 text-proof-small text-ink-2">{sub}</p> : null}
      {figure ? (
        <p className="m-0 text-proof-small text-ink-2 tnum">
          <span className="font-medium text-ink">{figure}</span>
          {n !== null ? ` · n=${int(n)}` : ''}
        </p>
      ) : null}
      <p className="m-0 text-proof-label text-ink-2">{meta}</p>
      {waiting && !done ? (
        <p className="m-0 rounded-ctl bg-pf-bg2 px-2.5 py-1.5 text-proof-small text-ink-2">
          <span className="font-medium text-ink">Waiting for</span> {waiting.charAt(0).toLowerCase() + waiting.slice(1)}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </article>
  )
}

export function LiveCampaign({ c, carry }: { c: Campaign; carry: string }) {
  const [now] = useState(() => Date.now())
  const start = Date.parse(c.starts_at)
  const day = Math.min(c.days, Math.max(1, Math.ceil((now - start) / 86_400_000)))
  return (
    <Link to={`${sectionPath('campaigns', c.id)}${carry}`} style={vt(`camp-${c.id}`)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 no-underline transition-colors hover:bg-pf-hover animate-[proofPage_.28s_var(--ease-standard)_both]">
      <span className="flex items-center gap-2 text-proof-small text-ink-2">
        <Megaphone size={14} strokeWidth={1.8} aria-hidden className="text-pf-amber" /> Campaign live · day {day} of {c.days}
      </span>
      <span className="text-proof-body font-medium text-ink">{c.product ?? c.product_id}</span>
      <span className="text-proof-small text-ink-2 tnum">
        {int(c.stats.reach ?? c.stats.impressions)} reached · {int(c.stats.adds)} adds
      </span>
      <span className="rounded-ctl bg-pf-bg2 px-2.5 py-1.5 text-proof-small text-ink-2">
        <span className="font-medium text-ink">Waiting for</span> 10 people in each group, then the lift against the holdout
      </span>
    </Link>
  )
}

export function AnswerItem({ r, from }: { r: EvidenceRequest; from: string }) {
  return (
    <article style={vt(`ans-${r.id}`)} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 animate-[proofPage_.28s_var(--ease-standard)_both]">
      <span className="flex items-center gap-2 text-proof-small text-ink-2">
        <Inbox size={14} strokeWidth={1.8} aria-hidden className={r.status === 'answered' ? 'text-proof-leaf' : 'text-ink-2'} />
        {r.status === 'answered' ? `${from} answered` : `${from} declined`} · {agoText(r.updated_at ?? r.created_at)}
      </span>
      <span className="text-proof-body font-medium text-ink">{r.product ?? r.product_id}</span>
      {r.reply ? <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink [text-wrap:pretty]">“{r.reply}”</p> : null}
      <Link to={`/retail/products/${encodeURIComponent(r.product_id)}`} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
        Re-read the evidence →
      </Link>
    </article>
  )
}

