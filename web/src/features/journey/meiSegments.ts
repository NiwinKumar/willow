import { chatSettled } from '../advisor/chatStore'
import type { TourSegment, TourStep } from '../tour/types'
import { lineText } from './narration'

/**
 * What Mei does in the app, played between her journey's chapter slides (Journey.tsx). Eight Sundays are told in
 * five chapters (MEI_CHAPTERS: weeks 1, 2-3, 4-5, 6-7 and 8), so a judge sees the whole story in about half the
 * stops. Her real demo account, clicked by the walkthrough cursor: every chapter opens with a quick replay of one
 * evening's check-in (camera, upload, the four stages, from her real result; CheckInReplay.tsx), then what she
 * does with it. Captions name no numbers (the page shows them). Index k plays after chapter k's slide.
 */
const DAYS = ['2026-08-23', '2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']
const onResult = () => window.location.pathname.startsWith('/progress/')

/** Which of her weekly check-ins (0-based) each chapter tells, and the one it replays. */
export const MEI_CHAPTERS: { weeks: number[]; replay: number }[] = [
  { weeks: [0], replay: 0 },
  { weeks: [1, 2], replay: 2 },
  { weeks: [3, 4], replay: 4 },
  { weeks: [5, 6], replay: 6 },
  { weeks: [7], replay: 7 },
]

// A step's caption is its narration line (voice.json): spoken and shown together.
const v = (id: string) => ({ voice: id, caption: lineText(id) })
const checkIn = (k: number, id: string): TourStep => ({ route: `/replay/${DAYS[k]}${k === 0 ? '?full=1' : ''}`, until: onResult, hold: 1400, ...v(id) })
// Hold to compare, as she would: holding B flickers her baseline over this week's photo (useHoldCompare).
const holdB = (type: 'keydown' | 'keyup') => () => void window.dispatchEvent(new KeyboardEvent(type, { key: 'b' }))
const photo = 'css:[aria-label="Reference photo"] > div:first-child'
const compare = (id: string): TourStep[] => [
  { target: photo, action: 'point', hold: 900, ...v(id) },
  { target: photo, action: 'point', run: holdB('keydown'), hold: 3600, ...v('mei-c5-hold') },
  { run: holdB('keyup'), hold: 700, ...v('mei-c5-letgo') },
]
const askWisp = (question: string, answer: string): TourStep[] => [
  { target: 'css:[aria-label="Wisp"]', action: 'click', hold: 900, ...v('wisp-open') },
  { target: 'css:textarea', action: 'type', text: question, hold: 400, ...v('wisp-type') },
  { target: 'label:Send', action: 'click', until: chatSettled, hold: 5500, ...v(answer) },
  { target: 'label:Close Wisp', action: 'click', hold: 500, ...v('wisp-close') },
]
const seg = (k: number, title: string, steps: TourStep[]): TourSegment => ({ id: `mei-c${k + 1}`, title, demo: true, steps })

export const MEI_WEEKS: TourSegment[] = [
  seg(0, 'Week 1 in the app', [
    checkIn(0, 'mei-c1-checkin'),
    { target: 'text:Later days compare with this one', action: 'point', ...v('mei-c1-baseline') },
    { route: '/routine', target: 'text:Your routine', action: 'point', ...v('mei-c1-routine') },
  ]),
  seg(1, 'Weeks 2 and 3 in the app', [
    checkIn(2, 'mei-c2-checkin'),
    { target: 'text:Blemishes', action: 'point', ...v('mei-c2-blemishes') },
    ...askWisp('I started a retinol and a BHA this week and my chin is dry and flaky. Should I stop one?', 'mei-c2-answer'),
    { route: '/routine', target: 'text:Alternate these', action: 'point', ...v('mei-c2-clash') },
  ]),
  seg(2, 'Weeks 4 and 5 in the app', [
    checkIn(4, 'mei-c3-checkin'),
    { target: 'text:Compare photos', action: 'click', hold: 3400, ...v('mei-c3-compare') },
    { action: 'escape', hold: 1200, ...v('mei-c3-fair') },
    { route: '/routine', target: 'text:History', action: 'click', hold: 2800, ...v('mei-c3-history') },
    { action: 'escape', hold: 800, ...v('mei-c3-back') },
  ]),
  seg(3, 'Weeks 6 and 7 in the app', [
    checkIn(6, 'mei-c4-checkin'),
    { route: '/routine', target: 'text:duplicate', action: 'point', ...v('mei-c4-duplicate') },
    { route: '/home', target: 'text:Is your routine working?', action: 'point', hold: 3400, ...v('mei-c4-working') },
  ]),
  seg(4, 'Week 8 in the app', [
    checkIn(7, 'mei-c5-checkin'),
    ...compare('mei-c5-compare'),
    ...askWisp('Do I really need both niacinamide serums?', 'mei-c5-answer'),
    { route: '/routine', target: 'text:Niacinamide 10% + Zinc 1%', action: 'click', hold: 1400, ...v('mei-c5-serum') },
    { target: 'text:Stop using', action: 'click', hold: 2400, ...v('mei-c5-stop') },
  ]),
]
