// Who builds a render (README.md, "Content", "Who builds"): the lock among
// the peers that have it open and may write it. Pure: what a peer does next,
// from the claims it has heard and its own, and when.
//
// A peer that wants a render built for inputs `key` claims it on the
// render's channel ({ key, phase: "claim" }), waits CLAIM_MS for a rival,
// then builds ({ phase: "build" }, said again every HEARTBEAT_MS while it
// runs) and says when it's done ({ phase: "done" }). It never claims while
// it hears a live claim of the same key from another, nor before it has
// listened LISTEN_MS. A peer that made the render itself builds it first at
// once: nobody else knows of it yet. Of two that claimed at once, the one
// with the lower id builds; a builder beats a claimer whatever their ids.

/** How often a builder says it is still building (ms). */
export const HEARTBEAT_MS = 2_000;
/** The longest a message or a change takes to reach every peer (ms): what the guarantees assume. */
export const REACH_MS = 250;
/** After claiming, how long a peer waits for a rival's claim before it builds: a message there and one back. */
export const CLAIM_MS = 2 * REACH_MS;
/** A claim not heard again for this long has lapsed: its peer vanished. Three heartbeats, so two may be lost. */
export const LAPSE_MS = 3 * HEARTBEAT_MS;
/** How long a peer that opened a render listens before it may claim it: long enough to hear a live builder. */
export const LISTEN_MS = LAPSE_MS;

/** Is a heard claim ({ key, phase, at }) still live at `now`? */
export const live = (c, now) => !!c && now - c.at < LAPSE_MS;

/**
 * The live claims heard of `key` from others, as [peer, claim].
 * @param {Map<string, { key: string, phase: "claim" | "build", at: number }>} heard  the latest from each peer
 */
export const rivals = (heard, key, now) => [...heard].filter(([, c]) => c.key === key && live(c, now));

/**
 * What a peer that wants `key` built does now.
 * @param {{ now: number, self: string, key: string, mine: { key: string, at: number } | null,
 *           heard: Map<string, { key, phase, at }>, listenedFrom: number, alone: boolean }} o
 *   mine: its own claim; listenedFrom: since when it has heard the channel;
 *   alone: it made the render and hasn't built it yet, so nobody else knows of it
 * @returns {{ act: "claim" } | { act: "build" } | { act: "wait", until: number }}
 *   wait: do nothing until then (or until something is heard or changes); a
 *   claim of its own that a rival beats is dropped by the caller
 */
export function lockStep({ now, self, key, mine, heard, listenedFrom, alone }) {
  const others = rivals(heard, key, now);
  if (alone && !others.length) return { act: "build" };
  if (now < listenedFrom + LISTEN_MS) return { act: "wait", until: listenedFrom + LISTEN_MS };
  const lapse = () => Math.max(...others.map(([, c]) => c.at + LAPSE_MS));
  if (mine?.key === key) {
    if (others.some(([peer, c]) => c.phase === "build" || peer < self)) return { act: "wait", until: lapse(), yielded: true };
    return now >= mine.at + CLAIM_MS ? { act: "build" } : { act: "wait", until: mine.at + CLAIM_MS };
  }
  return others.length ? { act: "wait", until: lapse() } : { act: "claim" };
}
