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
// claim. Of two that claimed at once the lower id holds; a holder beats a
// claimer whatever their ids; of two holders (after a lost message) the
// higher id lets go once it isn't building. Whoever beats a claim answers it
// at once (render-manager.js): a holder says it holds, a lower-id claimer
// claims again, so a peer that opened the render late hears them within its
// window. The maker of a render, building it the first time, holds it
// without claiming: nobody else knows of it.
//
// The lock is advisory: it decides who builds, and gates nothing written. A
// finished build is written by compare-and-set (build.js): only over the
// result its writer had as its build began. Two writes made without seeing
// each other merge to one writer's whole result, and every replica judges
// that result fresh or stale by what it records, so an older one that wins
// is rebuilt by the ordinary path.
//
// The one assumption: every message and change reaches every peer within
// REACH_MS (D). Each window, derived from D and the heartbeat H:
//   CLAIM_MS  = 4D: a claim and its answer (or a rival claim sent within D of
//               it) are back by 2D; needs > 2D (an exact tie at D included),
//               margin 2D.
//   LAPSE_MS  = 3H: a live holder's heartbeats arrive at most H + D apart; with
//               one lost, 2H + D; needs > 2H + D (D < H), margin H − D.

/** How often a holder says it still holds the render (ms). */
export const HEARTBEAT_MS = 2_000;
/** The longest a message or a change takes to reach every peer (ms): what the timing invariants assume. */
export const REACH_MS = 250;
/** After claiming, how long a peer waits for a rival's claim before it holds the render. */
export const CLAIM_MS = 4 * REACH_MS;
/** A claim not heard again for this long has lapsed: its peer vanished. */
export const LAPSE_MS = 3 * HEARTBEAT_MS;

/** Is a heard claim ({ phase, at }) still live at `now`? */
export const live = (c, now) => !!c && now - c.at < LAPSE_MS;

/**
 * What a peer that wants the render built, and doesn't hold it, does now.
 * @param {{ now: number, self: string, mine: { at: number } | null,
 *           heard: Map<string, { phase: "claim" | "build" | "hold", at: number }>,
 *           alone: boolean }} o
 *   mine: its own claim, while it waits for a rival; heard: the latest from each
 *   other peer; alone: it made the render and hasn't built it yet, so nobody
 *   else knows of it
 * @returns {{ act: "claim" } | { act: "hold" } | { act: "wait", until: number, yielded?: true }}
 */
export function lockStep({ now, self, mine, heard, alone }) {
  const others = [...heard].filter(([, c]) => live(c, now));
  if (alone && !others.length) return { act: "hold" };
  const lapse = () => Math.max(...others.map(([, c]) => c.at + LAPSE_MS));
  if (mine) {
    if (others.some(([peer, c]) => c.phase !== "claim" || peer < self)) return { act: "wait", until: lapse(), yielded: true };
    return now >= mine.at + CLAIM_MS ? { act: "hold" } : { act: "wait", until: mine.at + CLAIM_MS };
  }
  return others.length ? { act: "wait", until: lapse() } : { act: "claim" };
}
