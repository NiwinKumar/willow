/**
 * Guided walkthroughs: the real app, clicked by a visible cursor, with a caption per step. A journey page
 * (Mei's weeks, a brand's launch) plays a short segment between its story slides, then comes back.
 *
 * Targets are found on the live page, so a walkthrough always shows the real UI:
 *   'text:See result'      the smallest visible element whose text includes it (buttons and links first)
 *   'label:Close Wisp'     an element whose aria-label includes it
 *   'css:section.card'     any CSS selector (first visible match)
 */
export type TourTarget = string

export type TourStep = {
  /** Navigate first (path and search). The page's own data loads as usual; the step waits for its target. */
  route?: string
  /** What the cursor moves to (scrolled into view). No target: the caption shows with no cursor move. */
  target?: TourTarget
  /** click: press it. type: type `text` into it (a textarea or input), then nothing else. escape: press Esc. */
  action?: 'click' | 'type' | 'escape' | 'point'
  text?: string
  /** One or two plain sentences: what she is doing and what Willow does with it. Numbers only if on screen. */
  caption: string
  /** The narration line that speaks the caption (journey/voice.json). The step lasts at least as long as it. */
  voice?: string
  /** How long the step stays after its action, in ms (default 2600). */
  hold?: number
  /** Wait for this before moving on (checked every 250 ms, at most `wait`), e.g. Wisp's answer. */
  until?: () => boolean
  /** The longest `until` waits, in ms (default 30 s): a live Gemini answer can take longer. */
  wait?: number
  /** Runs before the step's action (e.g. set up demo state). */
  run?: () => void | Promise<void>
}

export type TourSegment = {
  id: string
  /** Shown above the caption, e.g. "Week 3 in the app". */
  title: string
  steps: TourStep[]
  /** Enter Mei's read-only demo account first (her app segments). Brand segments leave it false. */
  demo?: boolean
}
