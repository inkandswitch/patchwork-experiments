// Who builds a render (README.md, "Content", "Who builds"): one claim per
// render document, among the peers that have it open and may write it.
// Pure: what a peer does next, from the claims it has heard and its own.
//
// A peer that wants the render built claims it on the render's channel
// ({ phase: "claim" }), waits CLAIM_MS for a rival, then holds it: it builds,
// rebuilds as the inputs move, retries a failure, says it still holds it
// every HEARTBEAT_MS ({ phase: "build" } while a build runs, else { phase:
// "hold" }), and lets it go ({ phase: "done" }) once it has wanted nothing
// for HEARTBEAT_MS. It never claims while it hears another peer's live
// claim, nor before it has listened LISTEN_MS to a render it didn't make.
// Of two that claimed at once the lower id holds; a holder beats a claimer
// whatever their ids.
//
// Timing decides only who builds. What is written is decided by the write
// fence (render-manager.js): a result is written only over the build its
// writer saw as its own began, only if nobody else claimed the render
// meanwhile, and, if the writer's own claim may have lapsed for the others,
// only after waiting long enough to hear any claim that was on its way.
//
// The one assumption: every message and change reaches every peer within
// REACH_MS (D). Each window, derived from D and the heartbeat H:
//   CLAIM_MS  = 4D: two claims within D of each other each reach the other's
//               claimer by 2D; needs > 2D (an exact tie at D included), margin 2D.
//   LAPSE_MS  = 3H: a live holder's heartbeats arrive at most H + D apart; with
//               one lost, 2H + D; needs > 2H + D (D < H), margin H − D.
//   LISTEN_MS = LAPSE_MS: a peer that opens hears a live holder (within H + D)
//               and a claim on its way becoming a hold (within CLAIM_MS + D).
//   LEASE_MS  = LAPSE_MS − H − D: a holder that has said it holds within this
//               long writes at once (the others can't have let its claim lapse,
//               one heartbeat lost or not); past it, it first waits RECHECK_MS.
//   RECHECK_MS = 2D: hears any claim sent before its write (needs > D), and its
//               write reaches a new claimer before that one's build begins
//               (needs < CLAIM_MS − D = 3D); margin D each side.

/** How often a holder says it still holds the render (ms). */
export const HEARTBEAT_MS = 2_000;
/** The longest a message or a change takes to reach every peer (ms): what the timing invariants assume. */
export const REACH_MS = 250;
/** After claiming, how long a peer waits for a rival's claim before it holds the render. */
export const CLAIM_MS = 4 * REACH_MS;
/** A claim not heard again for this long has lapsed: its peer vanished. */
export const LAPSE_MS = 3 * HEARTBEAT_MS;
/** How long a peer that opened a render listens before it may claim it. */
export const LISTEN_MS = LAPSE_MS;
/** How recently a holder must have said it holds to write without first listening again. */
export const LEASE_MS = LAPSE_MS - HEARTBEAT_MS - REACH_MS;
/** How long a holder whose lease ran out listens for a rival's claim before it writes. */
export const RECHECK_MS = 2 * REACH_MS;

/** Is a heard claim ({ phase, at }) still live at `now`? */
export const live = (c, now) => !!c && now - c.at < LAPSE_MS;

/**
 * What a peer that wants the render built, and doesn't hold it, does now.
 * @param {{ now: number, self: string, mine: { at: number } | null,
 *           heard: Map<string, { phase: "claim" | "build" | "hold", at: number }>,
 *           listenedFrom: number, alone: boolean }} o
 *   mine: its own claim, while it waits for a rival; heard: the latest from each
 *   other peer; listenedFrom: since when it has heard the render's channel;
 *   alone: it made the render and hasn't built it yet, so nobody else knows of it
 * @returns {{ act: "claim" } | { act: "hold" } | { act: "wait", until: number, yielded?: true }}
 */
export function lockStep({ now, self, mine, heard, listenedFrom, alone }) {
  const others = [...heard].filter(([, c]) => live(c, now));
  if (alone && !others.length) return { act: "hold" };
  const lapse = () => Math.max(...others.map(([, c]) => c.at + LAPSE_MS));
  if (mine) {
    if (others.some(([peer, c]) => c.phase !== "claim" || peer < self)) return { act: "wait", until: lapse(), yielded: true };
    return now >= mine.at + CLAIM_MS ? { act: "hold" } : { act: "wait", until: mine.at + CLAIM_MS };
  }
  if (now < listenedFrom + LISTEN_MS) return { act: "wait", until: listenedFrom + LISTEN_MS };
  return others.length ? { act: "wait", until: lapse() } : { act: "claim" };
}
