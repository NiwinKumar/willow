import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Sheet } from '../../components/ui/Sheet'
import { Toggle } from '../../components/ui/Toggle'
import { clearQueries, useMe, useOwner, useRoutine } from '../../data/hooks'
import { leaveDemo, useData } from '../../data/useData'
import { api } from '../../lib/api'
import { authErrorText } from '../../lib/authErrors'
import { syncConsent } from '../../lib/consent'
import { identity } from '../../lib/identity'
import type { PhotoTime, ProfilePatch } from '../../lib/api'
import { GOALS, MAX_GOALS } from '../../lib/metrics'
import { browserTz, PHOTO_TIME_CLOCK, PHOTO_TIMES, SKIN_TYPES, WEEKDAYS } from '../../lib/profile'
import { invalidate } from '../../lib/query'
import { prefs, type Consent } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { useDemoStatus } from '../../lib/useDemoStatus'
import { resetChat } from '../advisor/chatStore'
import { dayOf } from '../home/derive'

/**
 * You (Willow App.dc.html, isProfile): who is signed in, goals, photo time, skin type and check-in days (the
 * account's profile, lib/profile), the privacy receipt with the
 * sharing switch, capture setup, service status, delete my data, sign out. Everything shown is the
 * person’s own: Firebase for the account, the api for consent, profile, sessions and routine, this device for the rest.
 */
export default function You() {
  const data = useData()
  const { user } = useAuth()
  const me = identity(user)
  const demo = data.mode === 'demo'
  const goals = data.goals
  const done = data.all.filter((s) => s.status === 'done')
  // Sessions take a few seconds to arrive on a cold load: no false zeros meanwhile.
  const counting = data.status !== 'ready' && !data.all.length
  const stats = [
    { k: 'Sessions', v: counting ? '–' : done.length },
    { k: 'Goals', v: goals.length },
    { k: 'Days tracked', v: counting ? '–' : new Set(data.all.map((s) => dayOf(s.created_at))).size },
  ]
  return (
    <main className="relative mx-auto flex max-w-[1100px] flex-col gap-3.5" style={{ padding: '8px clamp(16px,4vw,40px) 24px' }}>
      <section
        aria-label="Profile"
        className="relative flex flex-wrap items-center gap-[22px] overflow-hidden rounded-[44px] squircle"
        style={{ padding: 'clamp(24px,4vw,40px)', background: 'radial-gradient(60% 80% at 85% 0%, #D8B8FF 0%, #A58BFF 30%, rgba(122,92,255,.35) 55%, #FAFAF8 85%)' }}
      >
        <span
          aria-hidden
          className="grid size-24 flex-none place-items-center rounded-full text-[30px] text-white"
          style={{ background: 'radial-gradient(circle at 40% 30%, #E9DAFF, #7A5CFF 60%, #3A1F9E)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.6), 0 20px 40px -20px rgba(122,92,255,.8)' }}
        >
          {me.initials}
        </span>
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <h1 className="m-0 font-serif text-[clamp(28px,3.25vw,42px)] leading-none font-normal">{demo ? 'Demo journey' : me.name}</h1>
          <span className="text-[15px] text-[#3E3C38]">{demo ? "Our team's own measured check-ins, read-only" : me.guest ? 'Guest on this browser · sessions aren’t backed up' : `${me.email ?? 'Google account'} · signed in with Google`}</span>
        </div>
        {demo ? null : (
          <dl className="m-0 flex flex-wrap gap-2.5">
            {stats.map((s) => (
              <div key={s.k} className="flex min-w-[110px] flex-col-reverse gap-1 rounded-[24px] bg-white/70 px-4 py-3.5">
                <dt className="text-caption text-ink-2">{s.k}</dt>
                <dd className="m-0 font-dot text-[30px] leading-none">{s.v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3.5">
        {demo ? <DemoCard /> : <AccountCard />}
        <GoalsCard demo={demo} />
        {demo ? null : <CheckinCard />}
        {demo ? null : <PrivacyCard />}
        <CaptureSetupCard />
      </div>

      <ServiceStatus />
      {demo ? null : <DeleteCard />}
    </main>
  )
}

function Panel({ label, eyebrow, aside, children }: { label: string; eyebrow: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-[36px] squircle bg-surface p-6">
      <span className="flex justify-between gap-2.5">
        <span className="font-mono text-[12px] text-ink-2">■ {eyebrow}</span>
        {aside}
      </span>
      {children}
    </section>
  )
}

const outline = 'min-h-[46px] self-start rounded-pill bg-white px-[18px] text-[14px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)] hover:bg-ink/[.03]'

function DemoCard() {
  const navigate = useNavigate()
  return (
    <Panel label="Demo" eyebrow="DEMO">
      <span className="text-[20px]">You're looking at the demo journey</span>
      <span className="text-[14px] leading-normal text-[#3E3C38]">It is our team's own photos, measured by the live engine, and read-only. Your account, privacy receipt and delete controls are in your own account.</span>
      <button
        type="button"
        className={outline}
        onClick={() => {
          leaveDemo()
          navigate('/home')
        }}
      >
        Leave demo
      </button>
    </Panel>
  )
}

function AccountCard() {
  const { user, signInWithGoogle, signOutUser } = useAuth()
  const me = identity(user)
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [askOut, setAskOut] = useState(false)
  const [leaving, setLeaving] = useState(false)

  async function signIn() {
    const before = user?.uid
    setPending(true)
    setFailed(null)
    try {
      await signInWithGoogle()
      const { firebaseAuth } = await import('../../lib/firebase')
      const after = firebaseAuth.currentUser?.uid
      // Linking keeps the same account (sessions stay where they are). If this Google account already had
      // Willow data, the app switched to it and the guest's sessions stayed with the guest.
      if (before && after && after !== before) toast('Switched to your existing Google account. The guest sessions stay with the guest.')
      else toast('Signed in with Google · your sessions are kept with your account')
    } catch (e) {
      const t = authErrorText(e)
      if (t) setFailed(t === 'Sign-in did not work. Try again.' ? 'Google sign-in didn’t finish. Your guest sessions are unchanged. Try again.' : `${t} Your guest sessions are unchanged.`)
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    setLeaving(true)
    try {
      await signOutUser()
      clearQueries()
      resetChat()
      prefs.clearAll()
      navigate('/', { replace: true })
    } catch {
      setLeaving(false)
      toast.error('Signing out didn’t finish. Try again.')
    }
  }

  return (
    <Panel label="Account" eyebrow="ACCOUNT">
      <span className="text-[20px]">{me.guest ? 'Guest access' : 'Signed in with Google'}</span>
      <span className="text-[14px] leading-normal text-[#3E3C38]">
        {me.guest
          ? 'Sign in with Google to keep your sessions across devices. Your guest account becomes your Google account, so the sessions stay with you.'
          : 'Your sessions are tied to your Google account and available on any device you sign in on.'}
      </span>
      {me.guest ? (
        <>
          <button type="button" onClick={() => void signIn()} disabled={pending} aria-busy={pending || undefined} className="flex min-h-[50px] items-center gap-2.5 self-start rounded-pill bg-white pr-5 pl-2 text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-sunken font-semibold">
              G
            </span>
            {pending ? 'Signing in…' : 'Continue with Google'}
          </button>
          {failed ? (
            <p role="alert" className="m-0 rounded-[16px] bg-avoid-bg px-3.5 py-3 text-[14px]">
              {failed}
            </p>
          ) : null}
        </>
      ) : null}
      <button type="button" onClick={() => setAskOut(true)} className={`${outline} bg-transparent`}>
        Sign out
      </button>
      <Sheet open={askOut} onClose={() => setAskOut(false)} title={me.guest ? 'Sign out as guest?' : 'Sign out?'} variant="modal" size="sm">
        <p className="m-0 leading-[1.55] text-[#3E3C38]">
          {me.guest
            ? 'Guest sessions live only in this browser. If you sign out, you lose access to these results permanently. Sign in with Google first to keep them.'
            : 'Your sessions stay in your account. Sign in again any time to see them.'}
        </p>
        <p className="mt-2 mb-0 text-[13px] text-ink-2">Signing out also clears your goals and settings saved on this device.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void signOut()} disabled={leaving} className={`min-h-[54px] flex-1 rounded-pill text-[15px] text-ink ${me.guest ? 'bg-coral' : 'bg-cta'}`}>
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
          <button type="button" onClick={() => setAskOut(false)} className="min-h-[54px] flex-1 rounded-pill bg-white text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
            Stay signed in
          </button>
        </div>
      </Sheet>
    </Panel>
  )
}

const chip = (on: boolean) => `min-h-11 rounded-pill px-4 text-[14px] transition-colors duration-200 ${on ? 'bg-selected text-inverse' : 'bg-white text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]'}`
const offline = 'Saved on this device; your account updates when you are back online.'

function GoalsCard({ demo }: { demo: boolean }) {
  const { goals, setGoals, profile, saveProfile } = useData()
  const [hint, setHint] = useState(false)
  const save = (next: string[]) => {
    setGoals(next)
    setHint(false)
    toast('Goals saved · results reordered')
  }
  const saveOne = (patch: ProfilePatch, done: string) =>
    saveProfile(patch)
      .then(() => toast(done))
      .catch(() => toast.error(offline))
  return (
    <Panel
      label="Goals and preferences"
      eyebrow="GOALS · UP TO THREE"
      aside={
        <span className="font-dot text-[18px]" aria-live="polite">
          <span className="sr-only">Goals chosen: </span>
          {goals.length}/{MAX_GOALS}
        </span>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {GOALS.map((g) => {
          const on = goals.includes(g.id)
          return (
            <button key={g.id} type="button" aria-pressed={on} onClick={() => (on ? save(goals.filter((x) => x !== g.id)) : goals.length >= MAX_GOALS ? setHint(true) : save([...goals, g.id]))} className={chip(on)}>
              {on ? '✓ ' : ''}
              {g.label}
            </button>
          )
        })}
      </div>
      {hint ? (
        <span role="status" className="text-[13px] text-avoid">
          Three is the limit. Remove one first.
        </span>
      ) : null}
      <span className="text-[13px] text-ink-2">Goals put their measures first in your results{demo ? ', the demo journey included' : ''}.</span>
      {demo ? null : (
        <>
          <span className="text-[14px] text-ink-2">Usual photo time</span>
          <SegmentedControl
            label="Usual photo time"
            className="self-start"
            options={PHOTO_TIMES.map((t) => ({ value: t.id as string, label: t.label }))}
            value={profile.photo_time ?? ''}
            onChange={(v) => void saveOne({ photo_time: v as PhotoTime }, `Usual photo time: ${v}`)}
          />
          <span className="text-[13px] text-ink-2">The same time of day keeps the light comparable.</span>
          <span id="skin-type-label" className="text-[14px] text-ink-2">
            Skin type · optional
          </span>
          <div role="radiogroup" aria-labelledby="skin-type-label" className="flex flex-wrap gap-1.5">
            {[...SKIN_TYPES, { id: null, label: 'Prefer not to say' }].map((t) => (
              <button key={t.label} type="button" role="radio" aria-checked={profile.skin_type === t.id} onClick={() => void saveOne({ skin_type: t.id }, t.id ? `Skin type: ${t.label.toLowerCase()}` : 'Skin type cleared')} className={chip(profile.skin_type === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-ink-2">It never changes a measurement.</span>
        </>
      )}
    </Panel>
  )
}

/** "Your check-in days": weekdays and a time in this browser's time zone, saved to the account (profile.checkin). */
function CheckinCard() {
  const { profile, saveProfile } = useData()
  const saved = profile.checkin
  const days = saved?.days ?? []
  const [time, setTime] = useState(() => saved?.time ?? PHOTO_TIME_CLOCK[profile.photo_time ?? 'evening'])
  const [savedTime, setSavedTime] = useState(saved?.time)
  // The account's schedule can arrive after this card first draws (sign-in on a new device).
  if (saved?.time !== savedTime) {
    setSavedTime(saved?.time)
    if (saved?.time) setTime(saved.time)
  }
  const tz = saved?.tz ?? browserTz()
  const save = (nextDays: number[], nextTime: string, done: string) =>
    saveProfile({ checkin: nextDays.length ? { days: [...nextDays].sort(), time: nextTime, tz: browserTz() } : null })
      .then(() => toast(done))
      .catch(() => toast.error(offline))
  const names = days.map((d) => WEEKDAYS[d])
  return (
    <Panel label="Your check-in days" eyebrow="CHECK-IN DAYS" aside={<span className="font-dot text-[18px]">{days.length}/7</span>}>
      <span className="text-[20px]">{days.length ? `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} at ${time}` : 'No check-in days set'}</span>
      <div role="group" aria-label="Check-in days" className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d, i) => {
          const on = days.includes(i)
          const next = on ? days.filter((x) => x !== i) : [...days, i]
          return (
            <button key={d} type="button" aria-pressed={on} onClick={() => void save(next, time, next.length ? 'Check-in days saved' : 'Check-in days cleared')} className={`${chip(on)} min-w-[56px]`}>
              {d}
            </button>
          )
        })}
      </div>
      <label className="flex flex-wrap items-center gap-3 text-[14px] text-ink-2">
        Time
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => {
            if (days.length && /^\d{2}:\d{2}$/.test(time) && time !== saved?.time) void save(days, time, `Check-in time: ${time}`)
          }}
          className="min-h-11 rounded-pill bg-white px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]"
        />
      </label>
      <span className="text-[13px] text-ink-2">
        Saved to your account. Times are in {tz}
        {saved && saved.tz !== browserTz() ? `; this browser is in ${browserTz()}, and the next change uses it` : ', this browser’s time zone'}. Once a week is enough; the same day and time keeps photos comparable.
      </span>
    </Panel>
  )
}

/** "2026-10-13" (the consent's terms date) as "13 Oct 2026"; any other version string as it is. */
function fmtVersion(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : v
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function PrivacyCard() {
  const { getIdToken } = useAuth()
  const uid = useOwner()
  const me = useMe()
  const server = me.data?.consent ?? null
  const [local, setLocal] = useState<Consent | null>(() => prefs.consent())
  const consent: Consent | null = local ?? (server ? { version: server.version, accepted_at: server.accepted_at, aggregate_opt_in: server.aggregate_insights_opt_in } : null)
  const share = consent?.aggregate_opt_in ?? false

  const onShare = (on: boolean) => {
    if (!consent || !uid) return
    const next = { ...consent, aggregate_opt_in: on }
    prefs.setConsent(next)
    setLocal(next)
    syncConsent(uid, getIdToken)
      .then(() => {
        invalidate(['me', uid])
        toast(on ? 'Aggregate sharing on' : 'Aggregate sharing off · future aggregates exclude you')
      })
      .catch(() => toast.error('Saved on this device; your account updates when you are back online.'))
  }

  const rows: [string, string][] = [
    ...(consent
      ? ([
          ['Consent version', fmtVersion(consent.version)],
          ['Accepted', fmtWhen(consent.accepted_at)],
        ] as [string, string][])
      : ([['Consent', 'Not recorded on this device or account']] as [string, string][])),
    ['On your account', me.status === 'loading' ? 'Checking…' : server ? `Saved · sharing ${server.aggregate_insights_opt_in ? 'on' : 'off'}` : me.status === 'error' ? 'Couldn’t check' : 'Not saved yet'],
    // Same retention as the consent (Welcome): previews and spot close-ups live under results/, which the bucket deletes at 30 days.
    ['Original photos and previews', 'Deleted 30 days after upload'],
    ['Measurements', 'Kept until you delete them'],
    ['AI use', 'Explanations, spot labels, label reading, routine check, advisor'],
    ['Scope', 'Cosmetic appearance only'],
  ]
  return (
    <Panel label="Privacy receipt" eyebrow="PRIVACY RECEIPT">
      <dl className="m-0 flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-2.5 text-[14px]">
            <dt className="text-ink-2">{k}</dt>
            <dd className="m-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-[20px] bg-sunken px-4 py-2">
        <Toggle
          label="Anonymized aggregate sharing"
          checked={share}
          disabled={!consent}
          onChange={onShare}
          description={!consent ? 'Available once you have accepted the terms before your first photo.' : share ? 'On · included only in groups of 10 or more' : 'Off · your results stay out of retailer aggregates'}
        />
      </div>
      <details className="text-[14px] leading-[1.55]">
        <summary className="flex min-h-11 cursor-pointer items-center">{consent ? 'Read the consent you agreed to' : 'Read the consent'}</summary>
        <p className="mt-1.5 mb-0 text-[#3E3C38]">
          Willow stores your original photos privately for 30 days, then deletes them, with their small previews and spot close-ups. Measurements, verdicts and spot locations stay until you delete them. Gemini explains measured results, labels detected spots, reads ingredient labels, checks routines and answers the advisor; it does not produce measurements. Willow tracks cosmetic appearance only and does not diagnose.
        </p>
      </details>
    </Panel>
  )
}

function CaptureSetupCard() {
  const [recorded, setRecorded] = useState(() => prefs.lightroomDone())
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle')
  const title = step === 'done' ? '✓ Reset · setup guide will show next time' : recorded ? 'RAW setup recorded on this device' : 'No RAW setup recorded on this device'
  return (
    <Panel label="Capture setup" eyebrow="CAPTURE SETUP">
      <span className="text-[18px]">{title}</span>
      <span className="text-[14px] leading-normal text-[#3E3C38]">
        {recorded || step === 'done' ? 'Resetting shows the Lightroom setup guide again on your next RAW session. Your sessions and baselines are not affected.' : 'The Lightroom setup guide shows on your next RAW session.'}
      </span>
      {recorded && step === 'idle' ? (
        <button type="button" onClick={() => setStep('confirm')} className={outline}>
          Reset capture setup
        </button>
      ) : null}
      {step === 'confirm' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              prefs.setLightroomDone(false)
              setRecorded(false)
              setStep('done')
              toast('Capture setup reset')
            }}
            className="min-h-[46px] rounded-pill bg-selected px-[18px] text-[14px] text-inverse"
          >
            Yes, reset
          </button>
          <button type="button" onClick={() => setStep('idle')} className={outline}>
            Cancel
          </button>
        </div>
      ) : null}
      <Link to="/science" className="min-h-11 self-start py-2 text-[14px] underline underline-offset-4">
        Science and limitations
      </Link>
    </Panel>
  )
}

/** Live where a live check exists (api, engine); configuration only for Gemini and storage, and said so. */
function ServiceStatus() {
  const { status, failed, waking, gaveUp } = useDemoStatus()
  const ok = 'var(--willow-400)'
  const quiet = 'var(--signal-noise)'
  const chips: { label: string; dot: string; title?: string }[] = []
  if (failed) chips.push({ label: 'Service status unavailable', dot: quiet })
  else if (!status) chips.push({ label: 'Checking…', dot: quiet })
  else {
    const e = status.engine.status
    chips.push({ label: 'Willow api', dot: status.api.status === 'ok' ? ok : quiet })
    chips.push({ label: e === 'ok' ? 'Measurement engine' : waking ? (gaveUp ? 'Measurement engine · still waking' : 'Measurement engine · waking up') : 'Measurement engine · unreachable', dot: e === 'ok' ? ok : waking ? 'var(--aura-apricot)' : quiet })
    chips.push({ label: `AI explanations · ${status.gemini.model}`, dot: quiet, title: 'Configuration only; not checked live' })
    chips.push({ label: 'Storage · configured', dot: quiet, title: 'Configuration only; not checked live' })
  }
  return (
    <section aria-label="Service status" className="flex flex-wrap items-center gap-2.5 rounded-[36px] squircle bg-surface/70 px-6 py-5" aria-live="polite">
      <span className="mr-1.5 font-mono text-[12px] text-ink-2">■ SERVICE</span>
      {chips.map((c) => (
        <span key={c.label} title={c.title} className="flex items-center gap-2 rounded-pill bg-white px-3.5 py-2 text-[13px]">
          <span aria-hidden className="size-2 rounded-full" style={{ background: c.dot }} />
          {c.label}
        </span>
      ))}
      {status ? <span className="text-caption text-ink-2">Checked {new Date(status.checked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. AI and storage show configuration only.</span> : null}
    </section>
  )
}

type DelState = 'idle' | 'confirm' | 'deleting' | 'done' | 'failed'

function DeleteCard() {
  const { user, getIdToken, signOutUser } = useAuth()
  const data = useData()
  const routine = useRoutine()
  const navigate = useNavigate()
  const [state, setState] = useState<DelState>('idle')
  const [word, setWord] = useState('')
  const guest = identity(user).guest
  // The server copy is gone once state is done; the sign-in itself is removed on "Back to start" (or when
  // leaving this page), because the app shell sends anyone signed out to sign-in at once.
  const pending = useRef(false)

  const count = (pred: (site: string) => boolean) => data.all.filter((s) => pred(s.site)).length
  const parts = [
    [count((s) => s === 'face_full'), 'face check-in', 'face check-ins'],
    [count((s) => s === 'cheek_macro' || s === 'nose_macro'), 'close-up', 'close-ups'],
    [count((s) => s.startsWith('forearm')), 'forearm photo session', 'forearm photo sessions'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
  const products = routine.data?.length ?? 0
  if (products) parts.push(`your routine (${products} product${products === 1 ? '' : 's'})`)
  const what = parts.length ? `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]} will be removed, with your ${guest ? 'guest' : 'Willow'} account.` : `Your ${guest ? 'guest' : 'Willow'} account will be removed.`

  const removeAccount = async () => {
    if (!pending.current) return
    pending.current = false
    try {
      const { deleteUser } = await import('firebase/auth')
      if (!user) throw new Error('no user')
      await deleteUser(user)
    } catch {
      // Google may ask for a recent sign-in before removing the sign-in itself; the data is already gone.
      await signOutUser().catch(() => undefined)
    }
    clearQueries()
    resetChat()
    prefs.clearAll()
    // Drop the sessions the app still holds in memory (the server copy is already gone).
    void data.refresh()
  }
  // Leaving the page without pressing Back to start still finishes it.
  const finish = useRef(removeAccount)
  useEffect(() => {
    finish.current = removeAccount
  })
  useEffect(() => () => void finish.current(), [])

  async function run() {
    setState('deleting')
    try {
      await api.deleteMe(await getIdToken())
      pending.current = true
      setState('done')
    } catch {
      setState('failed')
    }
  }

  const TEXT: Record<DelState, [string, string]> = {
    idle: ['Remove everything Willow holds about you', 'Photos, previews, measurements, notes, routine ticks and your account. Aggregate figures already shared stay anonymous and cannot be traced back.'],
    confirm: ['Are you sure?', `This can’t be undone. ${what}`],
    deleting: ['Deleting…', 'Removing photos and results. Keep this page open.'],
    done: ['✓ Your data has been deleted', 'Willow no longer holds your photos, results, notes or routine. Back to start signs you out and removes the account itself.'],
    failed: ['Deletion didn’t finish', 'The connection dropped part-way. Run it again to finish; anything not yet removed is removed then.'],
  }
  const [title, text] = TEXT[state]
  const btn = 'min-h-[50px] rounded-pill px-5 text-[15px]'
  return (
    <section aria-label="Delete my data" aria-live="polite" aria-busy={state === 'deleting' || undefined} className="flex flex-col gap-3.5 rounded-xl squircle bg-selected text-inverse" style={{ padding: 'clamp(22px,3vw,32px)' }}>
      <span className="font-mono text-[12px] text-[#BDBAB4]">■ DELETE MY DATA</span>
      <h2 className="m-0 text-[20px] font-normal">{title}</h2>
      <p className="m-0 max-w-[720px] text-[15px] leading-normal text-[#E4E1DB]">{text}</p>
      {state === 'deleting' ? (
        <span aria-hidden className="block h-1.5 max-w-[420px] overflow-hidden rounded-[6px] bg-[#2A2A2A]">
          <span className="block h-full w-2/5 animate-[wShimmer_1.2s_linear_infinite] rounded-[6px] bg-[length:200%_100%]" style={{ backgroundImage: 'linear-gradient(90deg, transparent, #FF6B4A, transparent)' }} />
        </span>
      ) : null}
      {state === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            setWord('')
            setState('confirm')
          }}
          className={`${btn} self-start bg-coral text-ink`}
        >
          Delete everything
        </button>
      ) : null}
      {state === 'confirm' ? (
        <>
          <label className="flex max-w-[360px] flex-col gap-1.5 text-[14px] text-[#BDBAB4]">
            Type DELETE to confirm
            <input type="text" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="min-h-12 rounded-[14px] border border-[#333] bg-[#1C1C1C] px-3.5 text-[16px] text-inverse" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void run()} disabled={word.trim().toUpperCase() !== 'DELETE'} className={`${btn} bg-coral text-ink`}>
              Delete permanently
            </button>
            <button type="button" onClick={() => setState('idle')} className={`${btn} border border-[#444] bg-transparent text-inverse`}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {state === 'failed' ? (
        <button type="button" onClick={() => void run()} className={`${btn} self-start bg-white text-ink`}>
          Try again
        </button>
      ) : null}
      {state === 'done' ? (
        <button
          type="button"
          onClick={() => {
            void removeAccount().then(() => navigate('/', { replace: true }))
          }}
          className={`${btn} self-start bg-white text-ink`}
        >
          Back to start
        </button>
      ) : null}
    </section>
  )
}
