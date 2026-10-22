import { useEffect, useState, useSyncExternalStore } from 'react'

import script from './voice.json'

/**
 * The journeys' narration (/journey, /journey/brand and the walkthroughs between their slides). Every line lives
 * in voice.json: its text, the clip that speaks it (web/public/voice/<id>.mp3, Gemini TTS in one continuous take
 * per part, cut by word timestamps) and the clip's length. A walkthrough step's caption is its line, so what is
 * read and what is shown never drift apart; a chapter slide shows the first part of its line (`show`).
 *
 * One shared <audio> element plays every clip: once the viewer has started it with a tap, the browser lets it go
 * on playing new clips. If the browser refuses to play (no tap yet on a page opened directly), the state becomes
 * 'blocked' and the page offers a button; the story keeps moving on its own timers meanwhile.
 */

type Line = { id: string; take: string; text: string; show?: string; ms?: number }
const LINES = new Map((script.lines as Line[]).map((l) => [l.id, l]))

/** A line's words (a walkthrough caption, or the narration of a slide). */
export const lineText = (id: string) => LINES.get(id)?.text ?? ''
/** The part of a slide's line it shows on screen (its paragraph); the rest is only spoken. */
export const lineShow = (id: string) => LINES.get(id)?.show ?? ''
/** How long its clip plays, in ms (0 when unknown). */
export const lineMs = (id: string) => LINES.get(id)?.ms ?? 0

export type VoiceState = 'on' | 'off' | 'blocked'
const KEY = 'willow.voice.off'
let state: VoiceState = (() => {
  try {
    return sessionStorage.getItem(KEY) === '1' ? 'off' : 'on'
  } catch {
    return 'on'
  }
})()
const listeners = new Set<() => void>()
const setState = (s: VoiceState) => {
  if (s === state) return
  state = s
  listeners.forEach((l) => l())
}
export const voiceState = () => state
export function useVoiceState(): VoiceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

let audio: HTMLAudioElement | null = null
let finish: ((ended: boolean) => void) | null = null

/** Stops whatever is speaking (its promise resolves false). */
export function stopVoice() {
  const f = finish
  finish = null
  audio?.pause()
  f?.(false)
}

/**
 * Speaks a line. Resolves true when its clip played to the end, false when it didn't play (narration off, the
 * browser refused, the clip failed) or was stopped by another line or stopVoice.
 */
export function say(id: string): Promise<boolean> {
  stopVoice()
  if (state !== 'on' || !LINES.has(id) || typeof Audio === 'undefined') return Promise.resolve(false)
  audio ??= new Audio()
  const a = audio
  a.preload = 'auto'
  a.src = `/voice/${id}.mp3`
  return new Promise((resolve) => {
    const done = (ended: boolean) => {
      if (finish !== done) return
      finish = null
      a.onended = a.onerror = null
      resolve(ended)
    }
    finish = done
    a.onended = () => done(true)
    a.onerror = () => done(false)
    a.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') setState('blocked')
      done(false)
    })
  })
}

/** Is a line still being spoken (or paused mid-line)? */
export const speaking = () => finish !== null

export function pauseVoice() {
  audio?.pause()
}
export function resumeVoice() {
  if (finish && audio) audio.play().catch(() => undefined)
}

// A moment of silence, played from a tap: after it, the browser lets the shared element play clips on its own.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Turns narration on or off for this tab. Call it from a tap: turning it on also unlocks playback. */
export function setVoice(on: boolean) {
  if (on && typeof Audio !== 'undefined') {
    stopVoice()
    audio ??= new Audio()
    audio.src = SILENCE
    audio.play().catch(() => undefined)
  }
  try {
    if (on) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, '1')
  } catch {
    /* private mode: for this page only */
  }
  if (!on) stopVoice()
  setState(on ? 'on' : 'off')
}

/** Fetches a clip ahead of time (into the browser cache), so the next line starts without a gap. */
const warmed = new Set<string>()
export function preloadVoice(id: string | undefined) {
  if (!id || state !== 'on' || !LINES.has(id) || warmed.has(id)) return
  warmed.add(id)
  void fetch(`/voice/${id}.mp3`, { priority: 'low' } as RequestInit).catch(() => warmed.delete(id))
}

/**
 * A story slide's narration: speaks the slide's line when it shows (and the story is ready), pauses with the
 * story, stops when the page goes. `narrated`: the slide should wait for its line before moving on; `finished`:
 * the line has been said (or couldn't be, in which case `narrated` turns false and the slide's own timer runs).
 */
export function useSlideNarration(key: number, id: string | undefined, nextId: string | undefined, ready: boolean, paused: boolean) {
  const voice = useVoiceState()
  const [done, setDone] = useState<{ key: number; ok: boolean } | null>(null)
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setDone(null)
  }
  useEffect(() => {
    if (!ready || voice !== 'on' || !id) return
    let alive = true
    void say(id).then((ok) => alive && setDone({ key, ok }))
    preloadVoice(nextId)
    return () => {
      alive = false
    }
  }, [key, id, nextId, ready, voice])
  useEffect(() => {
    if (paused) pauseVoice()
    else resumeVoice()
  }, [paused])
  useEffect(() => () => stopVoice(), [])
  const narrated = voice === 'on' && Boolean(id) && !(done?.key === key && !done.ok)
  return { voice, narrated, finished: done?.key === key }
}
