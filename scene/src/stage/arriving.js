// Where a doc starts people (STAGE.md, "Arriving"): its `view.start` read,
// the kernel's keys of it and the whole of it, and where it leads through the
// links on the way. Pure; the view arrives by these (view.js `tryArrive`).

import { frozenJSON } from "./ambients.js";
import { cleanCamera } from "./camera-memory.js";

/** How long, once view.start's body is on offer, arriving waits for the content before entering it anyway (ms). */
export const ARRIVE_WAIT_MS = 20_000;

/**
 * The kernel's keys of the doc's `view.start`, read on arrival. `body` is a
 * body's id (none, or "look", is Look), `place` what its enter is given (an
 * object's id, or an id its body's package knows), `home` the camera.
 * @returns {{ body: string | null, place: string | null, home: object | null }}
 */
export function startOf(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object") return { body: null, place: null, home: null };
  const body = typeof s.body === "string" && s.body ? s.body : null;
  const place = typeof s.place === "string" && s.place ? s.place : null;
  return { body, place, home: cleanCamera(s.home) };
}

const NO_START = Object.freeze({});
/**
 * The doc's `view.start` whole, as written, a frozen plain copy ({} when it
 * has none): what `view.arrived` says, for each plugin to read its own keys
 * of (the kernel's are startOf's).
 */
export function wholeStart(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object" || Array.isArray(s)) return NO_START;
  try {
    return frozenJSON(JSON.parse(JSON.stringify(s)));
  } catch {
    return NO_START;
  }
}

/**
 * Where a start leads: from stage `s`, its doc's start; while its place
 * holds a stage (a link), on through it, as that doc starts people.
 * `next(s, id)` → the stage under it (false: it holds none, so the start is
 * here; undefined: not yet; null: nobody arrives through it). Each step is a
 * stage deeper in the view's finite tree, so this ends.
 * @returns {{ stage, body: string | null, place: string | null, through: boolean } | null | undefined}
 */
export function startArrival(s, { doc, next }) {
  let stage = s;
  let through = false;
  for (;;) {
    if (!stage) return undefined;
    const d = doc(stage);
    const { body, place } = startOf(d);
    const n = place == null ? false : next(stage, place);
    if (n === false) return { stage, body, place, through };
    if (n == null) return n;
    stage = n;
    through = true;
  }
}
