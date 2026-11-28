/**
 * The tab icon per product: Willow's light tile for the shopper app and website, Proof by Willow's dark tile
 * (web/public/proof-favicon*) while the retail app is open, so the two read apart in a row of tabs. index.html
 * sets Proof's icon before the app loads on /retail (no flash of Willow's); this keeps it right on navigation.
 */
const ICONS = {
  willow: { '32x32': '/favicon-32.png', '64x64': '/favicon-64.png', touch: '/apple-touch-icon.png' },
  proof: { '32x32': '/proof-favicon-32.png', '64x64': '/proof-favicon-64.png', touch: '/proof-apple-touch-icon.png' },
} as const

export function setFavicon(product: keyof typeof ICONS) {
  const set = ICONS[product]
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => {
    const href = set[l.sizes.value as '32x32' | '64x64']
    if (href && l.getAttribute('href') !== href) l.setAttribute('href', href)
  })
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (touch && touch.getAttribute('href') !== set.touch) touch.setAttribute('href', set.touch)
}
