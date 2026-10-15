/**
 * Email + password accounts (Firebase Auth), loaded lazily like lib/auth.tsx so the SDK never blocks the
 * first paint. A guest who creates an account keeps their sessions: the email credential is linked to the
 * same (anonymous) account instead of making a new one.
 *
 * The Email/Password provider must be switched on in the Firebase console; until it is, every call fails
 * with auth/operation-not-allowed and the form says so plainly.
 */
import { authErrorText } from '../../lib/authErrors'
import { DEV_UID } from '../../lib/devAuth'

const load = () => Promise.all([import('../../lib/firebase'), import('firebase/auth')])

class LocalModeError extends Error {
  code = 'willow/local-mode'
}

/** Local end-to-end runs sign in as a fixed test person; never create real accounts from them. */
function guardLocal() {
  if (DEV_UID) throw new LocalModeError('local test mode')
}

export async function createAccount(name: string, email: string, password: string): Promise<void> {
  guardLocal()
  const [{ firebaseAuth }, fa] = await load()
  await firebaseAuth.authStateReady()
  const current = firebaseAuth.currentUser
  const user = current?.isAnonymous
    ? (await fa.linkWithCredential(current, fa.EmailAuthProvider.credential(email, password))).user
    : (await fa.createUserWithEmailAndPassword(firebaseAuth, email, password)).user
  // The name lives on the Firebase profile only (lib/identity reads displayName); no api stores it.
  await fa.updateProfile(user, { displayName: name.trim() })
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  guardLocal()
  const [{ firebaseAuth }, fa] = await load()
  await firebaseAuth.authStateReady()
  await fa.signInWithEmailAndPassword(firebaseAuth, email, password)
}

export async function sendReset(email: string): Promise<void> {
  guardLocal()
  const [{ firebaseAuth }, fa] = await load()
  await fa.sendPasswordResetEmail(firebaseAuth, email)
}

/** Firebase's email errors in plain words. */
export function emailErrorText(e: unknown, mode: 'signin' | 'signup'): string {
  const code = (e as { code?: string })?.code ?? ''
  switch (code) {
    case 'willow/local-mode':
      return 'Email sign-in is off in local test mode.'
    case 'auth/operation-not-allowed':
      return 'Email sign-in isn’t switched on yet. Use Google, or continue as a guest.'
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return 'An account with this email already exists. Sign in instead.'
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return mode === 'signin' ? 'That email and password don’t match. Try again or reset your password.' : 'That did not work. Check the email and password, then try again.'
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'That email address doesn’t look right.'
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a stronger password: at least 8 characters, with a number or symbol.'
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a minute, then try again.'
    case 'auth/user-disabled':
      return 'This account has been switched off.'
    default:
      return authErrorText(e) ?? 'Sign-in did not work. Try again.'
  }
}
