/** The words for each check status (api app/safety.py STATUS_WORDS): never "safe". Glyph and words always travel
 * together. Pure (no React), so `npm test` can read it; lib/safety.ts re-exports it. */

export type CheckStatus = 'clear' | 'check' | 'avoid' | 'not_sold' | 'unknown'

export const CHECK_WORDS: Record<CheckStatus, { label: string; short: string; glyph: string }> = {
  clear: { label: 'No flags for you', short: 'No flags', glyph: '✓' },
  check: { label: 'Check this', short: 'Check this', glyph: '!' },
  avoid: { label: 'Not advised for you', short: 'Not advised', glyph: '⊘' },
  not_sold: { label: 'Not sold as a cosmetic in your market', short: 'Not a cosmetic here', glyph: '—' },
  // An index product: Willow has no ingredient list for it, so nothing was checked (never "clear").
  unknown: { label: 'Not checked yet', short: 'Not checked yet', glyph: '?' },
}

/** What the reasons panel says when a check has no flags to list. */
export function noFlagsText(check: { status: CheckStatus; explanation?: string | null }): string {
  if (check.status === 'unknown') return check.explanation ?? 'No ingredient list yet — scan the label to check it'
  if (check.status === 'not_sold') return 'In your market this is sold as a medicine, not a cosmetic, so Willow does not suggest it.'
  return 'Nothing on its ingredient list matches what you told Willow.'
}
