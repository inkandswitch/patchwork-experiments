// A seat as a station: what the use prompt (scene.use) offers when you look
// at a seat's place at the table from within reach, in first person ("Sit as
// Player 1", F), and, sitting there with something to walk in, "Stand up"
// (F). Which seat a look is at, and which verb that gives, are worked out
// here (pure); extension.js does them, through the same sit() as the seat
// picker.
//
// A seat's place is its trays (its private zones, a little beyond their
// edges) and, for a seat with a camera, its bench: the floor under where its
// player's eye is (the seat camera's position, in its frame `in` as drawn),
// within BENCH_RADIUS of it across that frame, and from BENCH_DROP below it
// to a little above. A look counts there when what it lands on is a tray,
// something locked (the table, the board), or the thing a seat's camera is
// given in or one it's attached to (the table, the ship whose bench it is):
// never a loose piece, so F over a card is still the hand's Flip.

import { apply, invert } from "./frame.js";
import { zones } from "./visibility.js";

/** How far from the eye a seat's place can be sat at (m). */
export const SEAT_REACH = 2;
/** How far past a tray's edges a look still counts as at it (m). */
export const TRAY_MARGIN = 0.08;
/** A bench's reach across its frame from under the seat's eye (m), and how far below the eye it goes. */
export const BENCH_RADIUS = 0.5;
export const BENCH_DROP = 1.5;
/** How long an away seat waits for the second F (ms). */
export const CONFIRM_MS = 5000;

/**
 * The seat a look is at, or null.
 * @param {{ snap: object, target: string, point: number[] | null, from: number[] | null, seats: object, drawn: (id: string) => number[] | null }} o
 *   snap: api.scene(); target: what the prompt asks about; point: where the
 *   look landed (world, may be null when hovering); from: the eye (world);
 *   drawn: an object's world matrix as drawn (api.worldOf), null if it's gone
 */
export function seatLookedAt({ snap, target, point, from, seats, drawn }) {
  if (!Array.isArray(from) || target == null || !snap?.objects?.[target]) return null;
  const regions = zones(snap).filter((z) => seats?.[z.seat]);
  const near = (p) => Array.isArray(p) && Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) <= SEAT_REACH;
  // a tray: its seat, wherever on it the look landed (its middle, hovering without a point)
  const tray = regions.find((z) => z.id === target);
  if (tray) {
    const m = drawn(tray.id);
    const mid = m ? apply(m, [(tray.min[0] + tray.max[0]) / 2, tray.min[1], (tray.min[2] + tray.max[2]) / 2]) : null;
    return near(Array.isArray(point) ? point : mid) ? tray.seat : null;
  }
  if (!Array.isArray(point) || !near(point) || !placeLike(snap, target, seats)) return null;
  for (const z of regions) {
    const m = drawn(z.id);
    if (!m) continue;
    const p = apply(invert(m), point);
    const M = TRAY_MARGIN;
    if (p[0] >= z.min[0] - M && p[0] <= z.max[0] + M && p[2] >= z.min[2] - M && p[2] <= z.max[2] + M && p[1] >= z.min[1] - 0.05 && p[1] <= z.max[1] + 0.3) return z.seat;
  }
  for (const [sid, s] of Object.entries(seats ?? {})) {
    const cam = s?.camera;
    if (!Array.isArray(cam?.position)) continue;
    const m = cam.in ? drawn(cam.in) : null;
    if (cam.in && !m) continue;
    const p = m ? apply(invert(m), point) : point;
    const e = cam.position.map(Number);
    if (Math.hypot(p[0] - e[0], p[2] - e[2]) <= BENCH_RADIUS && p[1] <= e[1] + 0.2 && p[1] >= e[1] - BENCH_DROP) return sid;
  }
  return null;
}

/** Can a look at `target` be a look at a seat's place: something locked, or a seat camera's frame or what that's attached to? */
function placeLike(snap, target, seats) {
  if (snap.objects[target]?.locked) return true;
  const parent = (id) => snap.parents?.get?.(id) ?? (snap.objects?.[snap.objects?.[id]?.parent] ? snap.objects[id].parent : null);
  for (const s of Object.values(seats ?? {})) {
    const seen = new Set();
    for (let f = s?.camera?.in ?? null; f != null && !seen.has(f); f = parent(f)) {
      if (f === target) return true;
      seen.add(f);
    }
  }
  return false;
}

/**
 * The verb a seat offers this viewer, from where it stands for them
 * (extension.js seatState), or null:
 * - in first person (`immersive`): a seat whose player is here is refused
 *   ("Ana is sitting there", greyed out); one whose player has gone asks
 *   first (`confirm`: F once says whose hand you'd see, F again within
 *   CONFIRM_MS takes it); your own is "Back to your seat"; any other is
 *   "Sit as <name>";
 * - not in first person, sitting there, with something to walk in
 *   (`canStand`): "Stand up". The picker is the way to sit anywhere else.
 * Pure.
 * @param {{ name: string, state: string, who?: string | null, immersive: boolean, canStand: boolean, confirming: boolean }} o
 * @returns {{ verb: "sit" | "confirm" | "stand", label: string, title?: string, disabled?: boolean } | null}
 */
export function seatVerb({ name, state, who = null, immersive, canStand, confirming }) {
  if (immersive) {
    switch (state) {
      case "taken":
        return { verb: "sit", label: `${who || "Someone"} is sitting there`, disabled: true };
      case "away":
        return confirming
          ? { verb: "sit", label: `Take ${name}: F again`, title: "You'll see their hand" }
          : { verb: "confirm", label: `Sit as ${name} (${who || "its player"} is away)`, title: "Their seat can be taken: F, then F again. You'll see their hand" };
      case "mine":
        return { verb: "sit", label: "Back to your seat", title: `Sit down as ${name} again (F)` };
      case "mine-elsewhere":
      case "free":
        return { verb: "sit", label: `Sit as ${name}`, title: `Sit down at this table as ${name} (F)` };
    }
    return null;
  }
  if (state === "mine" && canStand) return { verb: "stand", label: "Stand up", title: `Get up from ${name} and walk; the seat stays yours (F at it sits you back down)` };
  return null;
}
