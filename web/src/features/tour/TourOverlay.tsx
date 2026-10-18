import { ChevronRight, Pause, Play, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { enterDemo } from '../../data/useData'
import { endSegment, goStep, setPaused, useTourRun } from './runner'
import { findTarget } from './find'
import type { TourTarget } from './types'

/**
 * Plays the walkthrough that runner.ts holds, on the real pages: a cursor moves to each step's target, presses it
 * or types into it, and a caption says what is happening. The page underneath can't be clicked while it plays
 * (a stray click would take the walkthrough somewhere it doesn't expect); the card has pause, next and a way
 * back to the story. Mounted once in App, inside the router.
 */
const STOP = Symbol('stop')
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function TourOverlay() {
  const run = useTourRun()
  const navigate = useNavigate()
  const [cursor, setCursor] = useState<{ x: number; y: number; clicks: number } | null>(null)
  const paused = useRef(false)
  useEffect(() => {
    paused.current = run?.paused ?? false
  }, [run?.paused])

  useEffect(() => {
    if (!run) {
      setCursor(null)
      return
    }
    const step = run.seg.steps[run.i]
    if (!step) {
      const back = endSegment()
      if (back) navigate(back)
      return
    }
    let alive = true
    const sleep = async (ms: number) => {
      let left = ms
      while (left > 0) {
        if (!alive) throw STOP
        await new Promise((r) => window.setTimeout(r, 100))
        if (!paused.current) left -= 100
      }
      if (!alive) throw STOP
    }
    const waitFor = async (t: TourTarget, ms: number) => {
      for (let waited = 0; waited < ms; waited += 200) {
        const el = findTarget(t)
        if (el) return el
        await sleep(200)
      }
      return null
    }
    void (async () => {
      if (run.i === 0 && run.seg.demo) enterDemo()
      if (step.route && step.route !== window.location.pathname + window.location.search) {
        navigate(step.route)
        await sleep(700)
      }
      await step.run?.()
      const el = step.target ? await waitFor(step.target, 8000) : null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
        await sleep(450)
        const r = el.getBoundingClientRect()
        setCursor((c) => ({ x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2, clicks: c?.clicks ?? 0 }))
        await sleep(750)
        if (step.action === 'click') {
          setCursor((c) => (c ? { ...c, clicks: c.clicks + 1 } : c))
          await sleep(200)
          el.click()
        } else if (step.action === 'type') {
          el.focus()
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          const text = step.text ?? ''
          for (let n = 1; n <= text.length; n++) {
            set?.call(el, text.slice(0, n))
            el.dispatchEvent(new Event('input', { bubbles: true }))
            await sleep(28)
          }
        }
      }
      if (step.action === 'escape') (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (step.until) for (let waited = 0; waited < 30_000 && !step.until(); waited += 250) await sleep(250)
      await sleep(step.hold ?? 2600)
      goStep(run.i + 1)
    })().catch((e) => {
      if (e !== STOP) goStep(run.i + 1)
    })
    return () => {
      alive = false
    }
    // one pass per step: v changes on every step (pause doesn't restart it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.v])

  // The walkthrough sits in the top layer (a manual popover), so app sheets (native modal dialogs, also top layer)
  // never cover or blur it: whenever a dialog opens it is raised again, above that dialog.
  const layer = useRef<HTMLDivElement>(null)
  const playing = Boolean(run)
  useEffect(() => {
    const el = layer.current
    if (!playing || !el) return
    document.documentElement.setAttribute('data-touring', '')
    const raise = () => {
      try {
        if (el.matches(':popover-open')) el.hidePopover()
        el.showPopover()
      } catch {
        /* no popover support: it stays a fixed layer */
      }
    }
    raise()
    const watch = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && c.target.open)) raise()
    })
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => {
      watch.disconnect()
      document.documentElement.removeAttribute('data-touring')
      try {
        el.hidePopover()
      } catch {
        /* already hidden */
      }
    }
  }, [playing])

  if (!run) return null
  const step = run.seg.steps[run.i]
  const total = run.seg.steps.length
  const back = () => {
    const to = endSegment()
    if (to) navigate(to)
  }
  return (
    <div data-tour-ui ref={layer} popover="manual">
      {/* the page plays itself: clicks underneath would derail it */}
      <div className="pointer-events-auto fixed inset-0 z-[1000] cursor-default" aria-hidden />
      {cursor ? (
        <div className="pointer-events-none fixed top-0 left-0 z-[1001] transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} aria-hidden>
          {cursor.clicks ? <span key={cursor.clicks} className="absolute -top-5 -left-5 size-10 rounded-full bg-[rgba(91,108,255,.35)] animate-[tourPing_.6s_ease-out_forwards]" /> : null}
          <svg width="26" height="30" viewBox="0 0 26 30" className="drop-shadow-[0_4px_8px_rgba(0,0,0,.35)]">
            <path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
      ) : null}
      <section
        role="status"
        aria-live="polite"
        className="pointer-events-auto fixed right-3 bottom-3 left-3 z-[1002] mx-auto flex max-w-[460px] flex-col gap-2.5 rounded-[26px] bg-selected p-4 text-inverse shadow-[0_30px_60px_-20px_rgba(0,0,0,.6)] sm:right-auto sm:left-5 sm:mx-0"
      >
        <div className="flex items-center justify-between gap-3 text-[12.5px] opacity-70">
          <span>{run.seg.title}</span>
          <span className="tabular-nums">
            {Math.min(run.i + 1, total)} of {total}
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {run.seg.steps.map((_, k) => (
            <span key={k} className={`h-[3px] flex-1 rounded-full ${k <= run.i ? 'bg-white' : 'bg-white/25'}`} />
          ))}
        </div>
        <p className="m-0 text-[15.5px] leading-[1.45]">{step?.caption}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPaused(!run.paused)} aria-label={run.paused ? 'Play' : 'Pause'} className="grid size-11 place-items-center rounded-full bg-white/12 hover:bg-white/20">
            {run.paused ? <Play size={17} /> : <Pause size={17} />}
          </button>
          <button type="button" onClick={() => goStep(run.i + 1)} className="flex min-h-11 items-center gap-1 rounded-pill bg-white/12 px-4 text-[14px] hover:bg-white/20">
            Next step <ChevronRight size={16} />
          </button>
          <button type="button" onClick={back} className="ml-auto flex min-h-11 items-center gap-1.5 rounded-pill bg-white px-4 text-[14px] text-ink">
            <Undo2 size={15} /> Back to the story
          </button>
        </div>
      </section>
    </div>
  )
}
