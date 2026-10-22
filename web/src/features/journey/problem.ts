/**
 * Public survey figures behind the problem Willow answers, each with its source. Shared by the journey's problem
 * slide and the landing page, so both say the same thing.
 */
export const PROBLEM_STATS: { group: string; rows: { pct: number; label: string; value?: string; source: string; good?: boolean }[] }[] = [
  {
    group: 'Shoppers can’t tell what works',
    rows: [
      { pct: 90, label: 'are frustrated finding skincare products that work', source: 'Drive Research, 1,004 women' },
      { pct: 62, label: 'worry about ineffective results', source: 'Drive Research, 1,004 women' },
      { pct: 15, label: 'think their wrinkle products work very well', source: 'Drive Research, 1,004 women' },
    ],
  },
  {
    group: 'So money is wasted',
    rows: [
      { pct: 52, label: 'of Gen Z regret overspending on beauty', source: 'LendingTree, US' },
      { pct: 50, value: '~50%', label: 'have kept unused skincare for over a year', source: 'Consumer Council, Hong Kong' },
    ],
  },
  {
    group: 'And proof is worth paying for',
    rows: [{ pct: 85, label: 'would pay more for products with proven efficacy', source: 'Euromonitor, Top Global Consumer Trends 2024', good: true }],
  },
]

/** The cost of guessing, in one figure. */
export const UNUSED_SKINCARE = { value: '£1 billion+', label: 'of unused skincare sits in UK homes', source: 'The Body Shop, 2,000 adults' }
