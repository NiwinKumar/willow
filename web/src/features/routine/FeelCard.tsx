import { X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react'

import { Chip } from '../../components/ui/Chip'
import { useOwner } from '../../data/hooks'
import type { FeelTag, FeelVerdict, RoutineEntry } from '../../data/types'
import { localDay } from '../../lib/api'
import type { Outcome } from '../../lib/outcome'
import { addDays } from './schedule'
import { MAX_TAGS, PRIVACY_LINE, SNOOZE_DAYS, TAGS, VERDICTS, VERDICT_LABEL, feelNudge, feelVsReadings, type FeelNudge as FeelNudgeT, nudgeQuestion, orderTags, saidLine, snoozed, toggleTag } from './feel'
import { ProductImage } from './productUi'
import { entryName, imageOf } from './routineModel'
import { failureText, useRoutineWrites } from './writes'

const FAIL = "Couldn't save how it feels. Nothing changed; try again."

/** The three verdicts as one-tap pills (aria-pressed), 44px tall, wrapping on a phone. */
function VerdictButtons({ value, disabled, onPick, label, onDark, compact }: { value: FeelVerdict | null; disabled?: boolean; onPick: (v: FeelVerdict) => void; label: string; onDark?: boolean; compact?: boolean }) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {VERDICTS.map((v) => {
        const on = v.id === value
        const tone = on ? 'bg-selected text-inverse' : onDark ? 'bg-white text-ink' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5'
        return (
          <button key={v.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => !on && onPick(v.id)} className={`rounded-pill transition-[background,scale] duration-200 active:scale-[.97] disabled:opacity-60 ${compact ? 'hit44 min-h-8 px-2.5 text-[12.5px] sm:px-3 sm:text-[13px]' : 'min-h-11 px-4 text-[14px]'} ${tone}`}>
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * "How does it feel?" in the product sheet: the person's own verdict, then up to four look-and-feel tags,
 * saved on tap. Self-reported, so it sits next to the readings and is never shown as a score. `outcome`
 * (the readings since start) adds one line setting the two side by side, never as cause.
 */
export function FeelCard({ entry, outcome, ref }: { entry: RoutineEntry; outcome: Outcome | null; ref?: Ref<HTMLElement> }) {
  const writes = useRoutineWrites()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const feel = entry.feel ?? null
  const tags = feel?.tags ?? []
  const full = tags.length >= MAX_TAGS

  const save = async (verdict: FeelVerdict, next: FeelTag[]) => {
    setSaving(true)
    setError(null)
    try {
      await writes.setFeel(entry, verdict, orderTags(next))
    } catch (e) {
      setError(failureText(e, FAIL))
    } finally {
      setSaving(false)
    }
  }
  const compare = feel && outcome ? feelVsReadings(feel.verdict, outcome.kind) : null

  return (
    <section ref={ref} aria-labelledby={headingId} aria-busy={saving || undefined} className="card flex scroll-mt-4 flex-col gap-3 bg-sunken px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <h4 id={headingId} className="text-[17px] font-normal">
          How does it feel?
        </h4>
        <span className="text-[13px] text-ink-2">Your own view, kept next to your readings, never mixed into them.</span>
      </div>
      <VerdictButtons label="How it’s going for you" value={feel?.verdict ?? null} disabled={saving} onPick={(v) => void save(v, tags)} />
      {feel ? (
        <div className="flex flex-col gap-2" style={{ animation: 'wRise .35s both' }}>
          <span id={`${headingId}-tags`} className="text-[13px] text-ink-2">
            How it looks and feels · pick up to {MAX_TAGS}
          </span>
          <div role="group" aria-labelledby={`${headingId}-tags`} className="flex flex-wrap gap-1.5">
            {TAGS.map((t) => {
              const on = tags.includes(t.id)
              return (
                <Chip key={t.id} selected={on} disabled={saving || (full && !on)} onToggle={() => void save(feel.verdict, toggleTag(tags, t.id))} className="hit44 disabled:opacity-45">
                  {t.label}
                </Chip>
              )
            })}
          </div>
        </div>
      ) : null}
      {feel ? (
        <p className="text-[14px] leading-[1.45]" aria-live="polite">
          {saving ? 'Saving…' : saidLine(feel)}
        </p>
      ) : null}
      {compare ? <p className="text-[13px] leading-[1.5] text-ink-2">{compare}</p> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-avoid">
          {error}
        </p>
      ) : null}
      <p className="text-[12px] leading-[1.45] text-ink-2">{PRIVACY_LINE}</p>
    </section>
  )
}

const snoozeKey = (uid: string | null) => `willow.feelNudge.${uid ?? 'anon'}`
function readSnooze(uid: string | null): string | null {
  try {
    return localStorage.getItem(snoozeKey(uid))
  } catch {
    return null
  }
}
function writeSnooze(uid: string | null, until: string) {
  try {
    localStorage.setItem(snoozeKey(uid), until)
  } catch {
    /* private mode: hidden for this visit only */
  }
}

/**
 * The routine's one-product check-in: "Quick check: how's X after N weeks?" with the three verdicts. After a
 * tap it thanks the person and offers the product sheet for tags; no second product is asked about on the
 * same visit. "Not now" hides it for SNOOZE_DAYS (this device).
 */
export function FeelNudge({ entries, onOpen }: { entries: RoutineEntry[]; onOpen: (e: RoutineEntry) => void }) {
  const uid = useOwner()
  const writes = useRoutineWrites()
  const today = localDay()
  const [hidden, setHidden] = useState(() => snoozed(readSnooze(uid), today))
  const [answered, setAnswered] = useState<{ entry: RoutineEntry; verdict: FeelVerdict } | null>(null)
  const [saving, setSaving] = useState<FeelVerdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nudge = useMemo(() => feelNudge(entries, today), [entries, today])
  const headingId = useId()
  // Pinned once tapped: the optimistic answer drops it from feelNudge, and no other product may slide in.
  const [asking, setAsking] = useState<FeelNudgeT | null>(null)
  const shown = asking ?? nudge
  // the tapped button is gone once the thanks shows: keyboard focus moves to the thanks, not the page top
  const thanks = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (answered) thanks.current?.focus()
  }, [answered])

  if (hidden || (!answered && !shown)) return null

  const pick = async (n: FeelNudgeT, verdict: FeelVerdict) => {
    const entry = n.entry
    setAsking(n)
    setSaving(verdict)
    setError(null)
    try {
      await writes.setFeel(entry, verdict, entry.feel?.tags ?? [])
      setAnswered({ entry, verdict })
    } catch (e) {
      setError(failureText(e, FAIL))
    } finally {
      setSaving(null)
    }
  }
  const notNow = () => {
    writeSnooze(uid, addDays(today, SNOOZE_DAYS))
    setHidden(true)
  }

  if (answered)
    return (
      <section aria-labelledby={headingId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[20px] border border-line bg-white/55 px-3.5 py-2 backdrop-blur-sm" style={{ animation: 'wRise .35s both' }}>
        <ProductImage product={imageOf(answered.entry)} size={28} decorative />
        <div className="flex min-w-0 flex-1 basis-[220px] items-baseline gap-x-2 gap-y-0 flex-wrap" role="status">
          <h2 id={headingId} ref={thanks} tabIndex={-1} className="text-[14px] font-normal outline-none">
            Thanks, saved.
          </h2>
          <span className="text-[12.5px] leading-[1.4] text-ink-2">
            {entryName(answered.entry)}: “{VERDICT_LABEL[answered.verdict]}”. Only you see it.
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onOpen(answered.entry)} className="hit44 min-h-8 rounded-pill px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5">
            Add how it feels
          </button>
          <button type="button" onClick={() => setHidden(true)} aria-label="Close" className="hit44 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
            <X size={16} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
      </section>
    )

  const n = shown!
  return (
    <section aria-labelledby={headingId} aria-busy={saving !== null || undefined} className="relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] border border-line bg-white/55 py-2.5 pr-2 pl-3.5 backdrop-blur-sm">
      <div className="flex min-w-0 flex-1 basis-[280px] items-center gap-3 pr-7 sm:pr-0">
        <ProductImage product={imageOf(n.entry)} size={32} decorative />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={headingId} className="text-[14px] leading-[1.3] font-normal">
            {nudgeQuestion(n, entryName(n.entry))}
          </h2>
          <span className="hidden text-[12px] text-ink-2 sm:block">Your own view, one tap. Only you see it.</span>
        </div>
      </div>
      <VerdictButtons compact label={`How ${entryName(n.entry)} is going for you`} value={null} disabled={saving !== null} onPick={(v) => void pick(n, v)} />
      <button type="button" onClick={notNow} disabled={saving !== null} aria-label="Not now" title="Not now: hides this for a few days" className="hit44 absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/5 disabled:opacity-60 sm:static">
        <X size={16} strokeWidth={1.6} aria-hidden />
      </button>
      {error ? (
        <p role="alert" className="basis-full text-[13px] text-avoid">
          {error}
        </p>
      ) : null}
    </section>
  )
}
