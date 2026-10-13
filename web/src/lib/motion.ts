/** Motion tokens from docs/DESIGN.md section 4.4. Springs follow Apple's damping/response idea: no bounce by default. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const DUR = { instant: 0.08, fast: 0.14, base: 0.22, slow: 0.32, moment: 0.7 } as const
export const SPRING_SETTLE = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const
export const SPRING_SOFT = { type: 'spring', visualDuration: 0.3, bounce: 0.1 } as const
export const SPRING_STAMP = { type: 'spring', visualDuration: 0.45, bounce: 0.2 } as const
