/**
 * Judge mode (docs/DEMO_PLAN.md): a guided tour at /judge. Each judge works in a guest account of
 * their own, so every stop runs the real api, engine and Gemini. Only the tour's progress lives here.
 */

export const JUDGE_STOPS = ['run', 'proof', 'advisor', 'routine', 'retailer'] as const
export type JudgeStop = (typeof JUDGE_STOPS)[number]

const KEY = 'willow.judge'

type State = { on: boolean; seen: JudgeStop[] }

function read(): State {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as State) : { on: false, seen: [] }
  } catch {
    return { on: false, seen: [] }
  }
}

function write(s: State) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode: the tour still works, it just forgets progress */
  }
  window.dispatchEvent(new Event('willow-judge'))
}

export const judge = {
  state: read,
  start: () => write({ ...read(), on: true }),
  stop: () => write({ on: false, seen: [] }),
  visit: (stop: JudgeStop) => {
    const s = read()
    if (!s.seen.includes(stop)) write({ ...s, seen: [...s.seen, stop] })
  },
}
