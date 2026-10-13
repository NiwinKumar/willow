/** Synthetic cohort aggregates for the retailer view. Every number here is simulated and labelled so. */
export type Cell = { value: number | null; n: number; suppressed: boolean }
export const TONE_BANDS = ['very light', 'light', 'intermediate', 'tan', 'brown', 'dark'] as const

const cell = (value: number, n: number): Cell => (n < 10 ? { value: null, n, suppressed: true } : { value, n, suppressed: false })

export const RETAILER = {
  cohort: { synthetic: 500, real: 2, weeks: 8, dropout: 0.15, seed: 7 },
  tiles: [
    { label: 'Active users', value: '427', n: 427, sub: 'week 8, after 15% dropout' },
    { label: 'Top goal', value: 'Even tone & dark spots', n: 189, sub: '44% of users' },
    { label: 'Unmet by week 8', value: '38%', n: 427, sub: 'no real change in the target metric' },
    { label: 'Median weeks to first real change', value: '5', n: 264, sub: 'among users who got one' },
  ],
  needs: [
    { goal: 'Even tone & fewer dark spots', real: 56, none: 31, early: 13, n: 189 },
    { goal: 'Clearer skin', real: 49, none: 38, early: 13, n: 112 },
    { goal: 'Calmer skin', real: 41, none: 44, early: 15, n: 74 },
    { goal: 'Smoother texture & pores', real: 35, none: 50, early: 15, n: 52 },
  ],
  products: [
    { product: 'Azelaic Acid Suspension 10%', brand: 'The Ordinary', concern: 'dark spots', cells: [cell(0.61, 24), cell(0.58, 31), cell(0.55, 29), cell(0.52, 22), cell(0.47, 14), cell(0, 6)], lift: 0.21, weeks: 5, cont: 0.78 },
    { product: 'Alpha Arbutin 2% Face Serum', brand: 'Minimalist', concern: 'dark spots', cells: [cell(0.44, 12), cell(0.41, 19), cell(0.39, 21), cell(0.4, 18), cell(0, 9), cell(0, 4)], lift: 0.08, weeks: 7, cont: 0.64 },
    { product: 'Niacinamide 10% + Zinc 1%', brand: 'The Ordinary', concern: 'blemishes', cells: [cell(0.48, 21), cell(0.5, 27), cell(0.46, 25), cell(0.44, 19), cell(0.42, 12), cell(0, 7)], lift: 0.14, weeks: 4, cont: 0.81 },
    { product: '2% Salicylic Acid Serum', brand: 'Minimalist', concern: 'blemishes', cells: [cell(0.52, 16), cell(0.49, 22), cell(0.45, 20), cell(0.47, 15), cell(0, 8), cell(0, 3)], lift: 0.12, weeks: 4, cont: 0.7 },
    { product: 'Retinol 0.3% Face Serum', brand: 'Minimalist', concern: 'texture', cells: [cell(0.33, 14), cell(0.3, 18), cell(0.29, 16), cell(0, 9), cell(0, 5), cell(0, 2)], lift: 0.05, weeks: 8, cont: 0.58 },
  ],
  brands: [
    { brand: 'The Ordinary', rate: 0.55, n: 173, lo: 0.48, hi: 0.62, cont: 0.79 },
    { brand: 'Minimalist', rate: 0.47, n: 84, lo: 0.37, hi: 0.57, cont: 0.7 },
    { brand: 'The Derma Co', rate: 0.41, n: 79, lo: 0.31, hi: 0.52, cont: 0.64 },
    { brand: 'Dot & Key', rate: 0.31, n: 64, lo: 0.21, hi: 0.43, cont: 0.58 },
    { brand: 'COSRX', rate: 0.29, n: 41, lo: 0.17, hi: 0.44, cont: 0.73 },
  ],
  gaps: [
    { goal: 'Dark spots', budget: { options: 2, rate: 0.41 }, mid: { options: 3, rate: 0.58 }, premium: { options: 0, rate: null }, action: 'Add a premium option for dark spots.' },
    { goal: 'Calmer skin', budget: { options: 1, rate: 0.36 }, mid: { options: 2, rate: 0.44 }, premium: { options: 1, rate: 0.47 }, action: 'Add a second budget option for redness.' },
    { goal: 'Texture & pores', budget: { options: 2, rate: 0.33 }, mid: { options: 1, rate: 0.3 }, premium: { options: 1, rate: 0.35 }, action: 'Outcome rates are low in every tier: an education opportunity.' },
  ],
  conflicts: [
    { pair: 'Retinoid + AHA/BHA, same night', share: 0.18, fix: 'Alternate nights', resolves: ['La Roche-Posay Anthelios SPF50+'] },
    { pair: 'No sunscreen with a retinoid or acid', share: 0.27, fix: 'Add daily SPF', resolves: ['La Roche-Posay Anthelios UVMune 400 SPF50+', 'The Derma Co 1% Hyaluronic Sunscreen SPF 50'] },
    { pair: 'Two exfoliants daily', share: 0.07, fix: 'Reduce frequency', resolves: [] },
  ],
}
