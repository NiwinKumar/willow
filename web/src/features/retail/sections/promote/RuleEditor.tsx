import { Check, Copy, ShieldCheck, Wand2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { api, ApiError, type AutoRule, type RuleBody } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { PATTERN, ruleSentence, TEMPLATES } from '../../autopilot'
import { Button, SidePanel } from '../../ui'

/*
 * The AutoCampaign rule editor (side panel), plain language only: tap a template or describe the rule in your
 * own words; Gemini reads the words into the rule (api autopilot/parse, checked by the form's own rules) and the
 * one-line "Reads as" shows what will be saved before it is turned on. Saving words that weren't read yet reads
 * them first. A template is used as it is, without a Gemini call.
 */

type Props = { open: boolean; onClose: () => void; workspace: { id: string; label: string }; editing: AutoRule | null; template?: number | null; onSaved: (r: AutoRule) => void }

const bodyOf = (r: AutoRule): RuleBody => ({ name: r.name, workspace: r.workspace, enabled: r.enabled, level: r.level, scope: r.scope, trigger: r.trigger, conditions: r.conditions, action: r.action })

export function RuleEditor({ open, onClose, workspace, editing, template = null, onSaved }: Props) {
  const { getIdToken } = useAuth()
  const picked = !editing && template !== null ? (TEMPLATES[template] ?? null) : null
  // The words, and the rule they were read into (`readFor`: the words that rule belongs to). The parent remounts
  // this per opening: an edited rule starts from its own sentence, a tapped template from its text.
  const [typed, setTyped] = useState(editing ? editing.sentence : (picked?.text ?? ''))
  const [rule, setRule] = useState<RuleBody | null>(editing ? bodyOf(editing) : picked ? picked.rule(workspace.id) : null)
  const [readFor, setReadFor] = useState<string | null>(editing ? editing.sentence : (picked?.text ?? null))
  const [missed, setMissed] = useState<string[] | null>(null)
  const [source, setSource] = useState<'gemini' | 'rules' | null>(null)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useId()
  const fresh = rule !== null && readFor === typed.trim()

  const pickTemplate = (i: number) => {
    const t = TEMPLATES[i]
    setTyped(t.text)
    setRule(t.rule(workspace.id))
    setReadFor(t.text)
    setMissed(null)
    setSource(null)
    setError(null)
  }

  /** Gemini reads the words into a rule; returns it (null when it couldn't). */
  const read = async (): Promise<RuleBody | null> => {
    const text = typed.trim()
    if (text.length < 3) return null
    setBusy('read')
    setError(null)
    try {
      const out = await api.parseRule(await getIdToken(), text, workspace.id)
      const r = { ...out.rule, workspace: workspace.id, ...(editing ? { name: editing.name, enabled: editing.enabled } : {}) }
      setRule(r)
      setReadFor(text)
      setMissed(out.missed)
      setSource(out.source ?? null)
      return r
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t read that rule. Check the connection and try again.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    const r = fresh ? rule : await read()
    if (!r) return
    setBusy('save')
    setError(null)
    try {
      const t = await getIdToken()
      const saved = editing ? await api.replaceRule(t, editing.id, r) : await api.createRule(t, r)
      onSaved(saved)
      toast(editing ? `Rule saved · ${saved.name}` : `Rule on · ${saved.name}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save the rule. Check the connection and try again.')
    } finally {
      setBusy(null)
    }
  }

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
          {fresh && rule ? (
            <div aria-live="polite" className="flex flex-col gap-1 rounded-card border border-line bg-pf-bg2 px-3 py-2.5">
              <span className="text-proof-label font-medium text-ink-2">Reads as</span>
              <span className="text-proof-small text-ink">{ruleSentence(rule)}</span>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 rounded-ctl border border-pf-red/40 bg-pf-red-soft px-3 py-2 text-proof-small text-ink">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => void save()} disabled={busy !== null || typed.trim().length < 3}>
              {busy === 'read' ? 'Reading…' : busy === 'save' ? 'Saving…' : editing ? 'Save rule' : 'Turn on rule'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        <Group title="Start from a template" hint="Tap one to use it, or change its words below.">
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t, i) => {
              const on = typed === t.text && readFor === t.text
              return (
                <button
                  key={t.title}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pickTemplate(i)}
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

        <Group title="Or describe it in your own words" hint="Gemini reads it into the rule; check “Reads as” before you turn it on.">
          <label htmlFor={`${ids}-typed`} className="sr-only">
            Describe the rule
          </label>
          <textarea
            id={`${ids}-typed`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder={TEMPLATES[0].text}
            className="w-full resize-y rounded-ctl border border-line bg-surface px-3 py-2 text-proof-body text-ink placeholder:text-ink-3 hover:border-line-strong"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void read()} disabled={busy !== null || typed.trim().length < 3 || fresh}>
              <Wand2 size={14} strokeWidth={1.7} aria-hidden />
              {busy === 'read' ? 'Reading…' : fresh ? 'Read' : 'Read it'}
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
          {fresh && missed ? (
            <p role="status" className="m-0 text-proof-small text-ink-2">
              {source === 'rules' ? 'Gemini was unavailable, so fixed word patterns read it. ' : ''}
              {missed.length ? `Not in your words, so kept as the default: ${missed.join('; ')}.` : 'Read from your words.'}
            </p>
          ) : null}
        </Group>

        <p className="m-0 flex items-start gap-2 text-proof-small text-ink-2">
          <ShieldCheck size={15} strokeWidth={1.7} aria-hidden className="mt-px shrink-0 text-proof-leaf" />
          Whatever the rule says, it only promotes Proven products, only to goals and skin types with a positive lift, at most 3 running at once, always labelled Sponsored and always with a holdout.
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
