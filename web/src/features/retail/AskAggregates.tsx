import { ArrowUp, Check, Copy, History, MessageSquarePlus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { ApiError, api, type RetailerAnswer } from '../../lib/api'
import { setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { agoText } from './autopilot'
import { useOrgMaybe } from './org'
import { useCompetitorNames } from './orgData'
import { fallbackSuggestions, proofApi, type AskThread, type OrgAnswer } from './proofApi'
import { COHORTS, RANGES } from './state'
import type { Filters, Insights } from './types'
import { BrandLogo, cohortKind, copyText, Menu, MenuDivider, MIN_GROUP, mixedLabel, SidePanel } from './ui'

/*
 * Ask: a chat over the same aggregates as the screen (GEMINI_SPEC §6). Gemini writes, the api checks every number
 * against the aggregates and refuses anything about individuals.
 *
 * The person came to ask a question about their own data and get a checked answer they can reuse. So:
 * - The scope leads (under the title): whose data answers ("Answering from CeraVe’s products · competitors
 *   anonymised") and the filters, so a brand knows it is brand-specific.
 * - Conversations: a thread list ("Recent", newest first, with delete) and "New conversation" in the panel's
 *   toolbar. Inside an organisation threads live on the api (follow-ups remember the last two turns); an api
 *   build without threads keeps them in this browser instead (each question then answered on its own, and the
 *   footnote says so). The open thread is restored when Ask opens again, also after a reload.
 * - Empty thread: starter questions for this organisation (api suggestions, else per kind).
 * - Each answer reveals word by word (the full checked answer has already arrived), then its provenance line,
 *   its chart, and Copy / Retry. Follow-up chips on the newest answer.
 * - Keyboard: ⌘K opens (shell), Enter sends, Shift+Enter is a new line, Esc closes, ⌘K inside focuses the box.
 *   "Ask about this" on Home cards opens with the question prefilled (?q=), never sent for you.
 *
 * Four tests (scope line, threads, copy/retry): each answers "what is this answering from / where did my last
 * conversation go / can I reuse this" (1); plain words and standard chat icons (2); controls sit in a toolbar and
 * under answers, never over text (3); kit menu, buttons and type (4).
 */

const MIN_Q = 3
const MAX_Q = 300

/** What the api adds to an answer since the sliced Ask (api retailer_ask.py): why nothing was given, the tables read, who drew the chart. */
type AskExtras = { reason?: 'not_tracked' | 'individual' | 'policy' | 'names_hidden' | 'no_draft' | null; checks: (NonNullable<RetailerAnswer['checks']> & { read?: string[]; chart_by?: 'model' | 'code' | null }) | null }
type Turn = { id: number; q: string; reply?: RetailerAnswer; error?: { title: string; message: string } }
type LocalThread = { id: string; title: string; updated_at: string; turns: { q: string; reply?: RetailerAnswer }[] }

/** The open thread per scope survives the panel closing (the panel unmounts its content). */
const kept: { scope: string; threadId: string | null; turns: Turn[]; next: number } = { scope: '', threadId: null, turns: [], next: 0 }

const lastKey = (scope: string) => `willow.proof.ask.last.${scope}`
const localKey = (scope: string) => `willow.proof.ask.threads.${scope}`
function readJson<T>(k: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(k: string, v: unknown) {
  try {
    if (v === null) window.localStorage.removeItem(k)
    else window.localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage blocked: the conversation lasts for this visit */
  }
}

const UNIT: Record<NonNullable<RetailerAnswer['chart']>['unit'], (v: number) => string> = {
  percent: (v) => `${v < 0 ? '−' : ''}${Math.abs(v)}%`,
  count: (v) => String(v),
  weeks: (v) => `${v} wk`,
}

function errorOf(e: unknown): Turn['error'] {
  if (e instanceof ApiError) {
    if (e.status === 429) return { title: e.code === 'busy' ? 'Busy today' : 'Daily limit reached', message: e.message }
    if (e.status === 401 || e.status === 403) return { title: e.status === 403 ? 'Not allowed' : 'Not signed in', message: e.status === 403 ? e.message || 'Your organisation membership doesn’t allow this.' : 'Asking needs a guest sign-in, which did not work. Reload the page and try again.' }
    if (e.status === 503) return { title: 'Service unavailable', message: `${e.message} The dashboard is unaffected.` }
    return { title: 'No answer', message: e.message || 'Could not get an answer. Try again.' }
  }
  return { title: 'No answer', message: 'Could not reach Willow. Check the connection and try again.' }
}

/** The side panel: toolbar (threads, new), the conversation, and the composer pinned at the foot. */
export function AskPanel({ open, onClose, d, filters, scope, focusBrand, prefill, onPrefillUsed }: { open: boolean; onClose: () => void; d: Insights | null; filters: Filters; scope: string; focusBrand: string | null; prefill: string | null; onPrefillUsed: () => void }) {
  const org = useOrgMaybe()?.org ?? null
  const names = useCompetitorNames()
  const brand = org?.kind === 'brand' ? (org.brands[0] ?? org.name) : focusBrand
  const who = org?.kind === 'brand' ? `${brand}’s products` : focusBrand ? `${org?.name ?? 'the retailer'}’s range, focused on ${focusBrand}` : `${org?.name ?? 'the retailer'}’s whole range`
  const naming = org?.kind === 'brand' ? (names.anonymise ? ' · competitors anonymised' : ' · competitors named') : ''
  const period = `${COHORTS.find((c) => c.value === filters.cohort)?.label} · ${RANGES.find((r) => r.value === filters.range)?.label}`
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width={520}
      flush
      labelledBy="proof-ask-title"
      title="Ask"
      subtitle={
        <span className="flex min-w-0 items-center gap-1.5">
          {brand ? <BrandLogo brand={brand} size={16} /> : null}
          <span className="min-w-0 truncate">
            Answering from {who}
            {naming} · {period}
          </span>
        </span>
      }
    >
      <AskAggregates d={d} filters={filters} scope={scope} focusBrand={focusBrand} prefill={prefill} onPrefillUsed={onPrefillUsed} />
    </SidePanel>
  )
}

export function AskAggregates({ d, filters, scope = '', focusBrand = null, prefill = null, onPrefillUsed }: { d: Insights | null; filters: Filters; scope?: string; focusBrand?: string | null; prefill?: string | null; onPrefillUsed?: () => void }) {
  const { user, continueAsGuest, getIdToken } = useAuth()
  const org = useOrgMaybe()?.org ?? null
  const names = useCompetitorNames()
  const uid = user?.uid ?? null
  const fresh = kept.scope !== scope
  const [thread, setThreadState] = useState<Turn[]>(() => (fresh ? [] : kept.turns))
  const [threadId, setThreadIdState] = useState<string | null>(() => (fresh ? null : kept.threadId))
  const setThread = useCallback(
    (f: (t: Turn[]) => Turn[]) =>
      setThreadState((t) => {
        const next = f(t)
        Object.assign(kept, { scope, turns: next })
        return next
      }),
    [scope],
  )
  const setThreadId = useCallback(
    (id: string | null) => {
      setThreadIdState(id)
      Object.assign(kept, { scope, threadId: id })
      writeJson(lastKey(scope), id)
    },
    [scope],
  )
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [revealing, setRevealing] = useState<number | null>(null)
  const nextId = useRef(fresh ? 0 : kept.next)
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Threads: on the api inside an organisation; in this browser when the api has none (404) or no org.
  const serverQ = useQuery<AskThread[]>(['ask-threads', uid, org?.id ?? null], (t) => proofApi.askThreads(t, org!.id), { enabled: Boolean(uid && org), staleMs: 30_000 })
  const serverDown = serverQ.status === 'error' && serverQ.error instanceof ApiError && serverQ.error.status === 404
  const mode: 'server' | 'local' = org && !serverDown ? 'server' : 'local'
  const [local, setLocal] = useState<LocalThread[]>(() => readJson<LocalThread[]>(localKey(scope), []))
  const threads: { id: string; title: string; updated_at: string | null }[] = mode === 'server' ? (serverQ.data ?? []) : local

  const saveLocal = (id: string, turns: Turn[]) => {
    const done = turns.filter((t) => t.reply).map((t) => ({ q: t.q, reply: t.reply }))
    if (!done.length) return
    setLocal((prev) => {
      const rest = prev.filter((x) => x.id !== id)
      const next = [{ id, title: done[0].q.slice(0, 80), updated_at: new Date().toISOString(), turns: done }, ...rest].slice(0, 20)
      writeJson(localKey(scope), next)
      return next
    })
  }

  // Reopen after a reload: restore the last open thread of this scope.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || thread.length || !fresh) return
    const last = readJson<string | null>(lastKey(scope), null)
    if (!last) return
    if (mode === 'local') {
      restored.current = true
      const t = local.find((x) => x.id === last)
      if (t) openThread(t.id)
    } else if (serverQ.status === 'ready') {
      restored.current = true
      if ((serverQ.data ?? []).some((x) => x.id === last)) openThread(last)
    }
  }, [mode, serverQ.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill from "Ask about this" (?q=): into the box, focused, never sent for the person.
  useEffect(() => {
    if (!prefill) return
    if (thread.length) newThread()
    setDraft(prefill.slice(0, MAX_Q))
    onPrefillUsed?.()
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(box.current.value.length, box.current.value.length)
    })
  }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    requestAnimationFrame(() => box.current?.focus({ preventScroll: true }))
    // ⌘K while Ask is open focuses the box instead of stacking another panel.
    const k = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') box.current?.focus()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(() => setSlow(true), 8_000)
    return () => {
      window.clearTimeout(t)
      setSlow(false)
    }
  }, [busy])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [thread.length, busy])
  // The box grows with the question (up to six lines).
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`
  }, [draft])

  const suggestionsQ = useQuery<string[]>(['ask-suggestions', uid, org?.id ?? null, filters.cohort, filters.range], (t) => proofApi.askSuggestions(t, org!.id, { cohort: filters.cohort, range: filters.range }), { enabled: Boolean(uid && org), staleMs: 10 * 60_000 })
  const brand = org?.kind === 'brand' ? (org.brands[0] ?? org.name) : focusBrand
  const starters = useMemo(() => {
    const fromApi = (suggestionsQ.data ?? []).filter((s) => s.length >= MIN_Q && s.length <= MAX_Q)
    return (fromApi.length ? fromApi : fallbackSuggestions(org?.kind === 'brand' ? 'brand' : 'retailer', brand)).slice(0, 5)
  }, [suggestionsQ.data, org?.kind, brand])

  function newThread() {
    setThread(() => [])
    setThreadId(null)
    setRevealing(null)
    setDraft('')
    requestAnimationFrame(() => box.current?.focus())
  }

  async function openThread(id: string) {
    if (busy) return
    setRevealing(null)
    if (mode === 'local') {
      const t = local.find((x) => x.id === id)
      if (!t) return
      setThread(() => t.turns.map((x) => ({ id: nextId.current++, q: x.q, reply: x.reply })))
      kept.next = nextId.current
      setThreadId(id)
      return
    }
    try {
      const tok = await getIdToken()
      const t = await proofApi.askThread(tok, org!.id, id)
      setThread(() => (Array.isArray(t.turns) ? t.turns : []).map((x) => ({ id: nextId.current++, q: x.q ?? x.question ?? '', ...(x.answer ? { reply: x.answer } : { error: { title: 'No answer', message: 'This question got no checked answer.' } }) })))
      kept.next = nextId.current
      setThreadId(id)
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? 'That conversation is gone.' : 'Couldn’t open that conversation. Try again.')
    }
  }

  async function removeThread(id: string) {
    if (mode === 'local') {
      setLocal((prev) => {
        const next = prev.filter((x) => x.id !== id)
        writeJson(localKey(scope), next)
        return next
      })
    } else {
      const before = serverQ.data ?? []
      setQueryData<AskThread[]>(['ask-threads', uid, org?.id ?? null], before.filter((x) => x.id !== id))
      try {
        await proofApi.deleteAskThread(await getIdToken(), org!.id, id)
      } catch {
        setQueryData<AskThread[]>(['ask-threads', uid, org?.id ?? null], before)
        toast.error('Couldn’t delete that conversation.')
        return
      }
    }
    if (id === threadId) newThread()
    toast('Conversation deleted')
  }

  const ask = async (text: string, replaceId?: number) => {
    const q = text.trim()
    if (q.length < MIN_Q || busy || revealing !== null || !d) return
    const id = nextId.current++
    kept.next = nextId.current
    setThread((t) => [...t.filter((m) => m.id !== replaceId), { id, q }])
    setDraft('')
    setBusy(true)
    let tid = threadId
    try {
      if (!user) await continueAsGuest()
      const t = await getIdToken()
      // Inside an organisation the question is scoped to it: a brand asks about its own brand, with other brands
      // anonymised when the retailer's policy says so (checked by the api). An api build without the
      // organisation Ask answers the unscoped way.
      const body = { question: q, cohort: filters.cohort, range: filters.range, brand: org?.kind === 'retailer' ? focusBrand : null }
      const orgAsk = (thread: string | null) => proofApi.ask(t, org!.id, { ...body, ...(thread ? { thread_id: thread } : {}) })
      const reply: OrgAnswer = org
        ? await orgAsk(mode === 'server' ? tid : null).catch(async (e: unknown) => {
            if (!(e instanceof ApiError) || e.status !== 404) throw e
            // A stale or deleted conversation (404 "Conversation not found"): start a new one on the org endpoint,
            // never the public unscoped Ask.
            if (mode === 'server' && tid) {
              tid = null
              setThreadId(null)
              return orgAsk(null)
            }
            // An api build without the organisation Ask: the unscoped one, only when names may be shown.
            if (!names.anonymise) return api.retailerAsk(t, q, filters)
            throw e
          })
        : await api.retailerAsk(t, q, filters)
      if (mode === 'server' && reply.thread_id) {
        tid = reply.thread_id
        if (tid !== threadId) setThreadId(tid)
        void serverQ.refetch()
      } else if (mode === 'local') {
        tid = tid ?? `l${Date.now().toString(36)}`
        if (tid !== threadId) setThreadId(tid)
      }
      setThread((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, reply } : m))
        if (mode === 'local' && tid) saveLocal(tid, next)
        return next
      })
      setRevealing(id)
    } catch (e) {
      setThread((t) => t.map((m) => (m.id === id ? { ...m, error: errorOf(e) } : m)))
    } finally {
      setBusy(false)
    }
  }

  const last = thread.at(-1)
  const canSend = draft.trim().length >= MIN_Q && !busy && revealing === null && Boolean(d)
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) void ask(draft)
    }
  }
  const current = threads.find((t) => t.id === threadId)

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-[1] flex items-center gap-1 border-b border-line bg-surface/95 px-3 py-1.5 backdrop-blur-sm">
        <Menu
          label="Recent conversations"
          width={340}
          triggerClass="hit44 inline-flex h-8 min-w-0 max-w-[260px] items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink"
          trigger={
            <>
              <History size={14} strokeWidth={1.7} aria-hidden className="shrink-0" />
              <span className="truncate">{current ? current.title : threads.length ? `Recent · ${threads.length}` : 'No conversations yet'}</span>
            </>
          }
        >
          {(close) => (
            <>
              {threads.length ? (
                threads.slice(0, 20).map((t) => (
                  <div key={t.id} className={`group flex items-center gap-1 rounded-ctl ${t.id === threadId ? 'bg-pf-hover' : ''}`}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close()
                        void openThread(t.id)
                      }}
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-ctl border-0 bg-transparent px-3 py-2 text-left hover:bg-pf-hover"
                    >
                      <span className="w-full truncate text-proof-body text-ink">{t.title}</span>
                      {t.updated_at ? <span className="text-proof-label text-ink-2">{agoText(t.updated_at)}</span> : null}
                    </button>
                    <button type="button" aria-label={`Delete “${t.title}”`} onClick={() => void removeThread(t.id)} className="hit44 mr-1 grid size-7 shrink-0 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 opacity-0 transition-opacity hover:bg-pf-hover hover:text-pf-red focus-visible:opacity-100 group-hover:opacity-100">
                      <Trash2 size={13} strokeWidth={1.7} aria-hidden />
                    </button>
                  </div>
                ))
              ) : (
                <span className="px-3 pb-2 text-proof-small text-ink-2">Your questions are kept here so you can come back to them.</span>
              )}
              <MenuDivider />
              <span className="px-3 pb-1.5 pt-0.5 text-proof-label text-ink-2">{mode === 'server' ? 'Kept for your organisation membership.' : 'Kept in this browser.'}</span>
            </>
          )}
        </Menu>
        <button type="button" onClick={newThread} disabled={busy || (!thread.length && !draft)} className="hit44 ml-auto inline-flex h-8 items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
          <MessageSquarePlus size={14} strokeWidth={1.7} aria-hidden /> <span className="hidden sm:inline">New conversation</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {thread.length === 0 ? (
          <div className="flex flex-col gap-4 pt-2 animate-[proofPage_.24s_var(--ease-standard)_both]">
            <div className="flex flex-col gap-1">
              <span className="text-proof-h text-ink">{brand ? `Ask about ${brand}` : 'Ask about your range'}</span>
              <span className="max-w-[52ch] text-proof-small text-ink-2 [text-wrap:pretty]">Answers come from the same aggregates as the screen. Every number is checked against them; groups under {MIN_GROUP} people stay hidden and no one person can be looked up.</span>
            </div>
            <div role="group" aria-label="Questions to start with" className="flex flex-col gap-1.5">
              {starters.map((t, i) => (
                <button key={t} type="button" disabled={!d} onClick={() => void ask(t)} className="group flex min-h-10 items-center gap-2 rounded-ctl border border-line px-3 py-2 text-left text-proof-body text-ink transition-[background,border-color] hover:border-line-strong hover:bg-pf-hover animate-[proofPage_.24s_var(--ease-standard)_both] disabled:opacity-50" style={{ animationDelay: `${40 + i * 30}ms` }}>
                  <span className="min-w-0 flex-1">{t}</span>
                  <ArrowUp size={14} strokeWidth={1.8} aria-hidden className="shrink-0 rotate-45 text-ink-2 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div aria-live="polite" className="flex flex-col gap-5">
          {thread.map((m) => (
            <div key={m.id} className="flex flex-col gap-3">
              <div className="max-w-[88%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-selected px-3.5 py-2 text-proof-body text-inverse animate-[proofPage_.2s_var(--ease-standard)_both]">{m.q}</div>
              {m.reply && d ? (
                <Answer d={d} reply={m.reply} reveal={revealing === m.id} onRevealed={() => setRevealing((r) => (r === m.id ? null : r))} followUps={m === last} onAsk={ask} disabled={busy || revealing !== null} onRetry={m === last ? () => void ask(m.q, m.id) : undefined} />
              ) : m.error ? (
                <div role="alert" className="flex flex-col gap-2 rounded-card border border-line bg-pf-bg2 p-3.5">
                  <span className="text-proof-small font-medium text-ink">{m.error.title} · no numbers returned</span>
                  <span className="text-proof-body text-ink-2">{m.error.message}</span>
                  <button type="button" disabled={busy} onClick={() => void ask(m.q, m.id)} className="hit44 inline-flex h-8 items-center gap-1.5 self-start rounded-ctl border border-line bg-surface px-2.5 text-proof-small text-ink hover:border-line-strong hover:bg-pf-hover disabled:opacity-50">
                    <RotateCcw size={13} strokeWidth={1.7} aria-hidden /> Try again
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {busy ? (
            <div role="status" className="flex items-center gap-2.5 self-start rounded-pill bg-sunken px-3.5 py-2 animate-[wFadeIn_.2s_ease_both]">
              <span aria-hidden className="flex gap-1">
                {[0, 0.15, 0.3].map((delay) => (
                  <span key={delay} className="size-1.5 rounded-full bg-ink-2 animate-[wBounce_1.1s_infinite]" style={{ animationDelay: `${delay}s` }} />
                ))}
              </span>
              <span className="text-proof-small text-ink-2">{slow ? 'Still checking the numbers: this one is taking longer than usual.' : 'Reading the tables this question needs…'}</span>
            </div>
          ) : null}
          <div ref={end} />
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-1.5 border-t border-line bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ask(draft)
          }}
          className="flex items-end gap-1.5 rounded-[10px] border border-line-strong bg-surface p-1.5 transition-[border-color,box-shadow] focus-within:border-ink-2 focus-within:shadow-[0_0_0_3px_var(--bg-sunken)]"
        >
          <label htmlFor="retail-ask" className="sr-only">
            Your question
          </label>
          <textarea
            id="retail-ask"
            ref={box}
            data-autofocus
            rows={1}
            autoComplete="off"
            value={draft}
            maxLength={MAX_Q}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={!d ? 'Waiting for the aggregates…' : thread.length ? 'Ask a follow-up' : brand ? `Ask about ${brand}` : 'Ask about your range'}
            className="max-h-[148px] min-h-9 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[16px] leading-6 text-ink outline-none placeholder:text-ink-2 sm:text-proof-body"
          />
          <button type="submit" aria-label="Send question" disabled={!canSend} className="grid size-8 flex-none place-items-center rounded-ctl border-0 bg-selected text-inverse transition-[opacity,transform] active:scale-95 disabled:opacity-30">
            <ArrowUp size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </form>
        <span className="flex items-center justify-between gap-3 text-proof-label text-ink-2">
          <span className="truncate">{mode === 'server' && org ? 'Follow-ups remember the last two answers' : 'Each question is answered on its own'} · 20 a day</span>
          <span className="hidden shrink-0 tnum sm:inline">{draft.length > MAX_Q - 60 ? `${MAX_Q - draft.length} characters left` : '⏎ send · ⇧⏎ new line'}</span>
        </span>
      </div>
    </div>
  )
}

function Answer({ d, reply, reveal, onRevealed, followUps, onAsk, disabled, onRetry }: { d: Insights; reply: RetailerAnswer; reveal: boolean; onRevealed: () => void; followUps: boolean; onAsk: (q: string) => void; disabled: boolean; onRetry?: () => void }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const words = reply.answer.split(/\s+/).filter(Boolean)
  const [shown, setShown] = useState(reveal && !reduced ? 0 : words.length)
  const [copied, setCopied] = useState(false)
  const done = shown >= words.length
  const revealed = useRef(onRevealed)
  useEffect(() => {
    revealed.current = onRevealed
  })
  useEffect(() => {
    if (done) {
      revealed.current()
      return
    }
    // The full answer has already arrived; this only paces how it appears (30 ms a word, docs/DESIGN.md).
    const t = window.setInterval(() => setShown((n) => n + 1), 30)
    return () => window.clearInterval(t)
  }, [done])

  const kind = cohortKind(d.cohort)
  const { reason, checks: checked } = reply as RetailerAnswer & AskExtras
  const refused = reply.refused ?? !checked
  const chart = refused ? null : reply.chart
  const sources = reply.source ?? []
  // Why nothing was given: a rule in code (not tracked, names hidden) reads as policy, never as a failed check.
  const prov =
    reason === 'not_tracked'
      ? 'Policy · Proof measures skin outcomes; sales, revenue, prices and stock are not tracked · no model call'
      : reason === 'individual'
        ? `Policy · Proof shows groups of ${MIN_GROUP} or more, never one person · no model call`
        : reason === 'names_hidden'
        ? 'Policy · other brands stay anonymised for brand teams · no numbers returned'
        : !checked
          ? 'Validator: no draft used only numbers from the aggregates · no numbers returned'
          : refused
            ? `Policy · aggregates only · n≥${MIN_GROUP} · ${checked.model}`
            : `From ${sources.length ? sources.map((x) => x.replace(/_/g, ' ')).join(', ') : 'the retailer aggregates'} · n≥${MIN_GROUP} · ${checked.numbers_checked} ${checked.numbers_checked === 1 ? 'number' : 'numbers'} checked against the aggregates${checked.rejected_attempts ? ` · ${checked.rejected_attempts} ${checked.rejected_attempts === 1 ? 'draft' : 'drafts'} rejected first` : ''}${chart && checked.chart_by === 'code' ? ' · chart drawn from the same rows' : ''} · ${checked.model}`
  const copy = async () => {
    const ok = await copyText(`${reply.answer}\n\n— Proof by Willow, ${kind} aggregates (${prov})`, 'Answer copied')
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="group/answer flex flex-col gap-2.5" aria-busy={!done}>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-pf-bg2 p-3.5">
        <span className="flex items-center gap-1.5 text-proof-small font-medium text-ink-2">
          <Sparkles size={13} strokeWidth={1.7} aria-hidden className="text-proof-leaf" />
          {refused ? 'No numbers returned' : `Gemini · ${kind === 'real' ? 'Real people' : mixedLabel(d.cohort)}`}
        </span>
        <p className="m-0 text-proof-answer text-ink [text-wrap:pretty]">
          <span className="sr-only">{reply.answer}</span>
          <span aria-hidden>
            {words.slice(0, shown).map((w, i) => (
              <span key={i} className="animate-[wWord_.4s_ease-out_both]">
                {w}{' '}
              </span>
            ))}
          </span>
        </p>
        {done ? <span className="text-proof-label text-ink-2 animate-[wFadeIn_.3s_ease_both]">{prov}</span> : null}
      </div>
      {chart && done ? <AnswerChart chart={chart} /> : null}
      {done ? (
        <div className="flex items-center gap-1 animate-[wFadeIn_.3s_ease_both]">
          <button type="button" onClick={() => void copy()} className="hit44 inline-flex h-7 items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-proof-label text-ink-2 hover:bg-pf-hover hover:text-ink">
            {copied ? <Check size={13} strokeWidth={2} aria-hidden className="text-proof-leaf" /> : <Copy size={13} strokeWidth={1.7} aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onRetry ? (
            <button type="button" disabled={disabled} onClick={onRetry} className="hit44 inline-flex h-7 items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-proof-label text-ink-2 hover:bg-pf-hover hover:text-ink disabled:opacity-40">
              <RotateCcw size={13} strokeWidth={1.7} aria-hidden /> Ask again
            </button>
          ) : null}
        </div>
      ) : null}
      {done && followUps && reply.follow_ups.length ? (
        <div className="flex flex-wrap gap-1.5">
          {reply.follow_ups.map((f, i) => (
            <button key={f} type="button" disabled={disabled} onClick={() => onAsk(f)} className="min-h-8 rounded-pill border border-line px-3 py-1 text-left text-proof-small text-ink transition-colors hover:border-line-strong hover:bg-pf-hover animate-[proofPage_.24s_var(--ease-standard)_both] disabled:opacity-50" style={{ animationDelay: `${i * 40}ms` }}>
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AnswerChart({ chart }: { chart: NonNullable<RetailerAnswer['chart']> }) {
  // A share is drawn on 0–100% (a 71% bar is never full width); counts and weeks scale to their largest.
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), chart.unit === 'percent' ? 100 : 1)
  const bars = chart.bars.map((b) => ({ ...b, n: chart.unit === 'percent' ? (b.n ?? null) : null }))
  const axis = chart.unit === 'percent' ? `% of people${bars.some((b) => b.n !== null) ? ' · n per bar' : ''} · 0–${max}%` : chart.unit === 'weeks' ? `Weeks · 0–${max}` : `Count · 0–${max}`
  const alt = `${chart.title}: ${bars.map((b) => `${b.label} ${UNIT[chart.unit](b.value)}${b.n !== null ? `, n=${b.n}` : ''}`).join('; ')}`
  return (
    <div role="img" aria-label={alt} className="flex flex-col gap-2.5 rounded-card border border-line p-3.5">
      <span className="text-proof-small font-medium text-ink">{chart.title}</span>
      {bars.map((b, i) => (
        <div key={`${b.label}-${i}`} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2.5 text-proof-small">
            <span className="min-w-0 text-ink">{b.label}</span>
            <span className="whitespace-nowrap text-ink tnum">
              {UNIT[chart.unit](b.value)}
              {b.n !== null ? <span className="text-ink-2"> · n={b.n}</span> : null}
            </span>
          </span>
          <span className="block h-1.5 rounded-pill bg-sunken">
            <span className="block h-full origin-left rounded-pill bg-ink-2 animate-[wGrowX_.6s_var(--ease-standard)_both]" style={{ width: `${(Math.abs(b.value) / max) * 100}%`, animationDelay: `${i * 50}ms` }} />
          </span>
        </div>
      ))}
      <span className="text-proof-label text-ink-2">{axis}</span>
    </div>
  )
}
