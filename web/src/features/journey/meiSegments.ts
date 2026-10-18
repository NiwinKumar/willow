import { chatSettled } from '../advisor/chatStore'
import type { TourSegment } from '../tour/types'

/**
 * What Mei does in the app each week, played between her journey's week slides (Journey.tsx). Her real demo
 * account, clicked by the walkthrough cursor: the pages, readings and Wisp answers are live. Captions name no
 * numbers (the page shows them). Index k plays after week k's slide.
 */
const seg = (k: number, steps: TourSegment['steps']): TourSegment => ({ id: `mei-w${k + 1}`, title: `Week ${k + 1} in the app`, demo: true, steps })

export const MEI_WEEKS: TourSegment[] = [
  seg(0, [
    { route: '/progress/2026-08-23', target: 'text:Later days compare with this one', action: 'point', caption: 'Her first check-in becomes her baseline. Every later week is compared with her own skin, never with anyone else’s.' },
    { target: 'text:Pores', action: 'point', caption: 'The cheek close-up adds pores and texture: they need a macro photo, so they get their own check-in.' },
    { route: '/routine', target: 'text:Your routine', action: 'point', caption: 'She lists what she uses. A niacinamide serum and a centella cream start the next day.' },
  ]),
  seg(1, [
    { route: '/progress/2026-08-30', target: 'text:Show baseline', action: 'click', hold: 3200, caption: 'One week in, she holds to compare: her baseline flickers over this week’s photo.' },
    { target: 'text:Show baseline', action: 'click', hold: 1600, caption: 'Nothing has moved beyond her normal range yet, and Willow says so plainly.' },
    { route: '/routine', target: 'label:Mark as used this evening', action: 'click', caption: 'Every evening she ticks what she used, so her products can be lined up with her readings.' },
  ]),
  seg(2, [
    { route: '/progress/2026-09-06', target: 'text:Blemishes', action: 'point', caption: 'A flare: a week after starting a retinol and a BHA, blemishes moved beyond her normal range.' },
    { route: '/routine', target: 'text:Alternate these', action: 'point', caption: 'The routine check flags a retinoid and an acid in the same routine, with a one-tap fix.' },
  ]),
  seg(3, [
    { route: '/routine', target: 'text:History', action: 'click', hold: 3200, caption: 'She stops the BHA after it stings. History keeps it with its dates, so its effect can still be read.' },
    { action: 'escape', caption: 'Back to her routine.', hold: 1200 },
  ]),
  seg(4, [
    { route: '/progress/2026-09-20', target: 'text:Compare photos', action: 'click', hold: 3600, caption: 'After a weekend away she compares photos side by side: her baseline against this week.' },
    { action: 'escape', caption: 'Same light, same distance: that is what makes the comparison fair.', hold: 1800 },
  ]),
  seg(5, [
    { route: '/progress/2026-09-27', target: 'text:Blemishes', action: 'point', caption: 'Blemishes are coming down, beyond her normal range this time.' },
    { route: '/routine', target: 'text:duplicate', action: 'point', caption: 'She adds a second niacinamide serum. The routine check notices three products with niacinamide.' },
  ]),
  seg(6, [
    { route: '/home', target: 'text:Is your routine working?', action: 'point', hold: 3400, caption: 'Is it working? Each product next to the reading it targets, since the day she started it. An association, not proof.' },
    { route: '/progress', target: 'css:main h1', action: 'point', caption: 'Seven weeks at a glance, every one measured the same way.' },
  ]),
  seg(7, [
    { route: '/home', target: 'text:See result', action: 'click', caption: 'Week 8. Her latest result: measured by the engine, explained by Gemini from those numbers only.' },
    { target: 'text:Show baseline', action: 'click', hold: 3400, caption: 'Hold to compare: week 1 flickers over week 8 on the same framing.' },
    { target: 'text:Show baseline', action: 'click', hold: 800, caption: 'Then she has a question.' },
    { target: 'css:[aria-label="Wisp"]', action: 'click', hold: 1200, caption: 'She opens Wisp.' },
    { target: 'css:textarea', action: 'type', text: 'Do I really need both niacinamide serums?', hold: 500, caption: 'She asks about her routine.' },
    { target: 'label:Send', action: 'click', until: chatSettled, hold: 6000, caption: 'Wisp reads her measurements and routine (Gemini, live). It may only quote numbers already in her data.' },
    { target: 'label:Close Wisp', action: 'click', hold: 600, caption: 'She acts on the answer.' },
    { route: '/routine', target: 'text:Niacinamide 10% + Zinc 1%', action: 'click', hold: 1600, caption: 'She opens the serum she doubles up on…' },
    { target: 'text:Stop using', action: 'click', hold: 2600, caption: '…and stops it. It moves under Stopped with its dates, so its effect can still be read.' },
    { target: 'label:Mark as used this evening', action: 'click', caption: 'Then she ticks tonight’s routine. Next Sunday, Willow measures again.' },
  ]),
]
