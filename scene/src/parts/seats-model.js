// Seats: the places people take at a scene (scene trait "scene.seats"), and
// the pure side of the part that owns them (seats.js). A seat is
// { name, player: <viewer> | null, camera?: { position, target, in? } };
// `in` is an object id, the frame the camera is given in (a table aboard a
// ship); absent, the world.
//
// Nothing outside this package reads or writes the trait. Others meet seats
// through three conventions (STAGE.md, "Seats"):
//   - `roster`, contributed here: who sits where, for whoever needs to know
//     (a table's hands, a keeper's players);
//   - `seatPlaces`, contributed by whoever gives a seat somewhere to be (a
//     hand tray): where its name tag goes, and what a look at it means;
//   - `firstPerson`, contributed by whatever walks: the hand-off when someone
//     sits down from, or stands up into, first person.
// And setup code writes seats with this module's `lay(d, seats)`, found by
// the plugin's `roster: true` in the scene:extension registry.

import { applyMatrix, invertMatrix } from "../transform.js";

export const SEATS = "scene.seats";

/** A seat's claim kind, on the scene (STAGE.md, "Claims"). */
export const SEAT_CLAIM = (sid) => `scene.seat:${sid}`;

/** The scene's seats: { [seatId]: { name, player, camera? } }. */
export const seatsOf = (scene) => scene?.traits?.[SEATS] ?? {};

/** The seat this viewer sits in: the first whose `player` is them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  for (const [id, s] of Object.entries(seats ?? {})) if (s?.player === viewer) return id;
  return null;
}

/**
 * The roster of a snapshot: every seat, in seat order, as { id, name,
 * viewer } (viewer null: free). Pure in the snapshot.
 */
export function rosterOf(scene) {
  return Object.entries(seatsOf(scene)).map(([id, s]) => ({ id, name: s?.name || id, viewer: typeof s?.player === "string" && s.player ? s.player : null }));
}

/**
 * Where a seat stands for a viewer, from the seat (the doc's) and its live
 * claim (api.claimedBy, null when none is live):
 * - "mine": this view holds it, or the doc seats this viewer and nobody's
 *   claim is live (a reload, before it claims it again);
 * - "mine-elsewhere": this viewer, from another view (a second tab);
 * - "taken": someone else, here now;
 * - "away": the doc seats someone else, and they're not here;
 * - "free".
 */
export function seatState(seat, by, viewer) {
  if (by) {
    if (by.mine) return "mine";
    return by.viewer != null && by.viewer === viewer ? "mine-elsewhere" : "taken";
  }
  const p = seat?.player;
  if (!p) return "free";
  return p === viewer ? "mine" : "away";
}

/**
 * Where a seat's name tag goes on one of its places, in the place's frame:
 * on its floor, at the edge nearest the seat's eye (`eye`, in the same
 * frame), else its middle. Pure.
 * @param {{ min: number[], max: number[] }} z  @param {number[] | null} eye
 */
export function seatTagAt(z, eye) {
  const mid = [(z.min[0] + z.max[0]) / 2, z.min[1], (z.min[2] + z.max[2]) / 2];
  if (!eye) return mid;
  const clamp = (v, k) => Math.min(z.max[k], Math.max(z.min[k], v));
  return [clamp(eye[0], 0), z.min[1], clamp(eye[2], 2)];
}

/** The well-formed places among what `seatPlaces` contributions said: [{ seat, id, min, max }]. */
export function cleanPlaces(list, objects) {
  const out = [];
  for (const p of list ?? []) {
    if (!p || typeof p.seat !== "string" || typeof p.id !== "string" || !objects?.[p.id] || !Array.isArray(p.min) || !Array.isArray(p.max)) continue;
    out.push({ seat: p.seat, id: p.id, min: p.min.map(Number), max: p.max.map(Number) });
  }
  return out;
}

/**
 * Write seats into a scene doc (in a change, or onto a plain doc being
 * made): `seats` is { [seatId]: { name, camera? } }, each written empty
 * (player: null). Only where the scene has none: the seats map is made once
 * (STAGE.md, "Shared maps"). Where it has some, a seat there whose view is
 * in a frame that's gone (the table it looked at, deleted) takes the new
 * view for it. Returns whether the scene's seats are these now.
 * @param {object} d  the scene doc (a draft)
 * @param {{ [seatId]: { name?: string, camera?: object } }} seats
 */
export function lay(d, seats) {
  const fresh = {};
  for (const [sid, s] of Object.entries(seats ?? {})) fresh[sid] = { name: s?.name || sid, player: null, ...(s?.camera ? { camera: JSON.parse(JSON.stringify(s.camera)) } : {}) };
  if (!d.traits) d.traits = {};
  if (!d.traits[SEATS]) {
    if (!Object.keys(fresh).length) return false;
    d.traits[SEATS] = fresh;
    return true;
  }
  for (const [sid, s] of Object.entries(d.traits[SEATS])) {
    const frame = s?.camera?.in;
    if (frame && !d.objects?.[frame] && fresh[sid]?.camera) s.camera = fresh[sid].camera;
  }
  return false;
}

// ─── a seat as a station ────────────────────────────────────────────────────
//
// What the use prompt (scene.use) offers when you look at a seat's place
// from within reach, in first person ("Sit as Player 1", F), and, sitting
// there with something to walk in, "Stand up" (F).
//
// A seat's place is its places (a hand tray, a little beyond its edges) and,
// for a seat with a camera, its bench: the floor under where its player's
// eye is (the seat camera's position, in its frame `in` as drawn), within
// BENCH_RADIUS of it across that frame, and from BENCH_DROP below it to a
// little above. A look counts there when what it lands on is a place's own
// object, something locked (the table, the board), or the thing a seat's
// camera is given in or one it's attached to (the table, the ship whose
// bench it is): never a loose piece, so F over a card is still the hand's.

/** How far from the eye a seat's place can be sat at (m). */
export const SEAT_REACH = 2;
/** How far past a place's edges a look still counts as at it (m). */
export const PLACE_MARGIN = 0.08;
/** A bench's reach across its frame from under the seat's eye (m), and how far below the eye it goes. */
export const BENCH_RADIUS = 0.5;
export const BENCH_DROP = 1.5;
/** How long an away seat waits for the second F (ms). */
export const CONFIRM_MS = 5000;

/**
 * The seat a look is at, or null.
 * @param {{ snap: object, target: string, point: number[] | null, from: number[] | null, seats: object, places: object[], drawn: (id: string) => number[] | null }} o
 *   snap: api.scene(); target: what the prompt asks about; point: where the
 *   look landed (world, may be null when hovering); from: the eye (world);
 *   places: cleanPlaces(…); drawn: an object's world matrix as drawn
 *   (api.worldOf), null if it's gone
 */
export function seatLookedAt({ snap, target, point, from, seats, places, drawn }) {
  if (!Array.isArray(from) || target == null || !snap?.objects?.[target]) return null;
  const regions = (places ?? []).filter((z) => seats?.[z.seat]);
  const near = (p) => Array.isArray(p) && Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) <= SEAT_REACH;
  // a place's own object: its seat, wherever on it the look landed (its middle, hovering without a point)
  const tray = regions.find((z) => z.id === target);
  if (tray) {
    const m = drawn(tray.id);
    const mid = m ? applyMatrix(m, [(tray.min[0] + tray.max[0]) / 2, tray.min[1], (tray.min[2] + tray.max[2]) / 2]) : null;
    return near(Array.isArray(point) ? point : mid) ? tray.seat : null;
  }
  if (!Array.isArray(point) || !near(point) || !placeLike(snap, target, seats)) return null;
  for (const z of regions) {
    const m = drawn(z.id);
    const inv = m ? invertMatrix(m) : null;
    if (!inv) continue;
    const p = applyMatrix(inv, point);
    const M = PLACE_MARGIN;
    if (p[0] >= z.min[0] - M && p[0] <= z.max[0] + M && p[2] >= z.min[2] - M && p[2] <= z.max[2] + M && p[1] >= z.min[1] - 0.05 && p[1] <= z.max[1] + 0.3) return z.seat;
  }
  for (const [sid, s] of Object.entries(seats ?? {})) {
    const cam = s?.camera;
    if (!Array.isArray(cam?.position)) continue;
    const m = cam.in ? drawn(cam.in) : null;
    if (cam.in && !m) continue;
    const inv = m ? invertMatrix(m) : null;
    if (m && !inv) continue;
    const p = inv ? applyMatrix(inv, point) : point;
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
 * (seatState), or null:
 * - in first person (`immersive`): a seat whose player is here is refused
 *   ("Ana is sitting there", greyed out); one whose player has gone asks
 *   first (`confirm`: F once says what you'd take over, F again within
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
          ? { verb: "sit", label: `Take ${name}: F again`, title: "You'll see what's theirs" }
          : { verb: "confirm", label: `Sit as ${name} (${who || "its player"} is away)`, title: "Their seat can be taken: F, then F again. You'll see what's theirs" };
      case "mine":
        return { verb: "sit", label: "Back to your seat", title: `Sit down as ${name} again (F)` };
      case "mine-elsewhere":
      case "free":
        return { verb: "sit", label: `Sit as ${name}`, title: `Sit down as ${name} (F)` };
    }
    return null;
  }
  if (state === "mine" && canStand) return { verb: "stand", label: "Stand up", title: `Get up from ${name} and walk; the seat stays yours (F at it sits you back down)` };
  return null;
}
