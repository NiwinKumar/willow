import { MIN_GROUP } from './format'

/** The Willow Proof glossary: one plain-language definition per term, shared by every section. */
export const GLOSSARY = {
  visible_change: {
    term: 'Visible change',
    text: 'A goal metric that is still beyond the person’s own photo noise band at the week-8 reading, in the desired direction. One lucky reading earlier does not count.',
  },
  proof_tier: {
    term: 'Proof tier',
    text: 'Proven: 30+ people and the lift’s 95% interval is above zero. Promising: 10+ people and a positive lift, but fewer than 30 people or an interval that still includes zero. No clear effect yet: no lift over non-users. Not enough data: fewer than 10 people.',
  },
  lift: {
    term: 'Lift',
    text: 'The product’s visible-change rate minus the rate of people with the same goal who don’t use it, in percentage points. An association, not proof of cause: people chose their own products.',
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
  ctr: {
    term: 'CTR',
    text: 'Click-through rate: “View product” clicks divided by impressions. Each person counts once a day for each.',
  },
  holdout: {
    term: 'Randomised holdout',
    text: 'A share of the people a campaign matches, picked at random, who never see its card. Adoption (adding the product to the routine by any path) among people who could see it, minus adoption in the holdout, is the lift the campaign caused. Shown once each group has 10 people.',
  },
} as const satisfies Record<string, { term: string; text: string }>

export type TermId = keyof typeof GLOSSARY
