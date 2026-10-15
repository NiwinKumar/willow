import { X } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { LogoMark } from '../../components/willow/Logo'
import { WillowLoader } from '../../components/willow/WillowLoader'
import type { CaptureMode, Site } from '../../data/types'
import { leaveDemo, useData } from '../../data/useData'
import { ApiError, api } from '../../lib/api'
import { authErrorText } from '../../lib/authErrors'
import { baselineState } from '../../lib/baselineGuide'
import { fmtDate } from '../../lib/format'
import { SITE_LABEL } from '../../lib/metrics'
import { prefs } from '../../lib/prefs'
import { useAuth } from '../../lib/useAuth'
import { CameraStep } from './CameraStep'
import './checkin.css'
import { addFiles, isDng, recheck, rowsFromShots, usable } from './files'
import { FilesStep } from './FilesStep'
import { GuideStep } from './GuideStep'
import { neededFor, parseMode, parseSite, plural, STEPS, thinBaseline, type Step } from './model'
import { FlowBackdrop, SampleBanner } from './parts'
import { outcomeOf } from './outcome'
import { ProcessingStep } from './ProcessingStep'
import { ReviewStep } from './ReviewStep'
import { SampleStep } from './SampleStep'
import { SiteStep } from './SiteStep'
import { planTopUp } from './topup'
import { useAnalysis } from './useAnalysis'
import { useSoft } from './useSoft'
import { useUpload } from './useUpload'

type Shot = { file: File; url: string }
/** History state of each check-in entry: the page drawn behind, and how many steps deep this entry is. */
/** `prev`: the step a pushed step came from, so "Back to preparation" can go back instead of stacking the guide again. */
type NavState = { background?: unknown; depth?: number; prev?: string | null } | null

/**
 * The check-in (/check-in, over the page it was opened from): site → guide → camera → review → files →
 * processing → the result. Every step lives in the URL (?step=), so Back walks the steps; while photos
 * upload or are being measured, Back holds that step and closing asks first. Logic carried over from
 * the old Capture, QuickCapture, UploadList and Processing screens (see inventory/capture.md §4).
 *
 *   ?site= ?mode=calibrated_raw|uncalibrated   what to photograph and how
 *   ?n=                                        photo count, fixed for the whole attempt
 *   ?sample=<id> (or 1 for the list)           run hosted sample photos through the real pipeline
 *   ?session=<id>                              watch or resume measuring a session
 *   ?topup=<id>                                add the missing photos to a baseline without a normal range,
 *                                              then measure it again (topup.ts)
 */
export default function CheckInFlow() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user, loading: authLoading, continueAsGuest, signInWithGoogle, getIdToken } = useAuth()
  const data = useData()
  const reduce = useReducedMotion()

  const nav = (location.state as NavState) ?? {}
  const depth = nav.depth ?? 0
  const hasBackground = Boolean(nav.background)

  const siteParam = parseSite(params.get('site'))
  const site: Site = siteParam ?? 'face_full'
  const mode: CaptureMode = parseMode(params.get('mode'))
  const sessionParam = params.get('session')
  const sampleParam = params.get('sample')
  const sampleList = sampleParam !== null && (sampleParam === '' || sampleParam === '1' || sampleParam === 'list')
  const sampleId = sampleParam !== null && !sampleList ? sampleParam : null
  const capturing = !sessionParam && sampleParam === null
  const nParam = Number(params.get('n'))
  const topupParam = capturing ? params.get('topup') : null
  // The baseline being topped up, once planned (topup.ts): its date for the copy. Null until then.
  const [topup, setTopup] = useState<{ id: string; date: string } | null>(null)
  const [topupError, setTopupError] = useState<string | null>(null)
  const topupStarted = useRef<string | null>(null)

  const [shots, setShots] = useState<Shot[]>([])
  const [note, setNote] = useState('')
  const [deviation, setDeviation] = useState(false)
  // The session this flow created (upload done, or sample copied): from then on the flow is measuring it.
  const [held, setHeld] = useState<string | null>(null)
  const [exiting, setExiting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [sampleBusy, setSampleBusy] = useState<string | null>(null)
  const [sampleError, setSampleError] = useState<string | null>(null)
  const uploaded = useRef(false)
  const sampleStarted = useRef<string | null>(null)
  const handedOff = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)

  /** Move to another step (push, so Back returns) or adjust this one (replace). Keeps the background page. */
  const go = useCallback(
    (patch: Record<string, string | null>, opts: { replace?: boolean } = {}) => {
      const q = new URLSearchParams(params)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) q.delete(k)
        else q.set(k, v)
      }
      navigate({ search: `?${q}` }, { replace: opts.replace, state: { ...nav, depth: opts.replace ? depth : depth + 1, prev: opts.replace ? nav.prev : params.get('step') } })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nav is derived from location.state
    [params, navigate, location.state, depth],
  )

  const upload = useUpload({
    site,
    mode,
    topup: topup?.id ?? null,
    onDone: (id) => {
      leaveDemo()
      uploaded.current = true
      setHeld(id)
      go({ step: 'processing', session: id }, { replace: true })
    },
  })
  const activeSession = sessionParam ?? held
  const analysis = useAnalysis(activeSession, { note, deviation })

  const known = data.mode === 'live' && data.status !== 'loading'
  const sessionsOf = useCallback((s: Site) => data.series(s)?.sessions ?? [], [data])
  const computedN = known ? neededFor(sessionsOf(site), mode) : null
  const n = nParam >= 1 && nParam <= 5 ? nParam : computedN
  const rawStep = params.get('step') as Step | null
  const step: Step | null = rawStep && STEPS.includes(rawStep) && (rawStep !== 'processing' || activeSession) ? rawStep : sessionParam ? 'processing' : null

  // Gates, in order: consent on this device, someone signed in (a guest is enough), out of demo mode.
  const needConsent = capturing && !prefs.consent()
  const signedOut = !authLoading && !user
  const inDemo = data.mode === 'demo' || params.has('demo')

  useEffect(() => {
    if (exiting || !needConsent) return
    navigate(`/welcome?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  }, [exiting, needConsent, navigate, location.pathname, location.search])

  // Leaving demo needs a signed-in person first, or the shell behind would send them to sign in.
  useEffect(() => {
    if (exiting || !user) return
    if (params.has('demo')) go({ demo: null }, { replace: true })
    if (data.mode === 'demo') leaveDemo()
  }, [exiting, user, params, data.mode, go])

  const runSample = useCallback(
    async (id: string) => {
      if (sampleStarted.current === id) return
      sampleStarted.current = id
      setSampleBusy(id)
      setSampleError(null)
      try {
        if (!user) await continueAsGuest()
        leaveDemo()
        const res = await api.startSample(await getIdToken(), id)
        setHeld(res.session_id)
        go({ sample: id, session: res.session_id, site: res.site, step: 'processing' }, { replace: true })
      } catch (e) {
        sampleStarted.current = null
        setSampleError(e instanceof ApiError ? e.message : (authErrorText(e) ?? 'Could not start the sample. Try again.'))
      } finally {
        setSampleBusy(null)
      }
    },
    [user, continueAsGuest, getIdToken, go],
  )
  useEffect(() => {
    if (exiting || !sampleId || sessionParam || authLoading) return
    void runSample(sampleId)
  }, [exiting, sampleId, sessionParam, authLoading, runSample])

  // Where a check-in starts: the site step without a place; the guide for a first session (or RAW before
  // the one-time Lightroom setup); otherwise straight to the camera (quick) or the files (RAW).
  const ready = !exiting && !needConsent && !!user && !inDemo

  // A baseline top-up: read the session (it may be half-done from an earlier visit), then open the camera
  // (quick) or the files (RAW) for just the missing photos. Already enough: measure; running: watch.
  useEffect(() => {
    if (!ready || !topupParam || topupStarted.current === topupParam) return
    topupStarted.current = topupParam
    void (async () => {
      try {
        const plan = await planTopUp(await getIdToken(), topupParam)
        if (plan.kind === 'refuse') return setTopupError(plan.why)
        if (plan.kind !== 'add') {
          setHeld(topupParam)
          go({ topup: null, session: topupParam, step: 'processing' }, { replace: true })
          return
        }
        const s = plan.view.session
        setTopup({ id: s.id, date: fmtDate(s.created_at) })
        // A reload keeps the step it was on (quick: camera, review or files; RAW: files).
        const keep = s.capture_mode === 'calibrated_raw' ? ['files'] : ['camera', 'review', 'files']
        const at = rawStep && keep.includes(rawStep) ? rawStep : keep[0]
        go({ site: s.site, mode: s.capture_mode, n: String(plan.need), step: at }, { replace: true })
      } catch (e) {
        topupStarted.current = null
        setTopupError(e instanceof ApiError ? e.message : 'Could not open this baseline. Check your connection and try again.')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planned once per top-up; the step is read at that moment
  }, [ready, topupParam, getIdToken, go])

  useEffect(() => {
    // A top-up picks its own first step (above).
    if (!ready || topupParam) return
    if (sampleParam !== null && !sessionParam) {
      if (step !== 'samples') go({ step: 'samples' }, { replace: true })
      return
    }
    if (sessionParam && step !== 'processing') {
      go({ step: 'processing' }, { replace: true })
      return
    }
    if (!capturing || step) return
    if (!siteParam) {
      go({ step: 'site' }, { replace: true })
      return
    }
    if (computedN === null) return
    const first = computedN === 5
    const initial: Step = first || (mode === 'calibrated_raw' && !prefs.lightroomDone()) ? 'guide' : mode === 'calibrated_raw' ? 'files' : 'camera'
    go({ step: initial, n: String(n ?? computedN) }, { replace: true })
  }, [ready, topupParam, sampleParam, sessionParam, step, capturing, siteParam, computedN, n, mode, go])

  // Back is held while photos upload or are measured (CAP holds processing), and steps that need state
  // they no longer have (a reload) fall back to one that works.
  useEffect(() => {
    if (!ready) return
    if (held && step !== 'processing') go({ step: 'processing', session: held }, { replace: true })
    else if (upload.busy && step !== 'files') go({ step: 'files' }, { replace: true })
    else if (!held && (step === 'camera' || step === 'review') && mode === 'calibrated_raw') go({ step: 'files' }, { replace: true })
    else if (!held && step === 'review' && shots.length === 0) go({ step: 'camera' }, { replace: true })
    else if (capturing && step && step !== 'site' && n === null && known && siteParam) go({ n: String(computedN) }, { replace: true })
  }, [ready, held, step, upload.busy, mode, shots.length, capturing, n, known, siteParam, computedN, go])

  // Each step opens at its top with focus on its title, for screen readers and keyboards.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0)
    const t = window.setTimeout(() => document.getElementById('ck-title')?.focus({ preventScroll: true }), 60)
    return () => window.clearTimeout(t)
  }, [step])

  // Object URLs (camera shots, thumbnails) are freed when the check-in closes.
  const urls = useRef(new Set<string>())
  for (const s of shots) urls.current.add(s.url)
  for (const r of upload.rows) if (r.thumb) urls.current.add(r.thumb)
  useEffect(() => {
    const all = urls.current
    return () => all.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  /** Leave the check-in for another page: unwind the check-in's own history first, then replace it. */
  const exitTo = useCallback(
    (path: string) => {
      setExiting(true)
      if (depth === 0) {
        navigate(path, { replace: true })
        return
      }
      const onPop = () => {
        window.removeEventListener('popstate', onPop)
        window.setTimeout(() => navigate(path, { replace: true }), 0)
      }
      window.addEventListener('popstate', onPop)
      navigate(-depth)
    },
    [depth, navigate],
  )

  const close = useCallback(() => {
    setConfirm(false)
    // Home polls a session that is still measuring; make sure it knows about this one.
    if (held || analysis.state.kind === 'running') void data.refresh()
    setExiting(true)
    if (hasBackground) navigate(-(depth + 1))
    else navigate('/home', { replace: true })
  }, [held, analysis.state.kind, data, hasBackground, depth, navigate])

  const working = upload.busy || analysis.state.kind === 'running' || analysis.state.kind === 'offline'
  const requestClose = useCallback(() => (working ? setConfirm(true) : close()), [working, close])
  const requestRef = useRef(requestClose)
  requestRef.current = requestClose

  // Esc closes (asking first while working). Caught before the shell's own keys, so N doesn't stack the picker on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (e.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return
        e.stopPropagation()
        // Not on this keydown: the same Escape would cancel the confirmation dialog it opens.
        e.preventDefault()
        window.setTimeout(() => requestRef.current(), 0)
      } else if ((e.key === 'n' || e.key === 'N') && !typing) e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Success: the result opens in place of the check-in, with a toast (after the stages have landed).
  const outcome = outcomeOf(analysis.state)
  const handOff = useCallback(() => {
    if (analysis.state.kind !== 'done' || handedOff.current) return
    handedOff.current = true
    const v = analysis.state.view
    const what = `${plural(v.session.n_frames, 'photo')} · ${SITE_LABEL[v.session.site]}`
    toast(`${v.session.is_baseline ? 'Baseline set' : analysis.state.fresh ? 'Analysed just now' : 'Result ready'} · ${what}`, {
      description: user?.isAnonymous ? 'Keep it by saving with Google in You.' : undefined,
    })
    // ?from=check-in lets Result offer its once-per-face-session "Same time tomorrow?" sheet.
    exitTo(`/result/${v.session.id}?from=check-in`)
  }, [analysis.state, user, exitTo])
  useEffect(() => {
    if (outcome !== 'success' || exiting) return
    const t = window.setTimeout(handOff, reduce ? 500 : 1900)
    return () => window.clearTimeout(t)
  }, [outcome, exiting, handOff, reduce])

  const clearShots = () => {
    setShots([])
  }
  /** A new attempt: the old session stays as it is on the server; photos, files and the hold are dropped. */
  const newAttempt = (patch: Record<string, string | null>) => {
    upload.reset([])
    clearShots()
    setHeld(null)
    uploaded.current = false
    handedOff.current = false
    setTopup(null)
    go({ session: null, sample: null, topup: null, ...patch }, { replace: true })
  }

  /** A new check-in for the same place and mode as the session being watched (Result's "Try again" opens ?session= alone). */
  const again = () => {
    const s = analysis.meta?.site ?? site
    const m = analysis.meta?.capture_mode ?? mode
    return { site: s, mode: m, n: known ? String(neededFor(sessionsOf(s), m)) : null }
  }

  const setSiteMode = (s: Site, m: CaptureMode, replace = true, extra: Record<string, string | null> = {}) => {
    if (!upload.locked) upload.reset([])
    clearShots()
    go({ site: s, mode: m, n: known ? String(neededFor(sessionsOf(s), m)) : null, ...extra }, { replace })
  }

  const onPick = (picked: File[]) => {
    // A RAW set picked in quick mode is better than phone photos: it becomes a RAW check-in.
    const anyPhoto = usable(upload.rows).some((r) => r.contentType !== 'image/x-adobe-dng')
    // (not once the session exists, or for a top-up: their capture mode is fixed)
    if (mode === 'uncalibrated' && picked.every(isDng) && !anyPhoto && !upload.locked && !topup) {
      const rawN = known ? neededFor(sessionsOf(site), 'calibrated_raw') : (n ?? 5)
      upload.setRows(addFiles(upload.rows, picked, 'calibrated_raw', rawN))
      go({ mode: 'calibrated_raw', n: String(rawN) }, { replace: true })
      toast('RAW files: this becomes a RAW check-in, with its own baseline.')
      return
    }
    upload.setRows(addFiles(upload.rows, picked, mode, n ?? 5))
  }
  const dropThumb = (id: string) => {
    const r = upload.rows.find((x) => x.id === id)
    if (r?.thumb && !shots.some((s) => s.url === r.thumb)) URL.revokeObjectURL(r.thumb)
  }
  /** Remove a row (an uploaded one is deleted from the session too); `after` re-checks or adds a replacement. */
  const removeRow = (id: string, after: Parameters<typeof upload.remove>[1]) => {
    upload
      .remove(id, after)
      .then(() => dropThumb(id))
      .catch((e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Couldn’t remove that photo. Check your connection and try again.'))
  }

  // "Looks soft · consider retaking": camera shots on review, phone photos in the file list (never DNG).
  const softShots = useSoft(shots.map((s) => ({ key: s.url, file: s.file, contentType: 'image/jpeg' })))
  const softRows = useSoft(usable(upload.rows).filter((r) => !isDng(r.file)).map((r) => ({ key: r.id, file: r.file, contentType: r.contentType })))
  /** "Duplicate of a photo from 12 Oct": the check-in the same photo was uploaded to. */
  const dupLabel = (d: { session_id: string; index: number }) => {
    if (d.session_id === (upload.sessionId ?? topup?.id)) return `Same photo as photo ${d.index} of this check-in`
    const s = data.all.find((x) => x.id === d.session_id)
    return s ? `Duplicate of a photo from ${fmtDate(s.created_at)}` : 'Duplicate of a photo from an earlier check-in'
  }

  // ---- render ----
  let content: ReactNode
  if (exiting || needConsent || authLoading) content = <WillowLoader inline label="Opening check-in" />
  else if (signedOut && sampleParam === null) content = <SignInGate onGuest={continueAsGuest} onGoogle={signInWithGoogle} />
  else if (sampleParam !== null && !sessionParam)
    content = (
      <SampleStep
        busy={sampleBusy}
        error={sampleError}
        onRun={(id) => void runSample(id)}
        onOwn={() => {
          setSampleError(null)
          go({ sample: null, site: 'face_full', mode: 'uncalibrated', step: null, n: null }, { replace: true })
        }}
      />
    )
  else if (topupParam && !topup && !held)
    content = topupError ? (
      <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
        <h1 id="ck-title" tabIndex={-1} className="m-0 font-serif text-[clamp(31px,3vw,40px)] leading-[.95] font-normal outline-none">
          This baseline can’t take more photos
        </h1>
        <p className="m-0 leading-normal text-[#3E3C38]">{topupError}</p>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="ink" onClick={() => newAttempt({ site: null, n: null, step: null })}>
            Start a new check-in
          </Button>
          <Button variant="glass" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    ) : (
      <WillowLoader inline label="Opening your baseline" />
    )
  else if (inDemo || (capturing && (!known || !step))) content = <WillowLoader inline label="Loading your sessions" />
  else if (step === 'processing')
    content = (
      <ProcessingStep
        state={analysis.state}
        stage={analysis.stage}
        site={analysis.meta?.site ?? siteParam}
        n={analysis.meta?.n_frames ?? (usable(upload.rows).length || n)}
        received={uploaded.current || sampleParam !== null || analysis.meta?.status === 'processing' || analysis.meta?.status === 'done'}
        sample={sampleParam !== null}
        onRetry={analysis.retry}
        onRetake={() => newAttempt({ ...again(), step: (analysis.meta?.capture_mode ?? mode) === 'calibrated_raw' ? 'files' : 'camera' })}
        onUploadAgain={() => newAttempt({ ...again(), step: 'files' })}
        onSeeResult={handOff}
        onClose={close}
        onFaceCheckIn={() => newAttempt({ site: 'face_full', mode: 'uncalibrated', n: known ? String(neededFor(sessionsOf('face_full'), 'uncalibrated')) : null, step: 'camera' })}
      />
    )
  else if (step === 'site')
    content = (
      <SiteStep
        site={site}
        mode={mode}
        sessionsOf={sessionsOf}
        known={known}
        onSite={(s) => setSiteMode(s, mode)}
        onMode={(m) => setSiteMode(site, m)}
        onContinue={() => go({ site, step: 'guide', n: String(computedN) })}
      />
    )
  else if (n === null) content = <WillowLoader inline label="Loading your sessions" />
  else if (step === 'guide') {
    const st = baselineState(sessionsOf(site), mode)
    const baseline = st.state === 'set' ? st.session : null
    content = (
      <GuideStep
        key={`${site}-${mode}`}
        site={site}
        mode={mode}
        n={n}
        baseline={baseline}
        thin={baseline ? thinBaseline(baseline) : false}
        goals={data.goals}
        note={note}
        deviation={deviation}
        onNote={setNote}
        onDeviation={setDeviation}
        onCamera={() => go({ step: 'camera' })}
        onFiles={() => go({ step: 'files' })}
        onSite={(s) => setSiteMode(s, mode)}
        onChangePlace={() => go({ step: 'site' })}
      />
    )
  } else if (step === 'camera')
    content = (
      <CameraStep
        site={site}
        n={n}
        first={n === 5}
        shots={shots}
        onShot={(file, url) => setShots((s) => (s.length >= n ? s : [...s, { file, url }]))}
        onRetakeLast={() => setShots((s) => s.slice(0, -1))}
        onReview={() => go({ step: 'review' })}
        onBack={() => (nav.prev === 'guide' ? navigate(-1) : go({ step: 'guide' }))}
        onFiles={() => go({ step: 'files' })}
      />
    )
  else if (step === 'review')
    content = (
      <ReviewStep
        shots={shots}
        n={n}
        soft={softShots}
        onRetake={(i) => {
          setShots((s) => s.filter((_, j) => j !== i))
          go({ step: 'camera' })
        }}
        onUpload={() => {
          upload.reset(rowsFromShots(shots))
          void upload.run()
          go({ step: 'files' })
        }}
      />
    )
  else
    content = (
      <FilesStep
        mode={mode}
        n={n}
        first={n === 5}
        upload={upload}
        camera={shots.length > 0}
        soft={softRows}
        topup={topup ? { date: topup.date } : null}
        dupLabel={dupLabel}
        onPick={onPick}
        onRemove={(id) => removeRow(id, (rest) => recheck(rest, mode, n))}
        onReplace={(id, file) => removeRow(id, (rest) => addFiles(rest, [file], mode, n))}
        onStartOver={() => {
          const camera = shots.length > 0
          upload.reset([])
          clearShots()
          go({ step: camera ? 'camera' : 'files' }, { replace: true })
        }}
      />
    )

  const dark = step === 'camera' && !exiting && !!user && !inDemo && capturing
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {typeof document !== 'undefined' ? createPortal(<div aria-hidden className="fixed inset-0 z-[60]" onClick={() => requestRef.current()} />, document.body) : null}
      {dark ? null : <FlowBackdrop />}
      {sampleParam !== null ? <SampleBanner /> : null}
      {dark ? null : (
        <header className="relative z-20 flex flex-none items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] py-4">
          <span className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="text-[26px] font-light tracking-[-0.03em]">willow</span>
          </span>
          <button type="button" onClick={requestClose} aria-label="Close check-in" title="Close check-in" className="glass-pill grid size-12 place-items-center rounded-full text-ink">
            <X size={18} strokeWidth={1.8} aria-hidden />
          </button>
        </header>
      )}
      <div ref={scroller} className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${dark ? 'bg-[#050505]' : ''}`}>
        {content}
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Leave the check-in?" variant="modal" size="sm">
        <p className="m-0 text-[15px] leading-normal text-ink-2">
          {upload.busy
            ? 'Your photos are still uploading. If you close now, the rest are not sent and this check-in is not measured.'
            : 'Willow keeps measuring on its side. You can leave: the result lands in Home when it’s ready.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="ink" onClick={() => setConfirm(false)}>
            {upload.busy ? 'Keep uploading' : 'Stay'}
          </Button>
          <Button variant="outline" onClick={close}>
            {upload.busy ? 'Close anyway' : 'Close, keep measuring'}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

/** Check-ins are saved to the person's private space: a guest account is enough (save it with Google later in You). */
function SignInGate({ onGuest, onGoogle }: { onGuest: () => Promise<void>; onGoogle: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const act = (f: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      const t = authErrorText(e)
      if (t) toast.error(t)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <h1 id="ck-title" tabIndex={-1} className="m-0 font-serif text-[clamp(31px,3vw,40px)] leading-[.95] font-normal outline-none">
        Sign in to check in
      </h1>
      <p className="m-0 leading-normal text-[#3E3C38]">Your photos and results are saved to your own private space. A guest account is enough; you can keep it by saving with Google later, in You.</p>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="ink" loading={busy} onClick={act(onGuest)}>
          Continue as guest
        </Button>
        <Button variant="glass" disabled={busy} onClick={act(onGoogle)}>
          Sign in with Google
        </Button>
      </div>
    </div>
  )
}
