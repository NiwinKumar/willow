/** Pure name helpers for routine rows, so `npm test` reads them without the app. */
import type { ProductCheck } from '../../lib/safety'

/**
 * A short name for a row that must stay on one line: the catalog name cut at its first qualifier ("with",
 * "for", "&", ":", "+", " - "), the brand and strengths dropped, and long names reduced to the first words
 * plus the product type ("Green Tea Alcohol-Free Pore Tightening Face Toner For Oily Skin" -> "Green Tea
 * Toner"). The full name stays in the tooltip and the accessible label.
 */
export function compactName(e: { custom_name: string; brand: string; category: string }): string {
  let name = (e.custom_name || e.brand || 'Unnamed product').trim()
  if (e.brand && e.custom_name && name.toLowerCase().startsWith(e.brand.toLowerCase())) name = name.slice(e.brand.length).trim() || name
  const cut = name.split(/\s+(?:with|for|and|plus)\s+|\s*[&:+]\s*|\s+[-–]\s+/i)[0]
  const words = cut.split(/\s+/).filter((w) => !/^\d+(\.\d+)?%$/.test(w))
  const base = words.join(' ')
  if (!base) return name
  if (base.length <= 28) return base
  const type = words[words.length - 1]
  const isType = type.toLowerCase() === e.category.replace(/_/g, ' ').toLowerCase()
  return isType ? `${words.slice(0, 2).join(' ')} ${type}` : words.slice(0, 3).join(' ')
}

/**
 * Add product's "Confirm details" line for a product the checks advise against ('avoid', or not sold as a
 * cosmetic in the person's market), with the first reason; null otherwise. It warns and never blocks.
 */
export function notAdvisedLine(check: Pick<ProductCheck, 'status' | 'flags'> | null | undefined): string | null {
  if (!check || (check.status !== 'avoid' && check.status !== 'not_sold')) return null
  const flag = check.flags.find((f) => f.level === 'avoid') ?? check.flags[0]
  const reason = flag ? flag.title : 'it is not sold as a cosmetic in your market'
  // lower-case the first letter mid-sentence, unless the word is an acronym ("MI preservatives")
  const lead = /^[A-Z][A-Z]/.test(reason) ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`
  return `Not advised for you: ${lead}. You can still add it.`
}
