// Seats: the places people take at a scene (scene trait "seats"), and the
// pure side of the part that owns them (seats.js). A seat is
// { name, player: <viewer> | null, camera?: { position, target, in? } };
// `in` is an object id, the frame the camera is given in (a table aboard a
// ship); absent, the world.
//
// Nothing outside this package reads or writes the trait. Others meet seats
// through two conventions (README.md):
//   - `roster`, contributed here: who sits where, for whoever needs to know
//     (a table's hands, a keeper's players);
//   - `seatPlaces`, contributed by whoever gives a seat somewhere to be (a
//     hand tray): where its name tag goes, and what a look at it means.
// Sitting is a body (body.js), the stage's: sitting down from walking pushes
// it over the walk body, standing up pops it (scene/TOOLS.md §4).
// And setup code writes seats with this module's `lay(d, seats)`, found by
// the plugin's `roster: true` in the scene:extension registry.

import { applyMatrix, invertMatrix } from "./transform.js";

export const SEATS = "seats";

/** A seat's claim kind, on the scene (scene/STAGE.md, "Claims"). */
export const SEAT_CLAIM = (sid) => `seat:${sid}`;

/** The scene's seats: { [seatId]: { name, player, camera? } }. */
export const seatsOf = (scene) => scene?.traits?.[SEATS] ?? {};

/** The seat this viewer sits in: the first whose `player` is them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  for (const [id, s] of Object.entries(seats ?? {})) if (s?.player === viewer) return id;
  return null;
}

/**
 * Where arriving puts a viewer when the doc starts people seated with no
 * seat named (view.start = { body: "seat" }: TOOLS.md §2): their own seat if
 * the doc seats them (back at the table), else the first seat in seat order
 * that has a view, watching from it (nothing written: sitting down is the
 * picker's and the seat's verb). Null: no seat with a view. Pure.
 * @returns {{ sid: string, mine: boolean } | null}
 */
export function arrivalSeat(seats, viewer) {
  const mine = seatOf(seats, viewer);
  if (mine && seats[mine]?.camera) return { sid: mine, mine: true };
  const first = Object.entries(seats ?? {}).find(([, s]) => s?.camera)?.[0] ?? null;
  return first ? { sid: first, mine: false } : null;
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
 * The frame a seat is in: the object its camera is given in (`camera.in`,
 * the table it looks at) while that object is in the scene; else null, the
 * world (no camera, a camera in the world, or a frame that's gone). Pure.
 */
export function seatFrame(seat, objects) {
  const f = seat?.camera?.in;
  return typeof f === "string" && objects?.[f] ? f : null;
}

/**
 * The seats around some objects (a deck's cards, a card someone would
 * draw): for each object, the seats in the nearest frame up its chain of
 * parents (the object itself first) that is some seat's frame, the world's
 * last. With one table in a scene that is every seat; with several, each
 * table's own (its seats' views are given in it). Pure in the snapshot.
 * @param {{ objects: object, traits?: object, parents?: Map<string, string | null> }} snap
 * @param {Iterable<string>} ids
 * @returns {string[]} seat ids, in seat order
 */
export function seatsAround(snap, ids) {
  const seats = seatsOf(snap);
  const objects = snap?.objects ?? {};
  const frameOf = Object.entries(seats).map(([sid, s]) => [sid, seatFrame(s, objects)]);
  const frames = new Set(frameOf.map(([, f]) => f));
  const parent = (id) => (snap?.parents?.get?.(id) ?? (objects[objects[id]?.parent] ? objects[id].parent : null)) || null;
  const found = new Set();
  for (const id of ids ?? []) {
    if (!objects[id]) continue;
    const seen = new Set();
    let at = null;
    for (let x = id; x != null && objects[x] && !seen.has(x); x = parent(x)) {
      seen.add(x);
      if (frames.has(x)) {
        at = x;
        break;
      }
    }
    if (at != null) found.add(at);
    else if (frames.has(null)) found.add(null);
  }
  return frameOf.filter(([, f]) => found.has(f)).map(([sid]) => sid);
}

/**
 * The picker's groups when the seats are at more than one table (more than
 * one frame, seatFrame): [{ label, seats: [id] }] in seat order of each
 * group's first seat, labelled by `nameOf(frame)` (the table's name; the
 * world's "Here"), a name two tables share told apart by " 2", " 3", …; null
 * when they're all at one (the picker is a plain list). Pure.
 * @param {object} seats  @param {object} objects  @param {(frame: string) => string | null} nameOf
 * @returns {{ label: string, seats: string[] }[] | null}
 */
export function pickerGroups(seats, objects, nameOf) {
  const byFrame = new Map();
  for (const [sid, s] of Object.entries(seats ?? {})) {
    const f = seatFrame(s, objects);
    if (!byFrame.has(f)) byFrame.set(f, []);
    byFrame.get(f).push(sid);
  }
  if (byFrame.size < 2) return null;
  const count = new Map();
  return [...byFrame].map(([f, ids]) => {
    const base = (f == null ? null : nameOf(f)) || (f == null ? "Here" : "A table");
    const n = (count.get(base) ?? 0) + 1;
    count.set(base, n);
    return { label: n === 1 ? base : `${base} ${n}`, seats: ids };
  });
}

/**
 * Write seats into a scene doc (in a change, or onto a plain doc being
 * made): `seats` is { [seatId]: { name, camera? } }, each written empty
 * (player: null). The seats map is made once (scene/STAGE.md, "Shared
 * maps"); a scene that has one gets these added to it, so a second table
 * brings its own seats:
 * - a seat whose id is free is written under it;
 * - a seat there under that id whose view is in a frame that's gone (the
 *   table it looked at, deleted) takes the new view, and keeps its player;
 * - a seat there under that id that's still somewhere (its frame is
 *   there, or it has none) is left as it is, and the new one is written
 *   under the first free `<id>-2`, `<id>-3`, …
 * Returns where each went: { [given id]: id written }, so whoever laid them
 * can name them (a table's hands); {} when there were none to write.
 * @param {object} d  the scene doc (a draft)
 * @param {{ [seatId]: { name?: string, camera?: object } }} seats
 * @returns {{ [seatId]: string }}
 */
export function lay(d, seats) {
  const fresh = {};
  for (const [sid, s] of Object.entries(seats ?? {})) fresh[sid] = { name: s?.name || sid, player: null, ...(s?.camera ? { camera: JSON.parse(JSON.stringify(s.camera)) } : {}) };
  if (!Object.keys(fresh).length) return {};
  if (!d.traits) d.traits = {};
  if (!d.traits[SEATS]) {
    d.traits[SEATS] = fresh;
    return Object.fromEntries(Object.keys(fresh).map((sid) => [sid, sid]));
  }
  const map = d.traits[SEATS];
  const ids = seatIds(Object.keys(fresh), Object.fromEntries(Object.entries(map).map(([sid, s]) => [sid, !!s?.camera?.in && !d.objects?.[s.camera.in]])));
  for (const [sid, to] of Object.entries(ids)) {
    if (!map[to]) map[to] = fresh[sid];
    else if (fresh[sid].camera) map[to].camera = fresh[sid].camera;
  }
  return ids;
}

/**
 * Where each of `wanted` goes among the seats there (`there`: { [id]:
 * whether its frame is gone }): its own id when that's free or its seat's
 * frame is gone (and no other of `wanted` has it), else the first
 * `<id>-<n>` (n = 2, 3, …) that is neither there nor given to another.
 * Pure.
 * @param {string[]} wanted  @param {{ [id: string]: boolean }} there
 * @returns {{ [id: string]: string }}
 */
export function seatIds(wanted, there) {
  const used = new Set();
  const out = {};
  for (const sid of wanted) {
    let to = sid;
    if ((Object.hasOwn(there, sid) && !there[sid]) || used.has(sid)) {
      for (let n = 2; ; n++) {
        to = `${sid}-${n}`;
        if (!Object.hasOwn(there, to) && !used.has(to)) break;
      }
    }
    used.add(to);
    out[sid] = to;
  }
  return out;
}

// ─── a seat as a station ────────────────────────────────────────────────────
//
// What the use prompt (scene.use) offers when you look at a seat's place
// while walking ("Sit as Player 1", F), and, sitting there, "Stand up" (F).
// Reach is the stage's (the command says `reach: true`, measured from the
// body's eye against its reach).
//
// A seat's place is its places (a hand tray, a little beyond its edges) and,
// for a seat with a camera, its bench: the floor under where its player's
// eye is (the seat camera's position, in its frame `in` as drawn), within
// BENCH_RADIUS of it across that frame, and from BENCH_DROP below it to a
// little above. A look counts there when what it lands on is a place's own
// object, something locked (the table, the board), or the thing a seat's
// camera is given in or one it's attached to (the table, the ship whose
// bench it is): never a loose piece, so F over a card is still the hand's.

/** How far past a place's edges a look still counts as at it (m). */
export const PLACE_MARGIN = 0.08;
/** A bench's reach across its frame from under the seat's eye (m), and how far below the eye it goes. */
export const BENCH_RADIUS = 0.5;
export const BENCH_DROP = 1.5;
/** How long an away seat waits for the second F (ms). */
export const CONFIRM_MS = 5000;

/**
 * The seat a look is at, or null.
 * @param {{ snap: object, target: string, point: number[] | null, seats: object, places: object[], drawn: (id: string) => number[] | null }} o
 *   snap: api.scene(); target: what the prompt asks about; point: where the
 *   look landed (world, may be null when hovering); places: cleanPlaces(…);
 *   drawn: an object's world matrix as drawn (api.worldOf), null if it's gone
 */
export function seatLookedAt({ snap, target, point, seats, places, drawn }) {
  if (target == null || !snap?.objects?.[target]) return null;
  const regions = (places ?? []).filter((z) => seats?.[z.seat]);
  // a place's own object: its seat, wherever on it the look landed (its middle, hovering without a point)
  const tray = regions.find((z) => z.id === target);
  if (tray) return tray.seat;
  if (!Array.isArray(point) || !placeLike(snap, target, seats)) return null;
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
 * (seatState), and the body they're in, or null:
 * - walking (a body that isn't orbit or the seat): a seat whose player is
 *   here is refused ("Ana is sitting there", greyed out); one whose player
 *   has gone asks first (`confirm`: F once says what you'd take over, F
 *   again within CONFIRM_MS takes it); your own is "Back to your seat"; any
 *   other is "Sit as <name>";
 * - seated, in your own seat: "Stand up" (the seat body pops; whatever you
 *   sat down from carries on). The picker is the way to sit anywhere else.
 * Pure.
 * @param {{ name: string, state: string, who?: string | null, walking: boolean, seated: boolean, confirming: boolean }} o
 * @returns {{ verb: "sit" | "confirm" | "stand", label: string, title?: string, disabled?: boolean } | null}
 */
export function seatVerb({ name, state, who = null, walking, seated, confirming }) {
  if (walking) {
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
  if (state === "mine" && seated) return { verb: "stand", label: "Stand up", title: `Get up from ${name}; the seat stays yours` };
  return null;
}
