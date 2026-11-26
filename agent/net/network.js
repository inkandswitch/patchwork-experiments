/**
 * Interruptions: the network going away is not a failure.
 *
 * A request that never reached the other end did nothing, so nothing about it
 * is worth telling the model or the person as an error. The run stops where it
 * is, the session says it is reconnecting, and the run tries again when the
 * network comes back (kernel/burst.js). Nothing is written to the transcript for it.
 *
 * What is an interruption is decided where it is certain, and nowhere else:
 *
 *   - the model's endpoint could not be reached, answered "try again later"
 *     (408, 429, 502, 503, 504, 529) past the provider's own retries, dropped
 *     the reply part-way, or went silent (providers/openrouter.js);
 *   - the fetch relay, which is ours, could not be reached (net/relay.js);
 *   - this machine says it has no network: the browser is offline, or the
 *     operating system has no route or no resolver (`networkDown` below).
 *
 * A third-party site that will not answer is NOT one. It may be down for good,
 * and the model needs to hear that, so it stays a tool error.
 *
 * A tool that throws an Interruption is declaring that its call had no effect.
 * The loop puts the call back as it was before it ran, and it runs again once
 * the network is back (kernel/loop.js). Only throw one where that holds.
 */

export class Interruption extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "Interruption"
    this.interruption = true
  }
}

/** Was this an interruption? By marker, not class: one may cross a worker or a module copy. */
export function isInterruption(err) {
  return !!err?.interruption
}

/** Does this machine say it has no network? Only ever a definite no: `navigator.onLine` true means nothing. */
export function offline() {
  return globalThis.navigator?.onLine === false
}

/** OS errors that mean this machine's network, not the far end: no route, no interface, no resolver. */
const LOCAL_NETWORK_CODES = new Set(["ENETUNREACH", "ENETDOWN", "EAI_AGAIN", "ENOTCONN"])

/**
 * Did this failed request fail because this machine has no network? True when
 * the browser says it is offline, or node's error (or its cause) is one of the
 * codes above. False otherwise, including for every refusal by a site.
 */
export function networkDown(err) {
  if (offline()) return true
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (LOCAL_NETWORK_CODES.has(e.code)) return true
  }
  return false
}

/** The interruption an error stands for, or null when it is not one. */
export function asInterruption(err, what) {
  if (isInterruption(err)) return err
  if (networkDown(err)) return new Interruption(`${what}: this machine has no network`, { cause: err })
  return null
}

/** How long to wait before the Nth reconnection attempt (from 1): 2 s doubling to a minute. */
export const RECONNECT_FIRST_MS = 2000
export const RECONNECT_MAX_MS = 60_000
export function reconnectDelay(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS * 2 ** Math.max(0, attempt - 1))
}

/**
 * Be told when the network comes back. In a page or a worker that is the
 * `online` event; node has none, and the runner's backoff alone brings it back.
 * Returns an unsubscribe function.
 */
export function onOnline(fn, target = globalThis) {
  if (typeof target?.addEventListener !== "function") return () => {}
  target.addEventListener("online", fn)
  return () => target.removeEventListener?.("online", fn)
}
