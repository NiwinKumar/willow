import { X } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'

import { AITag } from '../../components/willow/AITag'
import { AVOID_OPTIONS, LIFE_STAGES, matchIngredients, NOTE_MAX, readNote, useIngredientNames, type AvoidId, type LifeStage, type NoteRead } from '../../lib/safety'
import { useAuth } from '../../lib/useAuth'

/** The fields this block reads, shared by the safety profile (You, "Check products for me") and the plan's draft. */
export type PastValue = { avoid_ingredients: string[]; note: string | null; avoid: AvoidId[]; reactive: boolean | null; life_stage: LifeStage | null }
export type PastPatch = { avoid_ingredients?: string[]; note?: string | null; avoid?: AvoidId[]; reactive?: boolean; life_stage?: LifeStage }

const MAX_NAMES = 30
const chipBase = 'inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-[13.5px] transition-[background-color,box-shadow,scale,opacity] duration-200 ease-standard active:scale-[.96]'

/**
 * "Anything you've reacted to before?" (ingredient names, typeahead from every catalog label and the rule file) and
 * "Tell us about past reactions or breakouts" (a note). "Read my note" asks Willow for suggestions (Gemini, checked
 * against the catalog's ingredient names and the fixed lists; keywords when it can't): each is a chip the person taps
 * to add. Nothing is applied without a tap, and flags are always computed by the fixed rules.
 */
export function PastReactions({ value, onChange, dense = false }: { value: PastValue; onChange: (patch: PastPatch) => void; dense?: boolean }) {
  const ids = useId()
  const { user, getIdToken } = useAuth()
  const [typed, setTyped] = useState('')
  const [focus, setFocus] = useState(false)
  const [active, setActive] = useState(0)
  const names = useIngredientNames(focus || typed.length > 0)
  const options = useMemo(() => matchIngredients(names.data ?? [], typed, value.avoid_ingredients), [names.data, typed, value.avoid_ingredients])
  const input = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<NoteRead | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [readFor, setReadFor] = useState<string | null>(null)

  const add = (name: string) => {
    const clean = name.trim().replace(/\s+/g, ' ')
    setTyped('')
    setActive(0)
    if (clean.length < 2 || value.avoid_ingredients.length >= MAX_NAMES) return
    if (value.avoid_ingredients.some((x) => x.toLowerCase() === clean.toLowerCase())) return
    onChange({ avoid_ingredients: [...value.avoid_ingredients, clean.slice(0, 80)] })
  }
  const remove = (name: string) => onChange({ avoid_ingredients: value.avoid_ingredients.filter((x) => x !== name) })

  const note = value.note ?? ''
  const askWillow = async () => {
    if (!note.trim() || reading) return
    setReading(true)
    setReadError(null)
    try {
      setRead(await readNote(await getIdToken(), note.trim()))
      setReadFor(note)
    } catch {
      setReadError(navigator.onLine ? 'Willow couldn’t read it just now. Try again.' : 'You’re offline. Try again when you’re connected.')
    } finally {
      setReading(false)
    }
  }

  // What is left to suggest: anything already in the answers is not offered again.
  const has = (n: string) => value.avoid_ingredients.some((x) => x.toLowerCase() === n.toLowerCase())
  const groupNames = new Set((read?.suggest.avoid ?? []).map((a) => (AVOID_OPTIONS.find((o) => o.id === a)?.label ?? a).toLowerCase()))
  const offers: { key: string; label: string; apply: () => void }[] = read
    ? [
        ...read.suggest.avoid
          .filter((a) => !value.avoid.includes(a))
          .map((a) => ({ key: `a:${a}`, label: AVOID_OPTIONS.find((o) => o.id === a)?.label ?? a, apply: () => onChange({ avoid: [...value.avoid, a] }) })),
        // a name that is also a suggested group ("Lanolin") is offered once, as the group
        ...read.suggest.avoid_ingredients.filter((n) => !has(n) && !groupNames.has(n.toLowerCase())).map((n) => ({ key: `i:${n}`, label: n, apply: () => add(n) })),
        ...(read.suggest.reactive && value.reactive !== true ? [{ key: 'r', label: 'Skin reacts easily', apply: () => onChange({ reactive: true }) }] : []),
        ...(read.suggest.life_stage && value.life_stage !== read.suggest.life_stage
          ? [{ key: 'l', label: LIFE_STAGES.find((l) => l.id === read.suggest.life_stage)?.label ?? read.suggest.life_stage, apply: () => onChange({ life_stage: read.suggest.life_stage as LifeStage }) }]
          : []),
      ]
    : []

  const listId = `${ids}-list`
  const gap = dense ? 'gap-2' : 'gap-2.5'
  return (
    <div className={`flex flex-col ${dense ? 'gap-3.5' : 'gap-4'}`}>
      <div className={`flex flex-col ${gap}`}>
        <label htmlFor={`${ids}-in`} className="text-[14px] text-ink-2">
          Anything you’ve reacted to before?
        </label>
        {value.avoid_ingredients.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Ingredients you’ve reacted to">
            {value.avoid_ingredients.map((n) => (
              <li key={n} className="animate-[wDotIn_.28s_var(--ease-bounce)_both]">
                <span className={`${chipBase} bg-selected pr-1 text-inverse`}>
                  {n}
                  <button type="button" aria-label={`Remove ${n}`} onClick={() => remove(n)} className="hit44 grid size-6 place-items-center rounded-full bg-white/15 transition-colors hover:bg-white/25">
                    <X size={12} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative">
          <input
            ref={input}
            id={`${ids}-in`}
            type="text"
            role="combobox"
            aria-expanded={focus && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={focus && options.length ? `${ids}-o${active}` : undefined}
            autoComplete="off"
            value={typed}
            maxLength={80}
            placeholder={value.avoid_ingredients.length >= MAX_NAMES ? 'That’s the most you can add' : 'Type an ingredient, e.g. lanolin'}
            disabled={value.avoid_ingredients.length >= MAX_NAMES}
            onFocus={() => setFocus(true)}
            onBlur={() => window.setTimeout(() => setFocus(false), 120)}
            onChange={(e) => {
              setTyped(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && options.length) {
                e.preventDefault()
                setActive((i) => (i + 1) % options.length)
              } else if (e.key === 'ArrowUp' && options.length) {
                e.preventDefault()
                setActive((i) => (i - 1 + options.length) % options.length)
              } else if (e.key === 'Enter' && typed.trim()) {
                e.preventDefault()
                add(options[active] ?? typed)
              } else if (e.key === 'Escape') setTyped('')
            }}
            className="min-h-11 w-full rounded-[16px] bg-white px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_rgba(18,18,18,.45)] disabled:opacity-55"
          />
          {focus && typed.trim().length >= 2 ? (
            <ul id={listId} role="listbox" aria-label="Ingredient names" className="absolute inset-x-0 top-[calc(100%+6px)] z-20 m-0 flex max-h-60 list-none flex-col overflow-y-auto rounded-[16px] bg-surface p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,.35),inset_0_0_0_1px_rgba(18,18,18,.06)] animate-[wRise_.2s_var(--ease-standard)_both]">
              {options.map((o, i) => (
                <li
                  key={o}
                  id={`${ids}-o${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    add(o)
                    input.current?.focus()
                  }}
                  onPointerEnter={() => setActive(i)}
                  className={`cursor-pointer rounded-[12px] px-3 py-2 text-[14px] ${i === active ? 'bg-sunken' : ''}`}
                >
                  {o}
                </li>
              ))}
              <li
                role="option"
                aria-selected={!options.length}
                id={options.length ? undefined : `${ids}-o0`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  add(typed)
                }}
                className="cursor-pointer rounded-[12px] px-3 py-2 text-[13px] text-ink-2"
              >
                Add “{typed.trim()}” as you wrote it
              </li>
            </ul>
          ) : null}
        </div>
        <span className="text-[12.5px] leading-[1.4] text-ink-2">Any product that lists one is marked Not advised for you.</span>
      </div>

      <div className={`flex flex-col ${gap}`}>
        <label htmlFor={`${ids}-note`} className="text-[14px] text-ink-2">
          Tell us about past reactions or breakouts — what happened, which products
        </label>
        <div className="relative">
          <textarea
            id={`${ids}-note`}
            value={note}
            maxLength={NOTE_MAX}
            rows={dense ? 2 : 3}
            placeholder="e.g. A scented moisturiser made my cheeks sting"
            onChange={(e) => onChange({ note: e.target.value.slice(0, NOTE_MAX) || null })}
            className="block w-full resize-none rounded-[16px] bg-white px-3.5 py-2.5 pb-6 text-[15px] leading-[1.45] text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_rgba(18,18,18,.45)]"
          />
          <span aria-live="polite" className={`pointer-events-none absolute right-3 bottom-1.5 font-mono text-[10.5px] tabular-nums ${note.length > NOTE_MAX - 40 ? 'text-ink' : 'text-ink-2'}`}>
            {note.length}/{NOTE_MAX}
          </span>
        </div>
        {user && note.trim().length >= 3 ? (
          <button
            type="button"
            onClick={() => void askWillow()}
            disabled={reading || readFor === note}
            aria-busy={reading}
            className="inline-flex min-h-9 items-center gap-2 self-start rounded-pill bg-white px-3.5 text-[13.5px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] transition-[scale,opacity] duration-200 ease-standard animate-[wFadeIn_.25s_both] hover:bg-ink/[.03] active:scale-[.97] disabled:opacity-55"
          >
            <span aria-hidden className={reading ? 'inline-block animate-[wTurn_1s_linear_infinite]' : ''}>
              ✦
            </span>
            {reading ? 'Reading your note…' : readFor === note ? 'Note read' : 'Have Willow read my note'}
          </button>
        ) : null}
        {readError ? (
          <p role="alert" className="m-0 text-[13px] text-avoid">
            {readError}
          </p>
        ) : null}
        {read ? (
          <div role="status" className="flex flex-col gap-2 rounded-[18px] bg-sunken p-3 animate-[wRise_.35s_var(--ease-standard)_both]">
            <span className="flex flex-wrap items-center gap-2 text-[13.5px]">
              {read.source === 'model' ? <AITag label="AI-read" /> : null}
              {offers.length ? 'Willow read your note: add these?' : read.suggest.avoid.length + read.suggest.avoid_ingredients.length ? 'Willow read your note: all of it is in your answers.' : read.summary}
            </span>
            {offers.length ? (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {offers.map((o, i) => (
                  <li key={o.key} style={{ animation: `wDotIn .28s var(--ease-bounce) ${80 + i * 50}ms both` }}>
                    <button type="button" onClick={o.apply} className={`${chipBase} bg-white shadow-[inset_0_0_0_1px_rgba(18,18,18,.14)] hover:bg-ink/[.03]`}>
                      <span aria-hidden>+</span>
                      {o.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <span className="text-[12px] leading-[1.4] text-ink-2">{read.source === 'model' ? 'Suggestions only, checked against the catalog’s ingredient names. ' : 'Matched by keywords. '}Nothing is added until you tap it.</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
