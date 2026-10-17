import { Check, Copy, ShieldCheck, Wand2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { api, ApiError, type AutoRule, type RuleBody } from '../../../../lib/api'
import { GOALS } from '../../../../lib/metrics'
import { useAuth } from '../../../../lib/useAuth'
import { CATEGORIES, emptyRule, LEVELS, PATTERN, ruleSentence, TEMPLATES, TRIGGERS } from '../../autopilot'
import { Button, Segmented, Select, SidePanel } from '../../ui'

/*
 * The AutoCampaign rule editor (side panel): start from a template, or describe the rule in plain words and let
 * the api read it into the form (fixed patterns, no model), then adjust the fields. The rule's sentence under
 * the form updates as it changes; that sentence is what the rules list shows. Saving creates or replaces it.
 */

type Props = { open: boolean; onClose: () => void; workspace: { id: string; label: string }; editing: AutoRule | null; template?: number | null; onSaved: (r: AutoRule) => void }

const bodyOf = (r: AutoRule): RuleBody => ({ name: r.name, workspace: r.workspace, enabled: r.enabled, level: r.level, scope: r.scope, trigger: r.trigger, conditions: r.conditions, action: r.action })

export function RuleEditor({ open, onClose, workspace, editing, template = null, onSaved }: Props) {
  const start = (): RuleBody => (editing ? bodyOf(editing) : template !== null && TEMPLATES[template] ? TEMPLATES[template].rule(workspace.id) : emptyRule(workspace.id))
  const { getIdToken } = useAuth()
  // The rule being edited, else the template picked, else the first template (the parent remounts it per opening).
  const [rule, setRule] = useState<RuleBody>(start)
  const [typed, setTyped] = useState('')
  const [missed, setMissed] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<'parse' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useId()

  const set = <K extends keyof RuleBody>(k: K, v: RuleBody[K]) => setRule((r) => ({ ...r, [k]: v }))
  const brandRule = rule.workspace !== 'retailer'

  const read = async () => {
    if (typed.trim().length < 3) return
    setBusy('parse')
    setError(null)
    try {
      const out = await api.parseRule(await getIdToken(), typed.trim(), workspace.id)
      setRule({ ...out.rule, workspace: workspace.id })
      setMissed(out.missed)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t read that rule. Check the connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const t = await getIdToken()
      const saved = editing ? await api.replaceRule(t, editing.id, rule) : await api.createRule(t, rule)
      onSaved(saved)
      toast(editing ? `Rule saved · ${saved.name}` : `Rule on · ${saved.name}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save the rule. Check the connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const toggleGoal = (g: string) => set('trigger', { ...rule.trigger, goals: rule.trigger.goals.includes(g) ? rule.trigger.goals.filter((x) => x !== g) : [...rule.trigger.goals, g] })

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={editing ? 'Edit rule' : 'New AutoCampaign rule'}
      subtitle={workspace.label}
      width={600}
      labelledBy="proof-rule-editor"
      footer={
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="m-0 rounded-ctl border border-pf-red/40 bg-pf-red-soft px-3 py-2 text-proof-small text-ink">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => void save()} disabled={busy !== null || !rule.name.trim()}>
              {busy === 'save' ? 'Saving…' : editing ? 'Save rule' : 'Turn on rule'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        <Group title="Start from a template" hint="Tap one to fill the form, then change anything.">
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => {
              const on = ruleSentence(t.rule(workspace.id)) === ruleSentence(rule)
              return (
                <button
                  key={t.title}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setRule(t.rule(workspace.id))
                    setMissed(null)
                  }}
                  className={`flex min-h-[92px] flex-col items-start gap-1 rounded-card border p-3 text-left transition-colors ${on ? 'border-proof-leaf-line bg-proof-leaf-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-pf-hover'}`}
                >
                  <span className="flex items-center gap-1.5 text-proof-small font-medium text-ink">
                    {on ? <Check size={13} strokeWidth={2.2} aria-hidden className="text-proof-leaf" /> : null}
                    {t.title}
                  </span>
                  <span className="text-proof-label leading-snug text-ink-2">{ruleSentence(t.rule(workspace.id))}</span>
                </button>
              )
            })}
          </div>
        </Group>

        <Group title="Or describe it in your own words" hint="Willow reads it into the form below with fixed patterns; check the fields before you save.">
          <label htmlFor={`${ids}-typed`} className="sr-only">
            Describe the rule
          </label>
          <textarea
            id={`${ids}-typed`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder={TEMPLATES[0].text}
            className="w-full resize-y rounded-ctl border border-line bg-surface px-3 py-2 text-proof-body text-ink placeholder:text-ink-3 hover:border-line-strong"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void read()} disabled={busy !== null || typed.trim().length < 3}>
              <Wand2 size={14} strokeWidth={1.7} aria-hidden />
              {busy === 'parse' ? 'Reading…' : 'Fill the form'}
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(PATTERN).then(() => toast('Pattern copied'), () => undefined)
              }}
            >
              <Copy size={14} strokeWidth={1.7} aria-hidden />
              Copy the pattern
            </Button>
          </div>
          <p className="m-0 rounded-ctl bg-pf-bg2 px-3 py-2 font-mono text-proof-label leading-relaxed text-ink-2">{PATTERN}</p>
          {missed ? (
            <p role="status" className="m-0 text-proof-small text-ink-2">
              {missed.length ? `Filled in. Not found in your words, so kept as the default: ${missed.join('; ')}.` : 'Filled in from your words. Check the fields below.'}
            </p>
          ) : null}
        </Group>

        <Group title="1 · When to start">
          <Field label="Name">
            <input value={rule.name} maxLength={60} onChange={(e) => set('name', e.target.value)} className="h-9 w-full max-w-[320px] rounded-ctl border border-line bg-surface px-3 text-proof-body text-ink hover:border-line-strong" />
          </Field>
          <Field label="Products">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-proof-small text-ink-2">{brandRule ? `Your ${workspace.label.replace(/ workspace$/, '')} products in` : 'Any brand’s products in'}</span>
              <Select label="Category" hideLabel value={rule.scope.category ?? 'any'} options={[{ value: 'any', label: 'Any category' }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} onChange={(v) => set('scope', { ...rule.scope, category: v === 'any' ? null : v })} />
            </div>
          </Field>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-proof-small font-medium text-ink">Trigger</legend>
            {TRIGGERS.map((t) => (
              <Radio key={t.id} name={`${ids}-trigger`} checked={rule.trigger.kind === t.id} onChange={() => set('trigger', { ...rule.trigger, kind: t.id })} label={t.label} hint={t.hint} />
            ))}
          </fieldset>
          {rule.trigger.kind === 'unmet_need' ? (
            <Field label="Under-served means">
              <Select label="Share with no change" hideLabel value={String(rule.trigger.unmet_min)} options={[0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((x) => ({ value: String(x), label: `${Math.round(x * 100)}% or more see no change by week 8` }))} onChange={(v) => set('trigger', { ...rule.trigger, unmet_min: Number(v) })} />
            </Field>
          ) : null}
          <Field label="For goals" hint={rule.trigger.goals.length ? undefined : 'None picked: any goal the evidence covers.'}>
            <div className="flex flex-wrap gap-1.5">
              {GOALS.map((g) => {
                const on = rule.trigger.goals.includes(g.id)
                return (
                  <button key={g.id} type="button" aria-pressed={on} onClick={() => toggleGoal(g.id)} className={`hit44 inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-proof-small transition-colors ${on ? 'border-proof-leaf-line bg-proof-leaf-soft text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'}`}>
                    {on ? <Check size={12} strokeWidth={2.2} aria-hidden className="text-proof-leaf" /> : null}
                    {g.label}
                  </button>
                )
              })}
            </div>
          </Field>
        </Group>

        <Group title="2 · The campaign it starts" hint="The audience is narrowed to the goals and skin types the evidence covers; the card uses the product’s claim-ready statement.">
          <Field label="Length">
            <Segmented label="Length" options={(['7', '14', '30'] as const).map((d) => ({ value: d, label: `${d} days` }))} value={String(rule.action.days) as '7' | '14' | '30'} onChange={(v) => set('action', { ...rule.action, days: Number(v) as 7 | 14 | 30 })} />
          </Field>
          <Field label="Holdout" hint="Shoppers who match but never see the card, to measure the lift.">
            <Select label="Holdout" hideLabel value={String(rule.action.holdout_pct)} options={[0.1, 0.2, 0.3, 0.4, 0.5].map((x) => ({ value: String(x), label: `${Math.round(x * 100)}% of matching shoppers` }))} onChange={(v) => set('action', { ...rule.action, holdout_pct: Number(v) })} />
          </Field>
          <Field label="At a time">
            <Segmented label="Running at a time" options={(['1', '2', '3'] as const).map((n) => ({ value: n, label: `Max ${n}` }))} value={String(rule.action.max_running) as '1' | '2' | '3'} onChange={(v) => set('action', { ...rule.action, max_running: Number(v) })} />
          </Field>
        </Group>

        <Group title="3 · How much it does on its own">
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Control level</legend>
            {LEVELS.map((l) => (
              <Radio key={l.id} name={`${ids}-level`} checked={rule.level === l.id} onChange={() => set('level', l.id)} label={l.label} hint={l.hint} />
            ))}
          </fieldset>
        </Group>

        <Group title="Optional conditions">
          <label className="flex items-center gap-2.5 text-proof-body text-ink">
            <input type="checkbox" checked={rule.conditions.in_store} onChange={(e) => set('conditions', { ...rule.conditions, in_store: e.target.checked })} className="size-4 accent-[var(--proof-leaf)]" />
            Only products sold in at least one store
          </label>
          <div className="flex flex-wrap gap-4">
            <Field label="From">
              <input type="date" value={rule.conditions.start_on ?? ''} onChange={(e) => set('conditions', { ...rule.conditions, start_on: e.target.value || null })} className="h-9 rounded-ctl border border-line bg-surface px-2 text-proof-small text-ink" />
            </Field>
            <Field label="Until (a launch or season end)">
              <input type="date" value={rule.conditions.stop_after ?? ''} min={rule.conditions.start_on ?? undefined} onChange={(e) => set('conditions', { ...rule.conditions, stop_after: e.target.value || null })} className="h-9 rounded-ctl border border-line bg-surface px-2 text-proof-small text-ink" />
            </Field>
          </div>
          <Field label="Monthly cap" hint="Willow has no prices yet, so the budget is a cap on new campaigns a month.">
            <Select label="Monthly cap" hideLabel value={String(rule.conditions.monthly_cap ?? 'none')} options={[{ value: 'none', label: 'No cap' }, ...[1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `At most ${n} new a month` }))]} onChange={(v) => set('conditions', { ...rule.conditions, monthly_cap: v === 'none' ? null : Number(v) })} />
          </Field>
        </Group>

        <section aria-labelledby={`${ids}-reads`} className="flex flex-col gap-2 rounded-card border border-line bg-pf-bg2 p-4">
          <h3 id={`${ids}-reads`} className="m-0 text-proof-small font-medium text-ink-2">
            Reads as
          </h3>
          <p className="m-0 text-proof-body text-ink" aria-live="polite">
            {ruleSentence(rule)}
          </p>
        </section>

        <p className="m-0 flex items-start gap-2 text-proof-small text-ink-2">
          <ShieldCheck size={15} strokeWidth={1.7} aria-hidden className="mt-px shrink-0 text-proof-leaf" />
          Whatever the rule says, it only promotes Proven products, only to goals and skin types with a positive lift, at most 3 running at once, always labelled Sponsored and always with a holdout. A campaign it started is paused at once if the product slips below Proven.
        </p>
      </div>
    </SidePanel>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-proof-h text-ink">{title}</h3>
        {hint ? <p className="m-0 text-proof-small text-ink-2">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-proof-small font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-proof-label text-ink-2">{hint}</span> : null}
    </div>
  )
}

function Radio({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-card border px-3 py-2.5 transition-colors ${checked ? 'border-proof-leaf-line bg-proof-leaf-soft' : 'border-line hover:border-line-strong hover:bg-pf-hover'}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-4 accent-[var(--proof-leaf)]" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-proof-body font-medium text-ink">{label}</span>
        <span className="text-proof-small text-ink-2">{hint}</span>
      </span>
    </label>
  )
}
