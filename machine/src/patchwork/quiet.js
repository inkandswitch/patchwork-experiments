// Nobody holds a port: time stands still where the last player left it, so
// nobody comes back to hours of an empty world to catch up on (scene/TOOLS.md
// Decisions 1, "Nobody present: no time passes", as the machine has it).
import { seating } from "../host/session.js";

/**
 * The clock to write when nobody holds a port and the session's clock still
 * runs: stopped at the tick the last seat ended (in seconds); null when
 * someone holds one or it is already stopped. Pure.
 *
 * Every view runs it whenever the session changes, so whatever ends the last
 * seat (standing up, a tab closed and reaped by anyone after
 * SECONDS.reap of silence) stops the clock; two views writing it at once
 * write the same stop (the last writer's `at` stands).
 * @param {{ seats?: object, clock?: { until?: number } }} session  the session doc
 * @param {number} ports  @param {number} hz  ticks a second  @param {number} now  wall ms
 */
export function quietClock(session, ports, hz, now) {
  const held = seating(session?.seats, ports).some((p) => p.at(-1)?.until === Infinity);
  if (held || session?.clock?.until !== undefined) return null;
  const last = Math.max(0, ...Object.values(session?.seats ?? {}).map((x) => (x.until ?? 0) / hz));
  return { t: last, at: now, until: last };
}
