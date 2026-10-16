import { MIN_GROUP } from './format'

/** The Willow Proof glossary: one plain-language definition per term, shared by every section. */
export const GLOSSARY = {
  real_change: {
    term: 'Real change',
    text: 'A goal metric that is still beyond the person’s own photo noise band at the week-8 reading, in the desired direction. One lucky reading earlier does not count.',
  },
  proof_tier: {
    term: 'Proof tier',
    text: 'Proven: 30+ people and the lift’s 95% interval is above zero. Promising: 10+ people and a positive lift that could still be chance. No clear effect yet: no lift over non-users. Not enough data: fewer than 10 people.',
  },
  lift: {
    term: 'Lift',
    text: 'The product’s real-change rate minus the rate of people with the same goal who don’t use it, in percentage points. An association, not proof of cause: people chose their own products.',
  },
  base_rate: {
    term: 'Non-users',
    text: 'People with an overlapping goal and 8 weeks of readings who don’t use the product. Shown only when there are 10 or more of them.',
  },
  interval: {
    term: '95% interval',
    text: 'Where the true rate likely sits given how many people were measured (Wilson interval). Small groups have wide intervals, so small differences should not be over-read.',
  },
  continuation: {
    term: 'Continuation',
    text: 'Share of people still using a product for their goal at week 8. A signal of fit, not of effect.',
  },
  suppression: {
    term: 'Suppression',
    text: `Any group with fewer than ${MIN_GROUP} people is withheld by the api, so it never reaches charts, tables, exports or answers. Shown as “Fewer than ${MIN_GROUP} people”, never as zero.`,
  },
  routine_share: {
    term: 'Share of routines',
    text: 'People using the product out of everyone using any product in the same category.',
  },
} as const satisfies Record<string, { term: string; text: string }>

export type TermId = keyof typeof GLOSSARY
