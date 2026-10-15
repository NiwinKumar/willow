import './website.css'

import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { authErrorText } from '../../lib/authErrors'
import { nextPath } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { HeroBloom } from './Decor'
import { createAccount, emailErrorText, sendReset, signInWithEmail } from './emailAuth'
import { destinationAfterSignIn } from './entry'

type Mode = 'signin' | 'signup'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BAR = ['bg-coral', 'bg-apricot', 'bg-lime', 'bg-willow-400']
const HINT = ['Weak · add a number or symbol', 'Weak · add a number or symbol', 'Okay · a symbol makes it stronger', 'Good', 'Strong']

/** The design's 0-4 strength score: length, case, digits, symbols. */
function strength(pw: string): number {
  const n = pw.length
  return Math.max(0, Math.min(4, Number(n >= 8) + Number(/[A-Z]/.test(pw)) + Number(/[0-9]/.test(pw)) + Number(/[^A-Za-z0-9]/.test(pw)) + Number(n >= 12) - Number(n > 0 && n < 8)))
}

const field = 'min-h-[52px] rounded-[16px] border bg-white px-4 text-[16px] text-ink outline-none transition-colors focus-visible:border-ink'

/**
 * Sign in / create account (/signin, ?mode=signup, ?next=). Google keeps a guest's data by linking the
 * same account; email + password does the same when a guest creates an account. Afterwards: consent and
 * goals for someone new, straight on (to `next` or Home) for someone who already agreed.
 */
export default function SignIn() {
  const { user, loading, signInWithGoogle, continueAsGuest, getIdToken } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const next = params.get('next')
  const mode: Mode = params.get('mode') === 'signup' ? 'signup' : 'signin'
  const up = mode === 'signup'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState<null | 'google' | 'email' | 'guest' | 'reset'>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetFor, setResetFor] = useState<string | null>(null)
  // Set once this page starts signing someone in, so its own result is not mistaken for "already signed in".
  const [acted, setActed] = useState(false)

  useEffect(() => {
    document.title = `${up ? 'Create account' : 'Sign in'} · Willow`
  }, [up])

  // Someone already signed in with an account has nothing to do here.
  if (!loading && user && !user.isAnonymous && !acted) return <Navigate to={nextPath(next, '/home')} replace />

  const emailOk = EMAIL_RE.test(email.trim())
  const score = strength(pw)
  const guest = Boolean(user?.isAnonymous)

  const setMode = (m: Mode) => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (m === 'signup') n.set('mode', 'signup')
        else n.delete('mode')
        return n
      },
      { replace: true },
    )
    setError(null)
    setResetFor(null)
    setTried(false)
  }

  const finish = async () => navigate(await destinationAfterSignIn(getIdToken, next), { replace: true })

  const run = async (kind: 'google' | 'email' | 'guest', action: () => Promise<void>, errorText: (e: unknown) => string | null) => {
    if (pending) return
    setActed(true)
    setPending(kind)
    setError(null)
    setResetFor(null)
    try {
      await action()
    } catch (e) {
      setActed(false)
      setPending(null)
      setError(errorText(e))
      return
    }
    await finish()
  }

  const google = () => void run('google', signInWithGoogle, authErrorText)
  const asGuest = () => void run('guest', continueAsGuest, () => 'Could not start a guest session. Check your connection and try again.')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (up && !name.trim()) return setError('Add your name.')
    if (!emailOk) return setError('That email address doesn’t look right.')
    if (pw.length < 8) return setError('Passwords need at least 8 characters.')
    void run('email', () => (up ? createAccount(name, email.trim(), pw) : signInWithEmail(email.trim(), pw)), (err) => emailErrorText(err, mode))
  }

  const forgot = async () => {
    if (!emailOk) {
      setTried(true)
      return setError('Enter your email first, then choose Forgot password.')
    }
    setPending('reset')
    setError(null)
    try {
      await sendReset(email.trim())
      setResetFor(email.trim())
    } catch (e) {
      setError(emailErrorText(e, 'signin'))
    } finally {
      setPending(null)
    }
  }

  const bad = (b: boolean) => (tried && b ? 'border-coral' : 'border-line')

  return (
    <div className="w-sky relative grid min-h-dvh grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
      <div className="relative flex min-h-[min(40vh,360px)] flex-col justify-between overflow-hidden p-[clamp(20px,3vw,40px)]">
        <HeroBloom className="absolute inset-0" mask="radial-gradient(70% 70% at 50% 50%, #000 40%, transparent 85%)" />
        <Link to="/" className="glass-pill relative flex items-center gap-2.5 self-start rounded-pill py-2 pl-2 pr-4 text-[14px] text-ink no-underline">
          <span aria-hidden className="grid size-[34px] place-items-center rounded-full bg-white">
            ←
          </span>
          Back
        </Link>
        <p className="relative m-0 max-w-[440px] font-serif text-[clamp(34px,4vw,56px)] leading-none">
          Compare your skin with <span className="italic">your</span> skin.
        </p>
      </div>

      <div className="grid place-items-center p-[clamp(16px,4vw,48px)]">
        <main className="flex w-full max-w-[460px] animate-rise flex-col gap-4 rounded-[40px] p-[clamp(22px,4vw,36px)] backdrop-blur-[26px] backdrop-saturate-[1.3]" style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 40px 80px -40px rgba(40,50,110,.45), inset 0 0 0 1px rgba(255,255,255,.6)' }}>
          <div role="tablist" aria-label="Account" className="flex gap-[3px] self-start rounded-pill bg-canvas p-1">
            {(
              [
                ['signin', 'Sign in'],
                ['signup', 'Create account'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mode === k}
                onClick={() => setMode(k)}
                className={`min-h-[42px] rounded-pill px-[18px] text-[14px] transition-colors ${mode === k ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,.08)]' : 'bg-transparent'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-serif text-[clamp(38px,4.4vw,52px)] font-normal leading-none">{up ? 'Create your account' : 'Welcome back'}</h1>
            <span className="text-[15px] leading-[1.45] text-ink-2">
              {up ? 'Your sessions, baselines and routine, kept across devices.' : 'Sign in to see your sessions and baselines.'}
              {guest ? (up ? ' Your guest sessions on this browser move to the new account.' : ' Google keeps this browser’s guest sessions; signing in to an existing email account switches to it.') : ''}
            </span>
          </div>

          <button type="button" onClick={google} disabled={pending !== null} aria-busy={pending === 'google' || undefined} className="flex min-h-14 items-center justify-center gap-3 rounded-[20px] bg-selected text-[16px] text-inverse">
            <span aria-hidden className="grid size-[30px] place-items-center rounded-full bg-white font-semibold text-ink">
              G
            </span>
            {pending === 'google' ? 'Signing in…' : 'Continue with Google'}
          </button>

          <div aria-hidden className="flex items-center gap-3 font-mono text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" />
            OR WITH EMAIL
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            {up ? (
              <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
                Name
                <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" aria-invalid={tried && !name.trim()} className={`${field} ${bad(!name.trim())}`} />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
              Email
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                placeholder="you@example.com"
                aria-invalid={tried && !emailOk}
                className={`${field} ${bad(!emailOk)}`}
              />
            </label>
            <div className="flex flex-col gap-1.5 text-[13px] text-ink-2">
              <span className="flex items-center justify-between">
                <label htmlFor="pw">Password</label>
                {!up ? (
                  <button type="button" onClick={() => void forgot()} disabled={pending !== null} className="min-h-8 text-[13px] text-ink underline">
                    {pending === 'reset' ? 'Sending…' : 'Forgot password?'}
                  </button>
                ) : null}
              </span>
              <span className="relative flex">
                <input
                  id="pw"
                  type={showPw ? 'text' : 'password'}
                  autoComplete={up ? 'new-password' : 'current-password'}
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value)
                    setError(null)
                  }}
                  placeholder={up ? 'At least 8 characters' : 'Your password'}
                  aria-invalid={tried && pw.length < 8}
                  aria-describedby={up ? 'pw-hint' : undefined}
                  className={`${field} flex-1 pr-16 ${bad(pw.length < 8)}`}
                />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1.5 h-10 rounded-[12px] bg-sunken px-3 text-[12px] text-ink">
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </span>
            </div>
            {up ? (
              <div className="flex flex-col gap-1.5">
                <span aria-hidden className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`h-[5px] flex-1 rounded-[5px] transition-colors duration-300 ${i < score ? BAR[Math.max(0, score - 1)] : 'bg-ink/10'}`} />
                  ))}
                </span>
                <span id="pw-hint" className="text-[12px] text-ink-2" aria-live="polite">
                  {!pw.length ? 'Use 8 or more characters.' : pw.length < 8 ? `${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'} needed` : HINT[score]}
                </span>
                <span className="text-[13px] leading-[1.45] text-ink-2">Photo consent comes next, separately.</span>
              </div>
            ) : null}
            {resetFor ? (
              <p role="status" className="m-0 rounded-[16px] bg-lime px-3.5 py-3 text-[14px] text-ink">
                If {resetFor} has an account, a reset link is on its way.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="m-0 rounded-[16px] bg-selected px-3.5 py-3 text-[14px] leading-[1.4] text-inverse">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={pending !== null} className="cta-yellow flex min-h-14 items-center justify-center gap-2.5 rounded-[20px] text-[16px] transition-transform active:scale-[.98]">
              {pending === 'email' ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-ink/25 border-t-ink" /> : null}
              {pending === 'email' ? (up ? 'Creating account…' : 'Signing in…') : up ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="flex flex-wrap justify-between gap-2.5 text-[14px]">
            {guest ? (
              <span className="flex min-h-10 items-center text-ink-2">You are using Willow as a guest.</span>
            ) : (
              <button type="button" onClick={asGuest} disabled={pending !== null} className="min-h-10 text-[14px] underline">
                {pending === 'guest' ? 'Starting…' : 'Continue as guest'}
              </button>
            )}
            <button type="button" onClick={() => setMode(up ? 'signin' : 'signup')} className="min-h-10 text-[14px]">
              {up ? 'Have an account? Sign in' : 'New here? Create an account'}
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}
