import { ApiError } from '../../lib/api'

/**
 * Proof's reads, tried again when the failure was the connection's and not the answer's: a dropped HTTP/2 stream
 * (Chrome's ERR_HTTP2_PROTOCOL_ERROR reaches fetch as a TypeError), a rate limit or the api restarting (502–504).
 * A 4xx is an answer and is never repeated; neither is a timeout (it already waited its full time).
 */
export function transient(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 429 || (e.status >= 502 && e.status <= 504)
  return e instanceof TypeError
}

/** `load()`, again after each wait in `waits` (ms) while it fails transiently; the last failure is thrown. */
export async function retrying<T>(load: () => Promise<T>, waits: readonly number[] = [500, 1500]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await load()
    } catch (e) {
      if (i >= waits.length || !transient(e)) throw e
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}
