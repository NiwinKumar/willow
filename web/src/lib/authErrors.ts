/** A sign-in error in plain words; null when the person simply closed the popup. */
export function authErrorText(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? ''
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null
  if (code === 'auth/popup-blocked') return 'The sign-in window was blocked. Allow pop-ups for this site and try again.'
  if (code === 'auth/network-request-failed') return 'No connection. Check your network and try again.'
  return 'Sign-in did not work. Try again.'
}
