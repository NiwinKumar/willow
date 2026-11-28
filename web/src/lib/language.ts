import { useSyncExternalStore } from 'react'

/**
 * The language Willow's words come back in (finals B3, Nov 28). Gemini writes every explanation, story
 * and Wisp answer in English first, where the checks read it; the api then translates it and keeps the
 * translation only if every number is unchanged (api app/translate.py). The app's own labels stay
 * English. Kept on this device; sent with every request as `X-Willow-Lang`.
 * There is no picker: Wisp answers in the language a question is written in (the api tells it from the
 * question, app/translate.py `detect`), and the app adopts the language of each answer (`adoptLanguage`),
 * so explanations and stories follow. Until then it is the browser's language, if Willow answers in it.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ms', name: 'Bahasa Melayu', english: 'Malay' },
  { code: 'zh', name: '中文', english: 'Chinese' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'th', name: 'ไทย', english: 'Thai' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'tl', name: 'Filipino', english: 'Filipino' },
] as const
export type LangCode = (typeof LANGUAGES)[number]['code']

const KEY = 'willow.lang'
const listeners = new Set<() => void>()
let current: LangCode = read()

/** One of Willow's languages ("zh-CN" is "zh"), or null. A declaration: `current` reads it at load. */
function known(code: string | null | undefined): LangCode | null {
  const base = (code ?? '').trim().toLowerCase().split('-')[0]
  return LANGUAGES.some((l) => l.code === base) ? (base as LangCode) : null
}

function read(): LangCode {
  let kept: string | null = null
  try {
    kept = localStorage.getItem(KEY)
  } catch {
    // private window: nothing kept
  }
  return known(kept) ?? known(typeof navigator === 'undefined' ? null : navigator.language) ?? 'en'
}

export function language(): LangCode {
  return current
}

export function setLanguage(code: LangCode) {
  if (code === current) return
  current = code
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // private window: this session only
  }
  // cached views and stories are keyed by language (useSessionView, StoryCard): the new language
  // reads its own; the advisor history keeps each answer in the language it was asked in
  listeners.forEach((l) => l())
}

/**
 * The language of Wisp's latest answer becomes the app's (its `lang`; an answer without one is English).
 * Anything Willow doesn't answer in is ignored.
 */
export function adoptLanguage(code: string): void {
  const got = known(code)
  if (got) setLanguage(got)
}

/** The header the api reads (none for English, the default). */
export function langHeader(): Record<string, string> {
  return current === 'en' ? {} : { 'X-Willow-Lang': current }
}

export function useLanguage(): LangCode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => 'en',
  )
}

/**
 * The fixed words an answer leans on, in the answer's own language: measurement names and the verdict and
 * card labels drawn around Wisp's words (api app/translate.py `labels`, sent with each translated answer).
 * English answers carry none, and the app's own words are used.
 */
export type AnswerLabels = { metrics: Record<string, string>; ui: Record<string, string> }
export type UiWord = 'within_range' | 'beyond_range' | 'not_compared' | 'baseline' | 'not_enough' | 'improved' | 'other_way' | 'shifted' | 'progress' | 'open' | 'routine' | 'details' | 'no_flags' | 'check_this'

export const uiWord = (labels: AnswerLabels | null | undefined, key: UiWord, english: string): string => labels?.ui[key] ?? english
export const metricWord = (labels: AnswerLabels | null | undefined, id: string, english: string): string => labels?.metrics[id] ?? english
