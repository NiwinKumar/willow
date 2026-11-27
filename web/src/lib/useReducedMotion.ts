import { useMediaQuery } from './useMediaQuery'

/** The person asked the OS for less motion: numbers land at once, reveals are instant, nothing drifts. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** A mouse or trackpad is driving (not a finger): hover and pointer-follow effects make sense. */
export function useFinePointer(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
