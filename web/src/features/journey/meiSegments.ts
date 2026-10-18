import { chatSettled } from '../advisor/chatStore'
import type { TourSegment, TourStep } from '../tour/types'

/**
 * What Mei does in the app each week, played between her journey's week slides (Journey.tsx). Her real demo
 * account, clicked by the walkthrough cursor: every week opens with a quick replay of that evening's check-in
 * (camera, upload, the four stages, from her real result; CheckInReplay.tsx), then what she does with it. Captions
 * name no numbers (the page shows them). Index k plays after week k's slide.
 */
const DAYS = ['2026-08-23', '2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']
const onResult = () => window.location.pathname.startsWith('/progress/')

const checkIn = (k: number, caption: string): TourStep => ({ route: `/replay/${DAYS[k]}${k === 0 ? '?full=1' : ''}`, until: onResult, hold: 1400, caption })
// Hold to compare, as she would: holding B flickers her baseline over this week's photo (useHoldCompare).
const holdB = (type: 'keydown' | 'keyup') => () => void window.dispatchEvent(new KeyboardEvent(type, { key: 'b' }))
const photo = 'css:[aria-label="Reference photo"] svg[role="img"]'
const compare = (caption: string): TourStep[] => [
  { target: photo, action: 'point', hold: 900, caption },
  { target: photo, action: 'point', run: holdB('keydown'), hold: 3600, caption: 'She holds the photo: her baseline flickers over this week’s, same framing. The quickest way to see a change.' },
  { run: holdB('keyup'), hold: 700, caption: 'She lets go: back to this week.' },
]
const askWisp = (question: string, caption: string): TourStep[] => [
  { target: 'css:[aria-label="Wisp"]', action: 'click', hold: 900, caption: 'She has a question, so she opens Wisp.' },
  { target: 'css:textarea', action: 'type', text: question, hold: 400, caption: 'She asks in her own words.' },
  { target: 'label:Send', action: 'click', until: chatSettled, hold: 5500, caption },
  { target: 'label:Close Wisp', action: 'click', hold: 500, caption: 'She acts on the answer.' },
]
const seg = (k: number, steps: TourStep[]): TourSegment => ({ id: `mei-w${k + 1}`, title: `Week ${k + 1} in the app`, demo: true, steps })

export const MEI_WEEKS: TourSegment[] = [
  seg(0, [
    checkIn(0, 'Sunday evening: her first check-in. Three face photos by the window and a cheek close-up, uploaded and measured by the engine.'),
    { target: 'text:Later days compare with this one', action: 'point', caption: 'It becomes her baseline: every later week is compared with her own skin, never with anyone else’s.' },
    { target: 'text:Pores', action: 'point', caption: 'The close-up adds pores and texture: they need a macro photo.' },
    { route: '/routine', target: 'text:Your routine', action: 'point', caption: 'She lists what she uses. A niacinamide serum and a centella cream start the next day.' },
  ]),
  seg(1, [
    checkIn(1, 'Week 2: same window, same light, same distance. Checked in and measured in seconds.'),
    ...compare('She compares with her baseline.'),
    { route: '/routine', target: 'label:Mark as used this evening', action: 'click', caption: 'Every evening she ticks what she used, so her products can be lined up with her readings.' },
  ]),
  seg(2, [
    checkIn(2, 'Week 3: she checks in after a rough week.'),
    { target: 'text:Blemishes', action: 'point', caption: 'A flare: a week after starting a retinol and a BHA, blemishes moved beyond her normal range.' },
    ...askWisp('I started a retinol and a BHA last week and I’m breaking out more. Should I stop one?', 'Wisp reads her measurements and routine (Gemini, live). It may only quote numbers already in her data.'),
    { route: '/routine', target: 'text:Alternate these', action: 'point', caption: 'The routine check agrees: a retinoid and an acid in the same routine, with a one-tap fix.' },
  ]),
  seg(3, [
    checkIn(3, 'Week 4: check-in, and a cheek close-up for pores and texture.'),
    { route: '/routine', target: 'text:History', action: 'click', hold: 3000, caption: 'She stopped the BHA after it stung. History keeps it with its dates, so its effect can still be read.' },
    { action: 'escape', caption: 'Back to her routine.', hold: 1000 },
  ]),
  seg(4, [
    checkIn(4, 'Week 5: back from a weekend away, she still checks in on Sunday.'),
    { target: 'text:Compare photos', action: 'click', hold: 3400, caption: 'She compares photos side by side: her baseline against this week.' },
    { action: 'escape', caption: 'Same light, same distance: that is what makes the comparison fair.', hold: 1400 },
  ]),
  seg(5, [
    checkIn(5, 'Week 6: check-in and close-up.'),
    { target: 'text:Blemishes', action: 'point', caption: 'Blemishes are coming down, beyond her normal range this time.' },
    { route: '/routine', target: 'text:duplicate', action: 'point', caption: 'She adds a second niacinamide serum. The routine check notices three products with niacinamide.' },
  ]),
  seg(6, [
    checkIn(6, 'Week 7: another Sunday check-in.'),
    { route: '/home', target: 'text:Is your routine working?', action: 'point', hold: 3400, caption: 'Is it working? Each product next to the reading it targets, since the day she started it. An association, not proof.' },
  ]),
  seg(7, [
    checkIn(7, 'Week 8: her latest check-in, face and close-up.'),
    ...compare('Eight weeks on, she compares with week 1.'),
    ...askWisp('Do I really need both niacinamide serums?', 'Wisp answers from her routine and the catalog, checked against her data.'),
    { route: '/routine', target: 'text:Niacinamide 10% + Zinc 1%', action: 'click', hold: 1400, caption: 'She opens the serum she doubles up on…' },
    { target: 'text:Stop using', action: 'click', hold: 2400, caption: '…and stops it. It moves under Stopped with its dates, so its effect can still be read.' },
    { target: 'label:Mark as used this evening', action: 'click', caption: 'Then she ticks tonight’s routine. Next Sunday, Willow measures again.' },
  ]),
]
