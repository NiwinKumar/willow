/** Pure name helpers for routine rows, so `npm test` reads them without the app. */

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
