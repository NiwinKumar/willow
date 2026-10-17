import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api, ApiError, type AutopilotActivity, type AutopilotView, type AutoRule } from '../../../../lib/api'
import { setQueryData } from '../../../../lib/query'
import { useAuth } from '../../../../lib/useAuth'
import { agoText, feedOrder, KIND, LEVELS, openProposals, ruleSentence, TEMPLATES } from '../../autopilot'
import { Badge, Button, ErrorState, Panel, SkeletonTable, ToolButton } from '../../ui'
import { RuleEditor } from './RuleEditor'
import { autopilotKey, useAutopilot } from './useAutopilot'

/*
 * AutoCampaign (docs/RETAILER_INSIGHTS.md "AutoCampaign"): standing rules that watch the evidence and start,
 * adjust or stop campaigns when their conditions are met, at the level of control each rule is given. Two
 * panels on the Campaigns page: the rules (on/off, the trigger in one sentence, the last action) and the
 * activity feed (everything it did or proposed, with the numbers; proposals to approve, starts to undo).
 * Opening the page runs a check when the last one is over 30 minutes old; "Run check now" runs one at once.
 * The nightly run is the api's /v1/internal/autopilot (Cloud Scheduler).
 */

export function AutoCampaigns({ uid, workspace, onCampaignsChanged }: { uid: string; workspace: { id: string; label: string }; onCampaignsChanged: () => void }) {
  const { getIdToken } = useAuth()
  const q = useAutopilot(uid)
  const put = (v: AutopilotView) => setQueryData<AutopilotView>(autopilotKey(uid), v)
  const [editor, setEditorState] = useState<{ open: boolean; editing: AutoRule | null; template: number | null; n: number }>({ open: false, editing: null, template: null, n: 0 })
  // each opening is a fresh form (a new key remounts the editor)
  const setEditor = (e: { open: boolean; editing: AutoRule | null; template: number | null }) => setEditorState((prev) => ({ ...e, n: e.open ? prev.n + 1 : prev.n }))
  const [running, setRunning] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  // On open: a check when the last one is stale (the api decides), so the page shows what changed overnight.
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    void getIdToken()
      .then((t) => api.runAutopilot(t, true))
      .then((v) => {
        put(v)
        if (v.result && (v.result.started || v.result.paused || v.result.ended || v.result.extended || v.result.narrowed || v.result.resumed)) onCampaignsChanged()
      })
      .catch(() => undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rules = (q.data?.rules ?? []).filter((r) => r.workspace === workspace.id)
  const feed = feedOrder((q.data?.activity ?? []).filter((a) => !a.rule_id || rules.some((r) => r.id === a.rule_id) || !q.data?.rules.some((r) => r.id === a.rule_id)))
  const waiting = openProposals(feed).length

  const runNow = async () => {
    setRunning(true)
    try {
      const v = await api.runAutopilot(await getIdToken())
      put(v)
      onCampaignsChanged()
      const r = v.result
      const did = r ? [r.started && `${r.started} started`, r.proposed && `${r.proposed} proposed`, r.paused && `${r.paused} paused`, r.resumed && `${r.resumed} resumed`, r.ended && `${r.ended} ended`, r.extended && `${r.extended} extended`, r.narrowed && `${r.narrowed} narrowed`].filter(Boolean) : []
      toast(did.length ? `Check done · ${did.join(', ')}` : 'Check done · nothing new to do')
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 503 ? 'The evidence is unavailable right now, so nothing was changed.' : 'The check didn’t run. Try again.')
    } finally {
      setRunning(false)
    }
  }

  const act = async (a: AutopilotActivity, kind: 'approve' | 'dismiss' | 'undo') => {
    setActing(a.id)
    try {
      const v = await api.autopilotAct(await getIdToken(), a.id, kind)
      put(v)
      if (kind !== 'dismiss') onCampaignsChanged()
      toast(kind === 'approve' ? 'Approved' : kind === 'undo' ? (v.outcome === 'deleted' ? 'Undone · the campaign was deleted before anyone saw it' : 'Undone · the campaign ended') : 'Dismissed')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'That didn’t go through. Try again.')
    } finally {
      setActing(null)
    }
  }

  const toggle = async (r: AutoRule) => {
    try {
      const saved = await api.toggleRule(await getIdToken(), r.id, !r.enabled)
      put({ rules: (q.data?.rules ?? []).map((x) => (x.id === r.id ? saved : x)), activity: q.data?.activity ?? [] })
    } catch {
      toast.error('Couldn’t switch the rule. Try again.')
    }
  }

  const remove = async (r: AutoRule) => {
    if (!window.confirm(`Delete “${r.name}”? Its campaigns keep running as ordinary campaigns.`)) return
    try {
      await api.deleteRule(await getIdToken(), r.id)
      void q.refetch()
      toast('Rule deleted')
    } catch {
      toast.error('Couldn’t delete the rule. Try again.')
    }
  }

  const onSaved = (saved: AutoRule) => {
    const others = (q.data?.rules ?? []).filter((x) => x.id !== saved.id)
    put({ rules: [...others, saved], activity: q.data?.activity ?? [] })
    setEditor({ open: false, editing: null, template: null })
    // a new rule acts at once: the next check is now
    void runNow()
  }

  return (
    <div id="autocampaign" className="flex flex-col gap-6">
      <Panel
        title="AutoCampaign"
        id="proof-auto-h"
        meta={rules.length ? <Badge tone={rules.some((r) => r.enabled) ? 'green' : 'gray'}>{rules.filter((r) => r.enabled).length} on</Badge> : null}
        description="Standing rules. Willow watches the evidence every night and starts, adjusts or stops campaigns when a rule’s conditions are met."
        actions={
          <>
            <ToolButton onClick={() => void runNow()} disabled={running || !rules.some((r) => r.enabled)} label="Run check now">
              <RefreshCw size={14} strokeWidth={1.7} aria-hidden className={running ? 'animate-spin' : ''} />
              {running ? 'Checking…' : 'Run check now'}
            </ToolButton>
            <Button onClick={() => setEditor({ open: true, editing: null, template: null })}>
              <Plus size={15} strokeWidth={1.8} aria-hidden />
              New rule
            </Button>
          </>
        }
        flush
      >
        {q.status === 'error' && !q.data ? (
          <ErrorState compact title="Rules couldn’t load" onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <SkeletonTable rows={2} />
        ) : rules.length ? (
          <ul className="m-0 list-none p-0">
            {rules.map((r) => (
              <RuleRow key={r.id} r={r} onToggle={() => void toggle(r)} onEdit={() => setEditor({ open: true, editing: r, template: null })} onDelete={() => void remove(r)} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3 px-5 pb-5">
            <p className="m-0 text-proof-small text-ink-2">No rules yet. Start from one of these, then change anything:</p>
            <div className="grid gap-2 md:grid-cols-2">
              {TEMPLATES.map((t, i) => (
                <button key={t.title} type="button" onClick={() => setEditor({ open: true, editing: null, template: i })} className="flex flex-col items-start gap-1 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-pf-hover">
                  <span className="text-proof-small font-medium text-ink">{t.title}</span>
                  <span className="text-proof-label leading-snug text-ink-2">{ruleSentence(t.rule(workspace.id))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {q.data && (rules.length || feed.length) ? (
        <Panel title="Activity" id="proof-activity-h" meta={waiting ? <Badge tone="amber">{waiting} to review</Badge> : null} description="Everything AutoCampaign did or proposed, with the numbers behind it." flush>
          {feed.length ? (
            <ol className="m-0 list-none p-0" aria-live="polite">
              {feed.slice(0, 20).map((a) => (
                <ActivityRow key={a.id} a={a} busy={acting === a.id} onAct={(kind) => void act(a, kind)} />
              ))}
            </ol>
          ) : (
            <p className="m-0 px-5 pb-5 text-proof-small text-ink-2">Nothing yet. The first check runs as soon as a rule is on.</p>
          )}
        </Panel>
      ) : null}

      <RuleEditor
        key={editor.n}
        open={editor.open}
        onClose={() => setEditor({ open: false, editing: null, template: null })}
        workspace={workspace}
        editing={editor.editing}
        template={editor.template}
        onSaved={onSaved}
      />
    </div>
  )
}

function RuleRow({ r, onToggle, onEdit, onDelete }: { r: AutoRule; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const level = LEVELS.find((l) => l.id === r.level)!
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 border-t border-line px-5 py-4">
      <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? 'on' : 'off'}`} onClick={onToggle} className={`hit44 relative mt-0.5 h-6 w-10 shrink-0 rounded-pill transition-colors ${r.enabled ? 'bg-proof-leaf' : 'bg-line-strong'}`}>
        <span aria-hidden className={`absolute top-0.5 size-5 rounded-full bg-surface shadow transition-[left] ${r.enabled ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-proof-body font-medium text-ink">{r.name}</span>
          <Badge tone="outline">{level.label}</Badge>
          {r.running ? <Badge tone="green">{r.running} running</Badge> : null}
          {!r.enabled ? <Badge>Off</Badge> : null}
        </div>
        <p className="m-0 text-proof-small text-ink-2">{r.sentence}</p>
        <p className="m-0 text-proof-label text-ink-3">
          {r.last_action ? `Last: ${KIND[r.last_action.kind].word.toLowerCase()} · ${agoText(r.last_action.at)}` : r.last_run_at ? `Checked ${agoText(r.last_run_at)} · nothing matched yet` : 'Not checked yet'}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button kind="ghost" size="sm" onClick={onEdit} label={`Edit ${r.name}`}>
          <Pencil size={14} strokeWidth={1.7} aria-hidden />
        </Button>
        <Button kind="ghost" size="sm" onClick={onDelete} label={`Delete ${r.name}`}>
          <Trash2 size={14} strokeWidth={1.7} aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function ActivityRow({ a, busy, onAct }: { a: AutopilotActivity; busy: boolean; onAct: (kind: 'approve' | 'dismiss' | 'undo') => void }) {
  const k = KIND[a.kind]
  const open = a.kind === 'proposed' && a.status === 'open'
  const handled = a.kind === 'proposed' && !open ? (a.status === 'approved' ? 'Approved' : 'Dismissed') : a.status === 'undone' ? 'Undone' : null
  return (
    <li className={`flex flex-col gap-2 border-t border-line px-5 py-3.5 ${open ? 'bg-pf-amber-soft/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={k.tone}>{k.word}</Badge>
        {handled ? <Badge tone="outline">{handled}</Badge> : null}
        <span className="text-proof-label text-ink-3">
          {a.rule_name ? `${a.rule_name} · ` : ''}
          <time dateTime={a.at}>{agoText(a.at)}</time>
        </span>
      </div>
      {/* the badge already says Proposed */}
      <p className={`m-0 text-proof-small ${handled ? 'text-ink-2' : 'text-ink'}`}>{a.kind === 'proposed' ? a.text.replace(/^Proposed: (.)/, (_, c: string) => c.toUpperCase()) : a.text}</p>
      {open || a.can_undo ? (
        <div className="flex flex-wrap gap-2">
          {open ? (
            <>
              <Button size="sm" onClick={() => onAct('approve')} disabled={busy}>
                {busy ? 'Working…' : a.proposal?.action === 'start' ? 'Approve and start' : 'Approve'}
              </Button>
              <Button size="sm" kind="ghost" onClick={() => onAct('dismiss')} disabled={busy}>
                Dismiss
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => onAct('undo')} disabled={busy}>
              {busy ? 'Undoing…' : 'Undo'}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  )
}
