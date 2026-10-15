import type { User } from 'firebase/auth'

/** How the app names the person: first name from Google, "Guest" for guests, never a stored profile. */
export function identity(user: User | null): { name: string; first: string; short: string; initials: string; email: string | null; guest: boolean } {
  const guest = !user || user.isAnonymous
  const name = (!guest && (user?.displayName || user?.email?.split('@')[0])) || 'Guest'
  const first = guest ? 'there' : name.split(/\s+/)[0]
  const initials = guest
    ? 'G'
    : name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('')
  return { name, first, short: guest ? 'Guest' : name.split(/\s+/)[0], initials, email: guest ? null : (user?.email ?? null), guest }
}
