import { useEffect, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { useData } from '../../data/useData'
import { ApiError, api, type ChangeTag, type ChangesPrefill, type ChangesRead } from '../../lib/api'
import { CHANGE_GROUPS, addTags, changesQuestion, routineLines, toggleTag } from '../../lib/changes'
import { useAuth } from '../../lib/useAuth'

const MAX_TEXT = 280

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-10 rounded-pill px-3.5 text-[14px] transition-[background,color] duration-150 ${on ? 'bg-selected text-inverse' : 'border border-ink/12 bg-white text-ink'}`}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  )
}

/**
 * "What's been different since your last check-in?" (api app/changes.py). Asked as its own step right after the
 * photos, while they are measured (and again from the day's result, `edit`). Chips for period, stress, sleep, travel,
 * sport, sun, diet, routine and health; the routine products started or ticked since the last check-in are shown as
 * already known; "Anything else?" is read into chips by Gemini (else a word list) for the person to confirm. Saved on
 * the session; only the person sees it.
 */
export function ChangesPanel(props: { sessionId: string; edit?: boolean; onDone: () => void; onSkip?: () => void }) {
  const { sessionId, edit } = props
  const { getIdToken } = useAuth()
  const data = useData()
  const [prefill, setPrefill] = useState<ChangesPrefill | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [tags, setTags] = useState<ChangeTag[]>([])
  const [text, setText] = useState('')
  const [read, setRead] = useState<ChangesRead | null>(null)
  const [readFor, setReadFor] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState<'save' | 'nothing' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getIdToken()
      .then((t) => api.checkInChanges(t, sessionId))
      .then((p) => {
        if (!alive) return
        // Already answered (a reload of the flow): the step is done, unless the person came to edit it.
        if (p.changes && !edit) return props.onDone()
        setPrefill(p)
        if (p.changes) {
          setTags(p.changes.tags)
          setText(p.changes.other ?? '')
        }
      })
      .catch(() => alive && setLoadFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per session
  }, [sessionId, getIdToken, edit])

  const readText = async () => {
    const t = text.trim()
    if (!t) return
    setReading(true)
    setError(null)
    try {
      const got = await api.readChanges(await getIdToken(), sessionId, t)
      setRead(got)
      setReadFor(t)
      setTags((cur) => addTags(cur, got.tags))
    } catch {
      setError('Could not read that just now. Your words are still saved with your answer.')
    } finally {
      setReading(false)
    }
  }

  const save = async (nothing: boolean) => {
    setSaving(nothing ? 'nothing' : 'save')
    setError(null)
    try {
      const other = nothing ? null : text.trim() || null
      const view = await api.patchSession(await getIdToken(), sessionId, { changes: { tags: nothing ? [] : tags, other, nothing } })
      data.upsert(view)
      props.onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your answer. Try again.')
    } finally {
      setSaving(null)
    }
  }

  const known = prefill ? routineLines(prefill.routine) : []
  const fresh = read && readFor === text.trim() ? read : null
  return (
    <section aria-labelledby="changes-title" className="flex flex-col gap-4">
      {edit ? null : (
        <ol aria-label="Check-in steps" className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 font-mono text-[11px] tracking-[.06em] text-ink-2 uppercase">
          <li>✓ Photos</li>
          <li aria-hidden>·</li>
          <li aria-current="step" className="text-ink">
            What changed
          </li>
          <li aria-hidden>·</li>
          <li>Results</li>
        </ol>
      )}
      <div className="flex flex-col gap-1.5">
        <h2 id="changes-title" className="m-0 text-[clamp(22px,2.6vw,28px)] leading-[1.15] font-light tracking-[-0.01em]">
          {prefill || loadFailed ? changesQuestion(prefill?.since ?? null) : 'What’s been different?'}
        </h2>
        <p className="m-0 text-[14.5px] leading-[1.45] text-ink-2">Skin also follows sleep, stress, your cycle, travel and food. Telling Willow means a product is never credited or blamed for something else.</p>
      </div>

      {known.length ? (
        <div className="flex flex-col gap-1.5 rounded-[20px] bg-sunken px-4 py-3">
          <span className="text-[13px] text-ink-2">Already known from your routine</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14.5px] leading-[1.4]">
            {known.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5">
        {CHANGE_GROUPS.map((g) => (
          <fieldset key={g.id} className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] text-ink-2">{g.label}</legend>
            <div className="flex flex-wrap gap-2">
              {g.chips.map((c) => (
                <Chip key={c.tag} on={tags.includes(c.tag)} label={c.label} onClick={() => setTags((cur) => toggleTag(cur, c.tag))} />
              ))}
            </div>
            {g.chips
              .filter((c) => c.more && tags.includes(c.tag))
              .map((c) => (
                <div key={`${c.tag}-more`} className="flex flex-wrap gap-2 border-l-2 border-ink/10 pl-3">
                  {c.more!.map((m) => (
                    <Chip key={m.tag} on={tags.includes(m.tag)} label={m.label} onClick={() => setTags((cur) => toggleTag(cur, m.tag))} />
                  ))}
                </div>
              ))}
          </fieldset>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="changes-other" className="text-[13px] text-ink-2">
          Anything else? In your own words
        </label>
        <textarea
          id="changes-other"
          value={text}
          maxLength={MAX_TEXT}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          placeholder="Went to Bali for a week, lots of beach, started a new face wash…"
          className="rounded-[18px] bg-white p-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line-subtle)] outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-ink-2">{MAX_TEXT - text.length} characters left</span>
          <Button variant="outline" size="sm" loading={reading} disabled={!text.trim() || readFor === text.trim()} onClick={() => void readText()}>
            Turn into chips
          </Button>
        </div>
        {fresh ? (
          <div className="flex flex-col gap-2 rounded-[18px] bg-sunken px-4 py-3 text-[14px] leading-[1.45]" aria-live="polite">
            <span>{fresh.words.length ? `Added from what you wrote: ${fresh.words.join(', ')}. Untick any that aren’t right.` : 'Nothing in that matched a chip; your words are kept as they are.'}</span>
            {fresh.products.length ? (
              <span>
                You mentioned {fresh.products.map((p) => (p.match ? `${p.match.brand} ${p.match.name}` : p.text)).join(' and ')}. Add {fresh.products.length === 1 ? 'it' : 'them'} to your routine afterwards so Willow can follow {fresh.products.length === 1 ? 'it' : 'them'}.
              </span>
            ) : null}
            {fresh.reaction ? (
              <span role="note" className="rounded-[14px] bg-caution-bg px-3 py-2 text-caution">
                That sounds like your skin reacted to something. If it burns, swells or spreads, stop the product and see a dermatologist. You can log a reaction in Routine.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="m-0 text-[14px] text-caution">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button variant="ink" size="lg" full loading={saving === 'save'} disabled={saving !== null || (!tags.length && !text.trim())} onClick={() => void save(false)}>
          {edit ? 'Save' : 'Save and continue'}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="flex-1" loading={saving === 'nothing'} disabled={saving !== null} onClick={() => void save(true)}>
            Nothing different
          </Button>
          {props.onSkip ? (
            <Button variant="ghost" className="flex-1" disabled={saving !== null} onClick={props.onSkip}>
              {edit ? 'Cancel' : 'Skip for now'}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.45] text-ink-2">Only you see these answers: never brands or Proof. What you type is read by Google’s Gemini to suggest chips.</p>
    </section>
  )
}
