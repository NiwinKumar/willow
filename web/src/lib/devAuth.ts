/**
 * Local end-to-end runs only. With VITE_AUTH_MODE=dev (never set for a deployed build) the app
 * skips Firebase sign-in and sends X-Dev-Uid, which only an api started with AUTH_MODE=dev
 * accepts. See docs/LOCAL_DEV.md, "End-to-end test".
 */
export const DEV_UID: string | null =
  import.meta.env.VITE_AUTH_MODE === 'dev' ? ((import.meta.env.VITE_DEV_UID as string | undefined) ?? 'e2e_local') : null
