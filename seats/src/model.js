// Seats: the places people take at a scene (trait "seats"), and the pure
// side of the part that owns them (seats.js). A seat is
// { name, player: <viewer> | null, lasting?: false, camera?: { position, target, in? } };
// `in` is an object id, the frame the camera is given in (a table aboard a
// ship); absent, the world.
//
// Seats have an owner. The doc's own seats (the trait on the scene) are its
// table's: a game is a doc of its own. An object's seats (the trait on the
// object: a machine's ports) are that object's, and go where it goes: they
// are copied with it and removed with it. A seat is named by where it is,
// { of, seat }: `of` the object whose seats it is among, null for the doc's.
//
// A seat lasts unless it says `lasting: false`. A lasting seat keeps who sat
// there (`player`, written in the doc) when they get up or go, so a card
// table keeps your hand for you. A seat that doesn't last is held only by the
// claim of the view sitting in it: nothing is written, and getting up,
// sitting elsewhere or leaving frees it (a machine's port).
//
// Nothing outside this package reads or writes the trait. Others meet seats
// through two conventions (README.md):
//   - `roster`, contributed here: who sits where, for whoever needs to know
//     (a table's hands, a keeper's players);
//   - `seatPlaces`, contributed by whoever gives a seat somewhere to be (a
//     hand tray): where its name tag goes, and what a look at it means.
// Sitting is a body (body.js), the stage's: sitting down from walking pushes
// it over the walk body, standing up pops it (scene/STAGE.md, "Bodies").
// And setup code writes seats with this module's `lay(d, seats)`, found by
// the plugin's `roster: true` in the scene:extension registry.

import { applyMatrix, invertMatrix } from "./transform.js";

export const SEATS = "seats";

/** A seat's claim kind, on the scene (scene/STAGE.md, "Claims"). */
export const SEAT_CLAIM = (sid) => `seat:${sid}`;

/** One owner's seats, { [seatId]: { name, player, lasting?, camera? } }: object `of`'s, or (null) the doc's own. */
export const seatsOf = (scene, of = null) => (of == null ? scene?.traits?.[SEATS] : scene?.objects?.[of]?.traits?.[SEATS]) ?? {};

/** The seat at `ref` ({ of, seat }), or null. */
export const seatAt = (scene, ref) => (ref ? (seatsOf(scene, ref.of ?? null)[ref.seat] ?? null) : null);

/** Do two refs name one seat? */
export const sameSeat = (a, b) => !!a && !!b && a.seat === b.seat && (a.of ?? null) === (b.of ?? null);

/** A seat as a body's place, or a message names it: a seat id (the doc's) or { of, seat }; null if neither. */
export function refOf(place) {
  if (typeof place === "string" && place) return { of: null, seat: place };
  if (place && typeof place === "object" && typeof place.seat === "string" && place.seat && (place.of == null || typeof place.of === "string")) return { of: place.of ?? null, seat: place.seat };
  return null;
}

/** Does the seat keep who sat there (a table's), or is it held only while someone sits in it? */
export const lasting = (seat) => seat?.lasting !== false;

/** Every seat in a snapshot (or a draft): the doc's own, then each object's in object order, as [{ of, seat, s }]. */
export function allSeats(scene) {
  const out = Object.entries(seatsOf(scene)).map(([seat, s]) => ({ of: null, seat, s }));
  for (const id of Object.keys(scene?.objects ?? {})) for (const [seat, s] of Object.entries(seatsOf(scene, id))) out.push({ of: id, seat, s });
  return out;
}

/** The seat this viewer sits in among one owner's: the first lasting one whose `player` is them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  for (const [id, s] of Object.entries(seats ?? {})) if (lasting(s) && s?.player === viewer) return id;
  return null;
}

/** The lasting seat this viewer sits in anywhere in the doc ({ of, seat }), or null. A viewer keeps one in a doc. */
export function mySeat(scene, viewer) {
  if (!viewer) return null;
  const x = allSeats(scene).find(({ s }) => lasting(s) && s?.player === viewer);
  return x ? { of: x.of, seat: x.seat } : null;
}

/**
 * Where arriving puts a viewer when the doc starts people seated with no
 * seat named (view.start = { body: "seat" }: STAGE.md, "Arriving"): their own seat if
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
 * The roster of a snapshot: the doc's own seats (its table's), in seat
 * order, as { id, name, viewer } (viewer null: free, or a seat that doesn't
 * last, whose sitter the doc never says). An object's seats are never the
 * table's. Pure in the snapshot.
 */
export function rosterOf(scene) {
  return Object.entries(seatsOf(scene)).map(([id, s]) => ({ id, name: s?.name || id, viewer: lasting(s) && typeof s?.player === "string" && s.player ? s.player : null }));
}

/**
 * Where a seat stands for a viewer, from the seat (the doc's) and its live
 * claim (api.claimedBy, null when none is live):
 * - "mine": this view holds it, or the doc seats this viewer and nobody's
 *   claim is live (a reload, before it claims it again);
 * - "mine-elsewhere": this viewer, from another view (a second tab);
 * - "taken": someone else, here now (or, for a seat that doesn't last, any
 *   other view, your own other tab too: it's the view sitting there's);
 * - "away": the doc seats someone else, and they're not here (a lasting
 *   seat only);
 * - "free".
 */
export function seatState(seat, by, viewer) {
  if (by) {
    if (by.mine) return "mine";
    return lasting(seat) && by.viewer != null && by.viewer === viewer ? "mine-elsewhere" : "taken";
  }
  const p = lasting(seat) ? seat?.player : null;
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

/** The well-formed places among what `seatPlaces` contributions said: [{ seat, of, id, min, max }] (`of`: whose seat, null the doc's). */
export function cleanPlaces(list, objects) {
  const out = [];
  for (const p of list ?? []) {
    if (!p || typeof p.seat !== "string" || typeof p.id !== "string" || !objects?.[p.id] || !Array.isArray(p.min) || !Array.isArray(p.max)) continue;
    if (p.of != null && (typeof p.of !== "string" || !objects[p.of])) continue;
    out.push({ seat: p.seat, of: p.of ?? null, id: p.id, min: p.min.map(Number), max: p.max.map(Number) });
  }
  return out;
}

/**
 * Write seats (in a change, or onto a plain doc being made): `seats` is
 * { [seatId]: { name, lasting?, camera? } }, laid as the doc's own (`of`
 * null: a game is a doc of its own, so its seats are its doc's) or as
 * object `of`'s, on that object (a machine's ports: they go where it goes).
 * The seats map is made once (scene/STAGE.md, "Shared maps"), each seat
 * written empty (player: null), and a seat already there under that id
 * keeps its player and takes the new name, view and lasting. A seat's
 * camera is in its doc's root frame (a doc linked onto a moving table rides
 * it (body.js), or one whose camera is `in` an object of its own doc rides
 * that.
 * @param {object} d  the scene doc (a draft)
 * @param {{ [seatId]: { name?: string, lasting?: boolean, camera?: object } }} seats
 * @param {string | null} [of]  the object whose seats these are; nothing is laid if it isn't there
 */
export function lay(d, seats, of = null) {
  const entries = Object.entries(seats ?? {});
  if (!entries.length) return;
  const holder = of == null ? d : d.objects?.[of];
  if (!holder) return;
  if (!holder.traits) holder.traits = {};
  if (!holder.traits[SEATS]) holder.traits[SEATS] = {};
  const map = holder.traits[SEATS];
  for (const [sid, s] of entries) {
    const name = s?.name || sid;
    const camera = s?.camera ? JSON.parse(JSON.stringify(s.camera)) : null;
    const brief = s?.lasting === false;
    if (!map[sid]) map[sid] = { name, player: null, ...(brief ? { lasting: false } : {}), ...(camera ? { camera } : {}) };
    else {
      map[sid].name = name;
      if (camera) map[sid].camera = camera;
      if (brief && map[sid].lasting !== false) map[sid].lasting = false;
      else if (!brief && "lasting" in map[sid]) delete map[sid].lasting;
    }
  }
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
 * The seat a look is at ({ of, seat }), or null.
 * @param {{ snap: object, target: string, point: number[] | null, places: object[], drawn: (id: string) => number[] | null, mine?: { of: string | null, seat: string } | null }} o
 *   snap: api.scene() (every owner's seats are read from it); target: what
 *   the prompt asks about; point: where the look landed (world, may be null
 *   when hovering); places: cleanPlaces(…); drawn: an object's world matrix
 *   as drawn (api.worldOf), null if it's gone; mine: the seat this view sits
 *   in, if any
 */
export function seatLookedAt({ snap, target, point, places, drawn, mine = null }) {
  if (target == null || !snap?.objects?.[target]) return null;
  const regions = (places ?? []).filter((z) => seatAt(snap, z));
  // a place's own object: its seat, wherever on it the look landed (its middle, hovering without a point)
  const trays = regions.filter((z) => z.id === target);
  if (trays.length) return placeOn(trays, Array.isArray(point) ? drawn(target) : null, point, mine);
  const seats = allSeats(snap);
  if (!Array.isArray(point) || !placeLike(snap, target, seats)) return null;
  for (const z of regions) {
    const m = drawn(z.id);
    const inv = m ? invertMatrix(m) : null;
    if (!inv) continue;
    const p = applyMatrix(inv, point);
    const M = PLACE_MARGIN;
    if (p[0] >= z.min[0] - M && p[0] <= z.max[0] + M && p[2] >= z.min[2] - M && p[2] <= z.max[2] + M && p[1] >= z.min[1] - 0.05 && p[1] <= z.max[1] + 0.3) return { of: z.of ?? null, seat: z.seat };
  }
  for (const { of, seat, s } of seats) {
    const cam = s?.camera;
    if (!Array.isArray(cam?.position)) continue;
    const m = cam.in ? drawn(cam.in) : null;
    if (cam.in && !m) continue;
    const inv = m ? invertMatrix(m) : null;
    if (m && !inv) continue;
    const p = inv ? applyMatrix(inv, point) : point;
    const e = cam.position.map(Number);
    if (Math.hypot(p[0] - e[0], p[2] - e[2]) <= BENCH_RADIUS && p[1] <= e[1] + 0.2 && p[1] >= e[1] - BENCH_DROP) return { of, seat };
  }
  return null;
}

/**
 * Of several places on one object (a machine's ports along its front), the
 * seat a look at that object is at ({ of, seat }): the place the point is
 * in; else your own among them (`mine`, a ref), if you sit at one (seated,
 * you look at the middle of what you're at); else the one nearest the
 * point; else the first. One place is simply its seat. Distances are in the
 * object's frame (`m`, as drawn), to each box; ties go to the earlier place.
 * Pure.
 */
export function placeOn(trays, m, point, mine = null) {
  const ref = (z) => ({ of: z.of ?? null, seat: z.seat });
  if (trays.length === 1) return ref(trays[0]);
  const own = trays.find((z) => sameSeat(ref(z), mine)) ?? null;
  const inv = m && Array.isArray(point) ? invertMatrix(m) : null;
  if (!inv) return ref(own ?? trays[0]);
  const p = applyMatrix(inv, point);
  const gap = (z) => Math.hypot(...[0, 1, 2].map((k) => Math.max(z.min[k] - p[k], 0, p[k] - z.max[k])));
  const inside = trays.find((z) => gap(z) === 0);
  if (inside) return ref(inside);
  if (own) return ref(own);
  let best = trays[0];
  for (const z of trays) if (gap(z) < gap(best)) best = z;
  return ref(best);
}

/** Can a look at `target` be a look at a seat's place: something locked, or a seat camera's frame or what that's attached to? */
function placeLike(snap, target, seats) {
  if (snap.objects[target]?.locked) return true;
  const parent = (id) => snap.parents?.get?.(id) ?? (snap.objects?.[snap.objects?.[id]?.parent] ? snap.objects[id].parent : null);
  for (const { s } of seats) {
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
 * - walking (a body over the stage's Look that isn't the seat): a seat whose player is
 *   here is refused ("Ana is sitting there", greyed out); one whose player
 *   has gone asks first (`confirm`: F once says what you'd take over, F
 *   again within CONFIRM_MS takes it); your own is "Back to your seat"; any
 *   other is "Sit as <name>";
 * - seated, in your own seat: "Stand up" (the seat body pops; whatever you
 *   sat down from carries on; a lasting seat stays yours, one that doesn't
 *   last is free again). The picker is the way to sit anywhere else.
 * Pure.
 * @param {{ name: string, state: string, who?: string | null, walking: boolean, seated: boolean, confirming: boolean, lasting?: boolean }} o
 * @returns {{ verb: "sit" | "confirm" | "stand", label: string, title?: string, disabled?: boolean } | null}
 */
export function seatVerb({ name, state, who = null, walking, seated, confirming, lasting = true }) {
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
  if (state === "mine" && seated) return { verb: "stand", label: "Stand up", title: lasting ? `Get up from ${name}; the seat stays yours` : `Get up from ${name}` };
  return null;
}
