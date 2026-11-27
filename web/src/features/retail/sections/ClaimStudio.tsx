import { BookmarkPlus, Check, CheckCircle2, Copy, Lock } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, api } from '../../../lib/api'
import { useAuth } from '../../../lib/useAuth'
import { useOrg } from '../org'
import { setClaims, useSavedClaims, withTransition } from '../orgData'
import { canAct, claimCohortText, proofApi, proofError, type SavedClaim } from '../proofApi'
import { ANCHOR, CHANNELS, CLAIM_TIERS, channelLabel, sourceLabel } from '../proofAi'
import type { ClaimChannel, Claims, ClaimSource, Filters, ProductDetail } from '../types'
import { exportBlock } from '../evidencePack'
import { Badge, Bone, Button, copyText, EmptyState, int, Panel, Segmented, useTooltip } from '../ui'

/*
 * "Claim drafts" on the product page (POST /v1/retailer/products/{id}/claims): marketing copy for one channel,
 * written by Gemini only from the claim-ready statements (and, labelled, what users said). Each draft cites its
 * statements (chips; hover or tap shows the statement) and was checked by the api: numbers only from what it
 * cites, no overclaims, self-reported never written as measured. It costs a Gemini call, so it runs on the
 * button only; once run, changing the channel drafts again. Results are kept per channel for the visit.
 */

const BLOCKED_TEXT = 'Claims need a Proven or Promising product: the evidence does not show a visible change above non-users yet.'
const CHECKED_LINE = 'Every draft cites its evidence; numbers, overclaims (“clinically proven”, condition names) and self-reported wording are checked before you see it.'

type Run = { status: 'loading'; channel: ClaimChannel } | { status: 'ready'; d: Claims } | { status: 'error'; title: string; message: string }

function errorOf(e: unknown): { title: string; message: string } {
  if (e instanceof ApiError) {
    if (e.status === 429) return { title: 'Daily limit reached', message: e.message || 'You have drafted claims 30 times today. Try again tomorrow.' }
    if (e.status === 401 || e.status === 403) return { title: 'Not signed in', message: 'Drafting needs a guest sign-in, which did not work. Reload the page and try again.' }
    if (e.status === 404) return { title: 'Product not found', message: 'This product is no longer in the catalog.' }
    if (e.status === 503) return { title: 'Drafting is unavailable', message: `${e.message ? `${e.message} ` : ''}The rest of the page is unaffected.` }
    return { title: 'No drafts', message: e.message || 'The drafts could not be made. Try again.' }
  }
  return { title: 'No drafts', message: 'Could not reach Willow. Check the connection and try again.' }
}

export function ClaimStudio({ x, filters, channel, onChannel, onNextSteps }: { x: ProductDetail; filters: Filters; channel: ClaimChannel; onChannel: (c: ClaimChannel) => void; onNextSteps: (() => void) | null }) {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const p = x.product
  const key = (c: ClaimChannel) => `${p.product_id}|${filters.cohort}|${filters.range}|${c}`
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [ran, setRan] = useState(false)
  const run = runs[key(channel)]
  // Other tiers show the api's reason without a call (it would answer `blocked`).
  const claimable = CLAIM_TIERS.includes(p.tier) && x.evidence.length > 0

  // A run is marked loading (from the button, or a channel change after the first run); the effect sends it.
  const queue = (r: Record<string, Run>, c: ClaimChannel) => (r[key(c)]?.status === 'loading' ? r : { ...r, [key(c)]: { status: 'loading' as const, channel: c } })
  const draft = (c: ClaimChannel) => {
    setRan(true)
    setRuns((r) => queue(r, c))
  }
  // After the first run, a new channel (picked here or by a next step) drafts again, once per channel.
  const [seen, setSeen] = useState(channel)
  if (seen !== channel) {
    setSeen(channel)
    if (ran && claimable && !runs[key(channel)]) setRuns((r) => queue(r, channel))
  }
  const sent = useRef(new Set<string>())
  useEffect(() => {
    const send = async (k: string, c: ClaimChannel) => {
      sent.current.add(k)
      let next: Run
      try {
        if (!user) await continueAsGuest()
        next = { status: 'ready', d: await api.retailerClaims(await getIdToken(), p.product_id, { channel: c, ...filters }) }
      } catch (e) {
        next = { status: 'error', ...errorOf(e) }
      }
      sent.current.delete(k)
      setRuns((r) => ({ ...r, [k]: next }))
    }
    for (const [k, r] of Object.entries(runs)) if (r.status === 'loading' && !sent.current.has(k)) void send(k, r.channel)
  }, [runs]) // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = !claimable ? BLOCKED_TEXT : run?.status === 'ready' ? run.d.blocked : null
  const caveat = (run?.status === 'ready' ? run.d.caveat : null) ?? x.evidence_caveat ?? null
  const loading = run?.status === 'loading'

  return (
    <Panel
      title="Claim drafts"
      id={ANCHOR.claims}
      description={blocked ? undefined : 'Copy for one channel, written by Gemini from the claim-ready statements above.'}
      footnote={
        blocked ? undefined : (
          <span className="flex flex-col gap-1">
            {caveat ? <span>{caveat}</span> : null}
            <span>{CHECKED_LINE}</span>
          </span>
        )
      }
    >
      {blocked ? (
        <EmptyState compact title="No claims for this product yet" body={blocked} secondary={onNextSteps ? { label: 'See next steps', onClick: onNextSteps } : undefined} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Channel" options={CHANNELS} value={channel} onChange={onChannel} />
            <Button onClick={() => draft(channel)} disabled={loading}>
              {loading ? 'Drafting…' : run?.status === 'ready' ? 'Draft again' : 'Draft claims'}
            </Button>
          </div>
          {exportBlock(x.cohort) ? (
            <p className="m-0 flex items-start gap-2 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink-2">
              <Lock size={14} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0" /> {exportBlock(x.cohort)} You can still draft, save and approve claims to review them.
            </p>
          ) : null}
          <div aria-live="polite" aria-busy={loading} className="flex flex-col">
            {!run ? (
              <p className="m-0 text-proof-body text-ink-2">
                Pick where the copy will appear, then draft. Each draft names the statements it rests on.
              </p>
            ) : run.status === 'loading' ? (
              <div role="status" aria-label={`Drafting ${channelLabel(channel).toLowerCase()} claims`} className="flex flex-col">
                {[0, 1, 2].map((i) => (
                  <div key={i} aria-hidden className="flex flex-col gap-2 border-b border-line py-3.5 first:pt-0 last:border-b-0">
                    <Bone className="h-3.5 w-[min(640px,95%)]" />
                    <Bone className="h-3.5 w-[min(420px,70%)]" />
                    <Bone className="h-5 w-32" />
                  </div>
                ))}
                <span className="pt-2 text-proof-small text-ink-2">Gemini is drafting and every draft is checked; this can take a few seconds.</span>
              </div>
            ) : run.status === 'error' ? (
              <div role="alert" className="flex flex-col gap-1 rounded-ctl border border-line bg-pf-bg2 px-4 py-3">
                <span className="text-proof-body font-medium text-ink">{run.title}</span>
                <span className="text-proof-small text-ink-2">{run.message}</span>
              </div>
            ) : (
              <Drafts d={run.d} x={x} filters={filters} />
            )}
          </div>
          <SavedList x={x} />
        </div>
      )}
    </Panel>
  )
}

/** The organisation's saved claims for this product: draft or approved, with export gated on the cohort. */
function SavedList({ x }: { x: ProductDetail }) {
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  const q = useSavedClaims()
  const [busy, setBusy] = useState<string | null>(null)
  if (!org) return null
  const list = (q.data ?? []).filter((c) => c.product_id === x.product.product_id)
  const approve = async (c: SavedClaim, status: 'draft' | 'approved') => {
    setBusy(c.id)
    try {
      const next = await proofApi.setClaim(await getIdToken(), org.id, c.id, status)
      withTransition(() => setClaims(org.id, (v) => (v ?? []).map((y) => (y.id === c.id ? { ...y, ...next } : y))))
      toast(status === 'approved' ? 'Claim approved' : 'Back to draft')
    } catch (e) {
      toast.error(proofError(e, 'change the claim'))
    } finally {
      setBusy(null)
    }
  }
  const exportIt = async (c: SavedClaim) => {
    setBusy(c.id)
    try {
      const r = await proofApi.exportClaim(await getIdToken(), org.id, c.id)
      await copyText(`${r.claim.text} (n=${r.claim.n ?? '—'}${r.claim.window ? `, ${r.claim.window}` : ''}, observational)`, 'Approved claim copied with its basis')
    } catch (e) {
      toast.error(proofError(e, 'export the claim'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-labelledby="saved-claims-h" className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 id="saved-claims-h" className="m-0 flex items-center gap-2 text-proof-body font-medium text-ink">
        Saved claims <Badge>{list.length}</Badge>
      </h3>
      {!list.length ? (
        <p className="m-0 text-proof-small text-ink-2">Save a draft to keep it for {org.name}; an analyst approves it. The pipeline’s “Claims ready” step turns green with the first saved claim.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 animate-[proofPage_.24s_var(--ease-standard)_both]">
              <p className="m-0 text-proof-body text-ink [text-wrap:pretty]">{c.text}</p>
              <span className="flex flex-wrap items-center gap-2 text-proof-label text-ink-2">
                <Badge tone={c.status === 'approved' ? 'green' : 'gray'}>{c.status === 'approved' ? 'Approved' : 'Draft'}</Badge>
                <span>{claimCohortText(c.cohort)}</span>
                {c.channel ? <span>· {channelLabel(c.channel as ClaimChannel)}</span> : null}
                {c.statements.length ? <span>· cites {c.statements.map(sourceLabel).join(', ')}</span> : null}
                <span className="ml-auto flex items-center gap-2">
                  {canAct(role) ? (
                    <Button size="sm" kind={c.status === 'approved' ? 'ghost' : 'secondary'} onClick={() => void approve(c, c.status === 'approved' ? 'draft' : 'approved')} disabled={busy === c.id}>
                      {c.status === 'approved' ? 'Back to draft' : (<><CheckCircle2 size={14} strokeWidth={1.7} aria-hidden /> Approve</>)}
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => void exportIt(c)} disabled={!c.exportable || c.status !== 'approved' || busy === c.id} title={!c.exportable ? (c.export_note ?? 'Claims from simulated data can’t be exported') : c.status !== 'approved' ? 'Approve it first' : undefined}>
                    {c.exportable ? <Copy size={14} strokeWidth={1.6} aria-hidden /> : <Lock size={14} strokeWidth={1.6} aria-hidden />} Export
                  </Button>
                </span>
              </span>
              {!c.exportable ? <span className="text-proof-label text-ink-2">{c.export_note ?? 'Claims from simulated data can’t be exported.'}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Drafts({ d, x, filters }: { d: Claims; x: ProductDetail; filters: Filters }) {
  const by = new Map(d.sources.map((s) => [s.id, s]))
  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only">
        {d.drafts.length} {d.drafts.length === 1 ? 'draft' : 'drafts'} for {channelLabel(d.channel).toLowerCase()}.
      </p>
      {d.source === 'statements' ? <p className="m-0 text-proof-small text-ink-2">Gemini was unavailable, so these are the checked evidence statements themselves.</p> : null}
      {d.drafts.length ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {d.drafts.map((dr, i) => (
            <DraftRow key={`${d.channel}-${i}`} text={dr.text} ids={dr.sources} channel={d.channel} x={x} filters={filters} sources={dr.sources.map((id) => by.get(id) ?? { id, kind: id, text: '', n: 0, measured: true })} />
          ))}
        </ol>
      ) : (
        <p className="m-0 text-proof-body text-ink-2">No draft passed the checks for this channel. Try another channel, or copy the statements above.</p>
      )}
    </div>
  )
}

function DraftRow({ text, sources, ids, channel, x, filters }: { text: string; sources: ClaimSource[]; ids: string[]; channel: ClaimChannel; x: ProductDetail; filters: Filters }) {
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  const saved = useSavedClaims()
  const [saving, setSaving] = useState(false)
  const isSaved = (saved.data ?? []).some((c) => c.product_id === x.product.product_id && c.text === text)
  const blockedCopy = exportBlock(x.cohort)
  const save = async () => {
    if (!org) return
    setSaving(true)
    try {
      // statements: only the measured statement ids it cites (self-reported sources are not evidence ids)
      const statements = ids.filter((id) => x.evidence.some((e) => e.id === id)).slice(0, 6)
      const c = await proofApi.saveClaim(await getIdToken(), org.id, { product_id: x.product.product_id, text, statements, cohort: filters.cohort, channel })
      withTransition(() => setClaims(org.id, (v) => [c, ...(v ?? []).filter((y) => y.id !== c.id)]))
      toast('Claim saved as a draft')
    } catch (e) {
      toast.error(proofError(e, 'save the claim'))
    } finally {
      setSaving(false)
    }
  }
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const id = useId()
  const shown = sources.find((s) => s.id === open)
  const copy = async () => {
    if (!(await copyText(text, 'Draft copied'))) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 max-w-[72ch] text-proof-body text-ink [text-wrap:pretty]">{text}</p>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-proof-label text-ink-2">Cites</span>
          {sources.map((s) => (
            <SourceChip key={s.id} s={s} open={open === s.id} controls={`${id}-src`} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        </span>
        <div id={`${id}-src`}>
          {shown ? (
            <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 text-proof-small text-ink-2">
              <span className="font-medium text-ink">{sourceLabel(shown.id)}</span>
              {shown.measured ? '' : ', not measured'}: {shown.text || 'Statement not in this response.'}
              {shown.n ? <span className="tnum"> n={int(shown.n)}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <span className="flex flex-col items-end gap-1.5">
        {org ? (
          <button type="button" onClick={() => void save()} disabled={saving || isSaved || !canAct(role)} aria-label={isSaved ? 'Saved' : 'Save this claim'} title={!canAct(role) ? 'An analyst or admin saves claims' : undefined} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line bg-surface px-2.5 text-proof-small text-ink hover:border-line-strong hover:bg-pf-hover disabled:opacity-60">
            {isSaved ? <Check size={14} strokeWidth={1.8} aria-hidden className="text-proof-leaf" /> : <BookmarkPlus size={14} strokeWidth={1.6} aria-hidden />}
            <span className="hidden sm:inline">{isSaved ? 'Saved' : saving ? 'Saving…' : 'Save'}</span>
          </button>
        ) : null}
        <button type="button" onClick={() => void copy()} disabled={Boolean(blockedCopy)} title={blockedCopy ?? undefined} aria-label={copied ? 'Copied' : 'Copy draft'} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line bg-surface px-2.5 text-proof-small text-ink hover:border-line-strong hover:bg-pf-hover disabled:cursor-not-allowed disabled:opacity-50">
          {copied ? <Check size={14} strokeWidth={1.8} aria-hidden className="text-proof-leaf" /> : <Copy size={14} strokeWidth={1.6} aria-hidden />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? 'Copied' : ''}
        </span>
      </span>
    </li>
  )
}

/** One cited statement: a short label; hover or focus shows the statement, a click or tap pins it under the draft. */
function SourceChip({ s, open, controls, onToggle }: { s: ClaimSource; open: boolean; controls: string; onToggle: () => void }) {
  const tip = useTooltip(s.text ? `${s.text}${s.measured ? '' : ' Not measured.'}` : sourceLabel(s.id))
  return (
    <>
      <button
        type="button"
        {...tip.trigger}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        className={`hit44 inline-flex h-6 items-center rounded-pill px-2.5 text-proof-label font-medium transition-colors ${s.measured ? 'bg-sunken text-ink-2 hover:text-ink' : 'border border-line text-ink-2 hover:text-ink'} ${open ? 'ring-1 ring-line-strong' : ''}`}
      >
        {sourceLabel(s.id)}
      </button>
      {tip.node}
    </>
  )
}
