/**
 * The one advisor chat for the whole app. It lives at module level (not in a component), so it survives
 * the panel closing, page changes, and questions asked from Routine or Results through the shell's seed.
 *
 * The api answers in 10 to 30 s (api/app/advisor.py: tool loop, then a validated reply). The streaming route
 * sends honest progress events while it works (reading the context, asking Gemini, checking numbers) and the
 * checked reply at the end, never partial text; the client then reveals the finished text word by word (all
 * at once under reduced motion). If the stream can't be used, the plain endpoint answers the same question.
 * The conversation is stored on the account (newest 200 turns): it loads when the panel first opens for a
 * person, and "New chat" deletes it. "Stop waiting" only stops waiting: the api finishes, and it counts.
 */
import { useSyncExternalStore } from 'react'

import { ApiError, StreamUnavailable, api, type AdvisorHistoryMessage, type AdvisorReply, type AdvisorStage, type ChatImage, type StandardExplanation, type UsageCount } from '../../lib/api'

/** A photo attached to a question: what is sent, plus a local thumbnail for this tab only (never stored). */
export type Attachment = ChatImage & { name: string; meta: string; thumb: string }

export type ChatMessage =
  /** photos: attached on this tab (kept so "Try again" can resend them); photoCount: from the stored history. */
  | { id: number; role: 'user'; text: string; context?: string; photos?: Attachment[]; photoCount?: number }
  | { id: number; role: 'willow'; reply: AdvisorReply; words: string[]; shown: number }
  | { id: number; role: 'error'; title: string; body: string; question: string | null }
  | { id: number; role: 'note'; text: string }
  /** AI unavailable: the latest session's pre-written explanation (no Gemini, no new analysis). */
  | { id: number; role: 'standard'; standard: StandardExplanation | null; question: string }

export type ChatState = {
  messages: ChatMessage[]
  phase: 'idle' | 'thinking' | 'revealing'
  /** Advisor questions left today, from GET /v1/me/usage or the last reply; null until either answers. */
  remaining: number | null
  /** Today's advisor count from the api (cap and reset time included); null until it answers. */
  usage: UsageCount | null
  /** The person's own daily limit was reached (429 daily_limit): the api's own words. */
  capMessage: string | null
  thinkingSince: number | null
  /** The api's progress events for the answer on its way (empty when the plain endpoint is used). */
  stages: AdvisorStage[]
  /** The last answer failed because Gemini was unavailable: the panel says "standard explanations". */
  aiDown: boolean
  history: 'idle' | 'loading' | 'ready' | 'error'
}

const EMPTY: ChatState = { messages: [], phase: 'idle', remaining: null, usage: null, capMessage: null, thinkingSince: null, stages: [], aiDown: false, history: 'idle' }
let state: ChatState = EMPTY
const listeners = new Set<() => void>()
let nextId = 1
let request = 0 // the request whose answer we are waiting for; 0 = not waiting
let revealTimer = 0
let abort: AbortController | null = null
// Questions asked while an answer is on its way (from Home, Routine or a result), in order; none is dropped.
let queued: { text: string; context?: string; images?: Attachment[] }[] = []
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
    if (uid) {
      void loadHistory(uid)
      void refreshUsage()
    }
  }
}

/** Forget the conversation on this tab (sign-out, delete my data): an answer still on its way is dropped. */
export function resetChat() {
  request = 0
  queued = []
  capDay = ''
  abort?.abort()
  abort = null
  window.clearInterval(revealTimer)
  set(EMPTY)
}

/** Today's advisor count (no question is counted by reading it). Quietly keeps the last count on failure. */
export async function refreshUsage() {
  const who = owner
  if (!tokenFn || !who) return
  try {
    const u = (await api.usage(await tokenFn())).advisor
    if (who !== owner) return
    const capped = u.remaining <= 0
    if (capped) capDay = utcDay()
    set({ usage: u, remaining: u.remaining, capMessage: capped ? (state.capMessage ?? 'That is all of today’s questions.') : state.capMessage && capDay === utcDay() ? state.capMessage : null })
  } catch {
    /* the chip says what it reads instead of a count */
  }
}

function fromHistory(m: AdvisorHistoryMessage): ChatMessage {
  if (m.role === 'user') return { id: nextId++, role: 'user', text: m.text, photoCount: m.photos || undefined }
  const reply: AdvisorReply = { ...m.reply, remaining_today: state.remaining ?? 0 }
  const words = reply.message.split(/\s+/).filter(Boolean)
  return { id: nextId++, role: 'willow', reply, words, shown: words.length }
}

async function loadHistory(uid: string) {
  if (!tokenFn) return
  set({ history: 'loading' })
  try {
    const { messages } = await api.advisorHistory(await tokenFn())
    if (uid !== owner) return
    // Anything asked while it loaded comes after the stored conversation (its turn is stored after this read).
    set({ history: 'ready', messages: [...messages.map(fromHistory), ...state.messages] })
  } catch {
    if (uid === owner) set({ history: 'error' })
  }
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
    if (e.status === 422 && e.code === 'bad_image') return { title: 'A photo couldn’t be read.', body: 'Try a different photo of the product or its label.', retry: false }
    if (e.status === 422) return { title: 'That question couldn’t be sent.', body: 'Try asking it a different way.', retry: false }
    return { title: 'The advisor couldn’t answer that.', body: 'Something went wrong on Willow’s side. Try again in a moment.', retry: true }
  }
  return { title: 'Willow couldn’t be reached.', body: 'Check your connection. If the question reached the advisor before the connection dropped, it may have counted.', retry: true }
}

/** Ask a question, with up to 3 product photos. While an answer is on its way, later asks wait their turn. */
export function ask(text: string, context?: string, images: Attachment[] = []) {
  const q = text.trim().slice(0, 1000) || (images.length ? `What is this product, and does it suit my routine?` : '')
  // The api's daily limit resets with the UTC day: a new day lifts the lock.
  if (state.capMessage && capDay !== utcDay()) set({ capMessage: null, remaining: null })
  if (!q || state.capMessage) return
  if (state.phase !== 'idle') {
    if (!queued.some((x) => x.text === q)) queued.push({ text: q, context, images })
    return
  }
  const user: ChatMessage = { id: nextId++, role: 'user', text: q, context, photos: images.length ? images : undefined }
  // History the api understands: our questions and the answers that were shown, newest 20, ending with ours.
  const history = [...state.messages, user]
    .flatMap((m): { role: 'user' | 'willow'; text: string }[] => (m.role === 'user' ? [{ role: 'user', text: m.text }] : m.role === 'willow' ? [{ role: 'willow', text: m.reply.message.slice(0, 1000) }] : []))
    .slice(-20)
  const sent: ChatImage[] = images.map(({ mime_type, data_base64 }) => ({ mime_type, data_base64 }))
  const mine = ++request
  const who = owner
  abort = new AbortController()
  const signal = abort.signal
  set({ messages: [...state.messages, user], phase: 'thinking', thinkingSince: Date.now(), stages: [] })
  void (async () => {
    try {
      if (!tokenFn) throw new Error('not signed in')
      const token = await tokenFn()
      let reply: AdvisorReply
      try {
        reply = await api.advisorChatStream(token, history, sent, (s) => mine === request && set({ stages: [...state.stages, s] }), signal)
      } catch (e) {
        if (!(e instanceof StreamUnavailable)) throw e
        // Nothing reached the api: the same question on the plain endpoint (no progress events).
        reply = await api.advisorChat(token, history, sent)
      }
      if (who !== owner) return // asked by the person before (signed out since)
      // Stopped waiting: the answer still counted, so keep its usage, not its text (history has it).
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
        set({ phase: 'idle', thinkingSince: null, stages: [], remaining: 0, capMessage: e.message })
        return
      }
      if (e instanceof ApiError && e.status === 502 && e.code === 'advisor_unavailable') {
        // AI unavailable: show what Willow already measured, worded by code, and offer the question again.
        const standard = (e.detail?.standard as StandardExplanation | null | undefined) ?? null
        set({ phase: 'idle', thinkingSince: null, stages: [], aiDown: true, messages: [...state.messages, { id: nextId++, role: 'standard', standard, question: q }] })
        next()
        return
      }
      const err = errorFor(e)
      set({ phase: 'idle', thinkingSince: null, stages: [], messages: [...state.messages, { id: nextId++, role: 'error', title: err.title, body: err.body, question: err.retry ? q : null }] })
      void refreshUsage()
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
  const usage = state.usage ? { ...state.usage, remaining: reply.remaining_today, used: Math.min(state.usage.cap, state.usage.cap - reply.remaining_today) } : null
  set({ messages: [...state.messages, msg], phase: msg.shown >= words.length ? 'idle' : 'revealing', thinkingSince: null, stages: [], aiDown: false, remaining: reply.remaining_today, usage, capMessage: capped ? 'That is all of today’s questions.' : state.capMessage })
  if (!state.usage) void refreshUsage()
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
  if (q) ask(q.text, q.context, q.images)
}

/** Stop waiting for an answer. The server still finishes it (and stores it), and it still counts. */
export function stopWaiting() {
  if (state.phase !== 'thinking') return
  request = 0
  queued = []
  abort?.abort()
  abort = null
  set({
    phase: 'idle',
    thinkingSince: null,
    stages: [],
    messages: [...state.messages, { id: nextId++, role: 'note', text: 'Stopped waiting. The advisor may still finish this answer in the background, and the question still counts towards today’s limit.' }],
  })
  window.setTimeout(() => void refreshUsage(), 1500)
}

/** Ask the same question again after an error or the standard explanation (they leave the chat first). */
export function retry(messageId: number) {
  const i = state.messages.findIndex((m) => m.id === messageId)
  const err = state.messages[i]
  if (!err || (err.role !== 'error' && err.role !== 'standard') || !err.question || state.phase !== 'idle') return
  const prev = state.messages[i - 1]
  const drop = new Set([err.id, prev?.role === 'user' ? prev.id : -1])
  const context = prev?.role === 'user' ? prev.context : undefined
  const photos = prev?.role === 'user' ? prev.photos : undefined
  set({ messages: state.messages.filter((m) => !drop.has(m.id)) })
  ask(err.question, context, photos)
}

/** Start again: this tab's chat and the stored conversation on the account are both cleared. */
export function newChat() {
  if (state.phase !== 'idle') return
  window.clearInterval(revealTimer)
  queued = []
  set({ messages: [], aiDown: false })
  const who = owner
  void (async () => {
    try {
      if (!tokenFn) return
      await api.clearAdvisorHistory(await tokenFn())
    } catch {
      if (who === owner) set({ messages: [{ id: nextId++, role: 'note', text: 'The saved conversation couldn’t be cleared just now; it may come back next time you open the advisor.' }, ...state.messages] })
    }
  })()
}
