/**
 * The one advisor chat for the whole app. It lives at module level (not in a component), so it survives
 * the panel closing, page changes, and questions asked from Routine or Results through the shell's seed.
 *
 * The api answers in one JSON reply after 10 to 30 s (api/app/advisor.py: tool loop, then a validated
 * reply). Nothing streams: the client shows a calm thinking state, then reveals the finished text word by
 * word (all at once under reduced motion). There is no cancel endpoint: "Stop waiting" only stops waiting,
 * and the question still counts.
 */
import { useSyncExternalStore } from 'react'

import { ApiError, api, type AdvisorReply } from '../../lib/api'

export type ChatMessage =
  | { id: number; role: 'user'; text: string; context?: string }
  | { id: number; role: 'willow'; reply: AdvisorReply; words: string[]; shown: number }
  | { id: number; role: 'error'; title: string; body: string; question: string | null }
  | { id: number; role: 'note'; text: string }

export type ChatState = {
  messages: ChatMessage[]
  phase: 'idle' | 'thinking' | 'revealing'
  /** From the last reply (remaining_today); null until one arrives: the api has no read endpoint. */
  remaining: number | null
  /** The person's own daily limit was reached (429 daily_limit): the api's own words. */
  capMessage: string | null
  thinkingSince: number | null
}

let state: ChatState = { messages: [], phase: 'idle', remaining: null, capMessage: null, thinkingSince: null }
const listeners = new Set<() => void>()
let nextId = 1
let request = 0 // the request whose answer we are waiting for; 0 = not waiting
let revealTimer = 0
// Questions asked while an answer is on its way (from Home, Routine or a result), in order; none is dropped.
let queued: { text: string; context?: string }[] = []
let tokenFn: (() => Promise<string>) | null = null
let lastSeed: unknown = null
let capDay = ''
const utcDay = () => new Date().toISOString().slice(0, 10)

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Whose chat this is: a different person signed in on this tab (sign-out, Google switch, delete) starts empty. */
let owner: string | null = null

/** The panel hands over how to get a token (it can change after sign-in) and whose chat it is. */
export function setTokenSource(fn: () => Promise<string>, uid: string | null) {
  tokenFn = fn
  if (uid !== owner) {
    owner = uid
    resetChat()
  }
}

/** Forget the conversation entirely (sign-out, delete my data): an answer still on its way is dropped. */
export function resetChat() {
  request = 0
  queued = []
  capDay = ''
  window.clearInterval(revealTimer)
  set({ messages: [], phase: 'idle', remaining: null, capMessage: null, thinkingSince: null })
}

/** A shell seed is asked once, even if the panel remounts with the same seed object. */
export function takeSeed(seed: unknown): boolean {
  if (!seed || seed === lastSeed) return false
  lastSeed = seed
  return true
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function errorFor(e: unknown): { title: string; body: string; retry: boolean } {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { title: 'You’re offline.', body: 'The question wasn’t sent. Try again when you’re connected.', retry: true }
  if (e instanceof ApiError) {
    if (e.status === 429) return { title: 'The advisor is busy.', body: `${e.message} This question wasn’t counted towards your limit.`, retry: false }
    if (e.status === 502) return { title: 'The advisor couldn’t answer that.', body: 'The service didn’t respond. This question wasn’t counted towards today’s limit.', retry: true }
    if (e.status === 422) return { title: 'That question couldn’t be sent.', body: 'Try asking it a different way.', retry: false }
    return { title: 'The advisor couldn’t answer that.', body: 'Something went wrong on Willow’s side. Try again in a moment.', retry: true }
  }
  return { title: 'Willow couldn’t be reached.', body: 'Check your connection. If the question reached the advisor before the connection dropped, it may have counted.', retry: true }
}

/** Ask a question. While an answer is on its way, later asks wait their turn (one at a time, in order). */
export function ask(text: string, context?: string) {
  const q = text.trim().slice(0, 1000)
  // The api's daily limit resets with the UTC day: a new day lifts the lock.
  if (state.capMessage && capDay !== utcDay()) set({ capMessage: null, remaining: null })
  if (!q || state.capMessage) return
  if (state.phase !== 'idle') {
    if (!queued.some((x) => x.text === q)) queued.push({ text: q, context })
    return
  }
  const user: ChatMessage = { id: nextId++, role: 'user', text: q, context }
  // History the api understands: our questions and the answers that were shown, newest 20, ending with ours.
  const history = [...state.messages, user]
    .flatMap((m): { role: 'user' | 'willow'; text: string }[] => (m.role === 'user' ? [{ role: 'user', text: m.text }] : m.role === 'willow' ? [{ role: 'willow', text: m.reply.message.slice(0, 1000) }] : []))
    .slice(-20)
  const mine = ++request
  const who = owner
  set({ messages: [...state.messages, user], phase: 'thinking', thinkingSince: Date.now() })
  void (async () => {
    try {
      if (!tokenFn) throw new Error('not signed in')
      const reply = await api.advisorChat(await tokenFn(), history)
      if (who !== owner) return // asked by the person before (signed out since)
      // Stopped waiting: the answer still counted, so keep its usage, not its text.
      if (mine !== request) {
        set({ remaining: reply.remaining_today })
        return
      }
      reveal(reply)
    } catch (e) {
      if (mine !== request) return
      request = 0
      if (e instanceof ApiError && e.status === 429 && e.code === 'daily_limit') {
        capDay = utcDay()
        queued = []
        set({ phase: 'idle', thinkingSince: null, remaining: 0, capMessage: e.message })
        return
      }
      const err = errorFor(e)
      set({ phase: 'idle', thinkingSince: null, messages: [...state.messages, { id: nextId++, role: 'error', title: err.title, body: err.body, question: err.retry ? q : null }] })
      next()
    }
  })()
}

function reveal(reply: AdvisorReply) {
  request = 0
  const words = reply.message.split(/\s+/).filter(Boolean)
  const msg: ChatMessage = { id: nextId++, role: 'willow', reply, words, shown: reduceMotion() ? words.length : 0 }
  const capped = reply.remaining_today <= 0
  if (capped) capDay = utcDay()
  set({ messages: [...state.messages, msg], phase: msg.shown >= words.length ? 'idle' : 'revealing', thinkingSince: null, remaining: reply.remaining_today, capMessage: capped ? 'That is all of today’s questions.' : state.capMessage })
  if (msg.shown >= words.length) return next()
  const start = Date.now()
  window.clearInterval(revealTimer)
  revealTimer = window.setInterval(() => {
    const last = state.messages.at(-1)
    if (!last || last.id !== msg.id || last.role !== 'willow') return window.clearInterval(revealTimer)
    // At least one word a tick, about one every 55 ms (the design's pace), whatever the frame rate.
    const shown = Math.min(words.length, Math.max(last.shown + 1, Math.floor((Date.now() - start) / 55)))
    const done = shown >= words.length
    set({ messages: [...state.messages.slice(0, -1), { ...last, shown }], phase: done ? 'idle' : 'revealing' })
    if (done) {
      window.clearInterval(revealTimer)
      next()
    }
  }, 42)
}

function next() {
  const q = queued.shift()
  if (q) ask(q.text, q.context)
}

/** Show the rest of the answer at once (the answer is already complete; only the animation stops). */
export function showAll() {
  const last = state.messages.at(-1)
  if (state.phase !== 'revealing' || !last || last.role !== 'willow') return
  window.clearInterval(revealTimer)
  set({ messages: [...state.messages.slice(0, -1), { ...last, shown: last.words.length }], phase: 'idle' })
  next()
}

/** Stop waiting for an answer. The server still finishes it, and it still counts. */
export function stopWaiting() {
  if (state.phase !== 'thinking') return
  request = 0
  queued = []
  set({
    phase: 'idle',
    thinkingSince: null,
    messages: [...state.messages, { id: nextId++, role: 'note', text: 'Stopped waiting. The advisor may still finish this answer in the background, and the question still counts towards today’s limit.' }],
  })
}

/** Ask the same question again after an error (the error and its question leave the chat first). */
export function retry(errorId: number) {
  const i = state.messages.findIndex((m) => m.id === errorId)
  const err = state.messages[i]
  if (!err || err.role !== 'error' || !err.question || state.phase !== 'idle') return
  const prev = state.messages[i - 1]
  const drop = new Set([err.id, prev?.role === 'user' ? prev.id : -1])
  const context = prev?.role === 'user' ? prev.context : undefined
  set({ messages: state.messages.filter((m) => !drop.has(m.id)) })
  ask(err.question, context)
}

export function newChat() {
  if (state.phase !== 'idle') return
  window.clearInterval(revealTimer)
  queued = []
  set({ messages: [] })
}
