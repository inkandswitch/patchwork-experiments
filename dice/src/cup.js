// Dice cups, as the scene doc has them: which dice a cup covers, who may see
// what's under it, where a cup goes when it's lifted, knocked over or stood
// up again, and how dice lie under it. Pure: the doc alone (a snapshot), so
// every peer answers alike and nothing flickers while something moves.
//
// A cup is an object with the trait
//
//   "dice.cup": { holder: <viewer> | null,   // who shook it last: whose dice are under it
//                 up: boolean,               // lifted: set down behind its dice, mouth down, covering nothing
//                 blind: boolean,            // shaken blind: what's under it is the others' to see, never the holder's
//                 roll: null | { draw, dice: [id…], blind, done },   // the last shake: its lots draw, its dice in order,
//                                                                     // whether it was shaken blind, and whether they've been turned up
//                 round: lots.js round }      // the shake's draw (lots-ext.js), of its dice
//
// Its GLB stands on its mouth at the origin, closed at the top, 9 cm tall
// (cup-glb.js). Down, it covers every die whose origin lies within COVER of
// its own, across its parent's frame, at about its height. Lifted, it is
// set down LIFT_BACK along its own +X, beside its dice (a table lays a cup
// out with its +Z toward its player, so that is to the player's right, out
// of the way of their view), and the place it covered when down is its
// SPOT: the dice beside it, which a shake takes.
//
// WHO MAY SEE (the stage's audience policy, `policy`), for a cup and every
// die it covers, and every die of its last shake not yet turned up:
//
//   down, shaken in the open by H     { show: [H], only: [H] }      H may look; nobody else
//   down, blind, or nobody's          { show: [],  only: [] }       nobody
//   not covering, shaken blind by H   { show: "all", only: seated − H }   face up to the table, kept from H (and from spectators)
//   not covering                      { show: "all" }               everyone
//
// "Not covering" is lifted, knocked over (not upright), or carried off its
// dice: physical, from the doc. A die nobody shook (on the table, in the
// pool) gets no answer here: it is what the doc says it is.

import { eulerMatrix } from "./m3.js";

export const CUP = "dice.cup";
const DIE = "dice.die";

/** The cup's size (m): 9 cm tall, its mouth 8.6 cm across outside, 8 cm inside. */
export const CUP_HEIGHT = 0.09;
export const CUP_MOUTH = 0.043;
export const CUP_TOP = 0.036;
export const CUP_WALL = 0.003;
/** How far from a down cup's middle a die's origin may lie and be under it (m): inside its wall. */
export const COVER = 0.038;
/** How far aside a lifted cup is set from its spot (m). */
export const LIFT_BACK = 0.1;
/** The most dice that lie under one cup without touching (cup.test.js). */
export const MAX_UNDER = 7;
/** A die's corner-to-corner across the table (m): a 16 mm cube's diagonal, and a hair. */
const DIE_REACH = 0.0235;
/** Upright: its +Y within 30° of its parent's. */
const UPRIGHT = Math.cos(Math.PI / 6);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec = (v) => [0, 1, 2].map((i) => num(v?.[i]));
const isViewer = (v) => typeof v === "string" && v.length > 0;

/** A cup's trait, read with its defaults, or null when the object isn't a cup. */
export function cupOf(o) {
  const t = o?.traits?.[CUP];
  if (!o || o.kind === "group" || !t || typeof t !== "object") return null;
  const r = t.roll;
  const roll =
    r && typeof r === "object" && typeof r.draw === "string" && Array.isArray(r.dice)
      ? { draw: r.draw, dice: [...r.dice].filter((x) => typeof x === "string"), blind: r.blind === true, done: r.done === true }
      : null;
  return { holder: isViewer(t.holder) ? t.holder : null, up: t.up === true, blind: t.blind === true, roll };
}

export const isDie = (o) => !!o && o.kind !== "group" && !!o.traits && Object.hasOwn(o.traits, DIE);

const transformOf = (o) => ({ position: vec(o?.transform?.position), rotation: vec(o?.transform?.rotation), scale: num(o?.transform?.scale, 1) || 1 });

/** Its heading about its parent's +Y: where its own +Z points, seen from above. */
export function yawOf(rotation) {
  const m = eulerMatrix(rotation);
  if (Math.hypot(m[0][2], m[2][2]) < 1e-6) return Math.atan2(-m[2][0], m[0][0]);
  return Math.atan2(m[0][2], m[2][2]);
}
/** Is a transform upright in its parent: its +Y within 30° of the parent's? */
export const upright = (t) => eulerMatrix(t.rotation)[1][1] >= UPRIGHT;

/** `d` along a heading's own +X (Ry(yaw) · [d, 0, 0]). */
const aside = (yaw, d) => [Math.cos(yaw) * d, 0, -Math.sin(yaw) * d];
const tidy = (v) => +(+v).toFixed(6) + 0;
const moved = (t, by) => ({ ...t, position: t.position.map((v, i) => tidy(v + by[i])) });

/** Lifted: set down LIFT_BACK aside, along its own +X (`k`: the parent's scale, metres per unit). */
export const lifted = (t, k = 1) => moved(t, aside(yawOf(t.rotation), LIFT_BACK / k));
/** Put down again over its spot. */
export const lowered = (t, k = 1) => moved(t, aside(yawOf(t.rotation), -LIFT_BACK / k));
/** The place a cup covers (down) or covered (lifted), in its parent's frame. */
export const spotOf = (t, up, k = 1) => (up ? lowered(t, k) : t).position;

/**
 * Knocked over: tipped onto its side about the edge of its mouth on its own
 * +X, its top falling that way. Stood up is exactly the way back.
 */
export function knocked(t, k = 1) {
  const yaw = yawOf(t.rotation);
  const r = CUP_MOUTH / k;
  // Ry(yaw) · Rz(−90°), as Euler XYZ
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const m = [
    [0, c, s],
    [-1, 0, 0],
    [0, -s, c],
  ].map((row) => row.map((v) => v + 0));
  const rotation = eulerOf(m);
  const off = [c * r + s * 0, r, -s * r];
  return { ...moved(t, off), rotation: rotation.map(tidy) };
}
export function stoodUp(t, k = 1) {
  const yaw = yawOf(t.rotation);
  const r = CUP_MOUTH / k;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { ...moved(t, [-c * r, -r, s * r]), rotation: [0, tidy(yaw), 0] };
}
function eulerOf(m) {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}

/**
 * Where n dice lie under a cup (in metres from its spot, on the table): one
 * in the middle, else a ring just wide enough that no two touch at any
 * heading. Each faces out of the ring. Null for more than MAX_UNDER.
 * @returns {null | { at: [number, number, number], yaw: number }[]}
 */
export function ringOf(n, yaw0 = 0) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UNDER) return null;
  if (n === 0) return [];
  if (n === 1) return [{ at: [0, 0, 0], yaw: tidy(yaw0) }];
  const r = Math.max(0.0125, DIE_REACH / (2 * Math.sin(Math.PI / n)));
  return Array.from({ length: n }, (_, i) => {
    const a = yaw0 + (2 * Math.PI * i) / n;
    return { at: [tidy(Math.sin(a) * r), 0, tidy(Math.cos(a) * r)], yaw: tidy(a) };
  });
}
/** The half-width a die needs across the table (m), at any heading. */
export const DIE_HALF = DIE_REACH / 2;

/**
 * Every cup in a snapshot, and what it covers. `k(parent)`: a parent's
 * scale (metres per unit), 1 at the root.
 * @returns {{
 *   cups: Map<string, { id, parent, t, k, cup, covering, spot, under: string[], front: string[], pending: string[] }>,
 *   cupOfDie: Map<string, string>,   // a die → the cup that answers for it (covering it, else whose unturned shake it's in)
 *   covered: Set<string>,            // dice under a down cup
 * }}
 */
export function cupsOf(snapshot, k = () => 1) {
  const objects = snapshot?.objects ?? {};
  const ids = Object.keys(objects).sort();
  const parentOf = (id) => {
    const p = objects[id]?.parent;
    return typeof p === "string" && objects[p] ? p : null;
  };
  const dice = ids.filter((id) => isDie(objects[id]));
  const cups = new Map();
  for (const id of ids) {
    const cup = cupOf(objects[id]);
    if (!cup) continue;
    const parent = parentOf(id);
    const t = transformOf(objects[id]);
    const kk = num(k(parent), 1) || 1;
    const covering = !cup.up && upright(t);
    // (a knocked-over cup's spot is where it would stand again)
    const spot = spotOf(upright(t) ? t : stoodUp(t, kk), cup.up, kk);
    const near = (centre, d) => {
      const p = transformOf(objects[d]).position;
      return parentOf(d) === parent && Math.hypot(p[0] - centre[0], p[2] - centre[2]) < COVER / kk && Math.abs(p[1] - centre[1]) < CUP_HEIGHT / kk;
    };
    const under = covering ? dice.filter((d) => near(t.position, d)) : [];
    const front = dice.filter((d) => near(spot, d));
    const pending = cup.roll && !cup.roll.done ? cup.roll.dice.filter((d) => isDie(objects[d])) : [];
    cups.set(id, { id, parent, t, k: kk, cup, covering, spot, under, front, pending });
  }
  const cupOfDie = new Map();
  const covered = new Set();
  for (const c of cups.values()) for (const d of c.under) if (!cupOfDie.has(d)) (cupOfDie.set(d, c.id), covered.add(d));
  for (const c of cups.values()) for (const d of c.pending) if (!cupOfDie.has(d)) cupOfDie.set(d, c.id);
  return { cups, cupOfDie, covered };
}

/** What a cup's policy says, given who is seated (null: nobody knows who is seated). */
export function answerFor(c, seated) {
  const { holder, blind } = c.cup;
  if (c.covering) return !blind && holder ? { show: [holder], only: [holder] } : { show: [], only: [] };
  if (blind && holder) return { show: "all", only: (Array.isArray(seated) ? seated : []).filter((v) => v !== holder) };
  return { show: "all" };
}

/**
 * The stage's `audience` policy for cups: (id) → answer | null.
 * - A die under a down cup: the cup's answer, covering.
 * - A die of a shake not yet turned up that isn't under it (the cup lifted,
 *   knocked over, or carried off it): the cup's answer, not covering.
 * - The cup itself: what it keeps, which is its shake's: covering while
 *   every die of it is under it, else not (one die out means the roll is:
 *   its dice share one seed).
 */
export function policy(snapshot, seated, k) {
  const { cups, cupOfDie, covered } = cupsOf(snapshot, k);
  const open = (c) => ({ ...c, covering: false });
  return (id) => {
    const self = cups.get(id);
    if (self) return answerFor(self.covering && self.pending.every((d) => self.under.includes(d)) ? self : open(self), seated);
    const c = cups.get(cupOfDie.get(id));
    if (!c) return null;
    return answerFor(covered.has(id) ? c : open(c), seated);
  };
}

/** The dice a shake of this cup takes: those in front of it, in the scene's order (then by id). */
export function shaken(c, order = []) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...c.front].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || (a < b ? -1 : 1));
}

/**
 * A shake, as one write: the cup down on its spot (upright again if it was
 * knocked over), and its dice laid in a ring under it, each upright on the
 * table (face 0 up, turned only about +Y: a pose that says nothing of the
 * roll, which nobody's client has drawn yet), at the height the cup stands on.
 * @returns {null | { cup: object, dice: Map<string, object> }}
 */
export function shakePlan(c, dice, scales = new Map()) {
  const ring = ringOf(dice.length, yawOf(c.t.rotation));
  if (!ring) return null;
  const base = upright(c.t) ? c.t : stoodUp(c.t, c.k);
  const cup = c.cup.up ? lowered(base, c.k) : base;
  const floor = cup.position[1];
  const out = new Map();
  dice.forEach((id, i) => {
    const { at, yaw } = ring[i];
    out.set(id, {
      position: [tidy(cup.position[0] + at[0] / c.k), tidy(floor), tidy(cup.position[2] + at[2] / c.k)],
      rotation: [0, yaw, 0],
      scale: num(scales.get(id), 1) || 1,
    });
  });
  return { cup: { ...cup, rotation: [0, tidy(yawOf(cup.rotation)), 0] }, dice: out };
}

/** Is a viewer in an audience ("all", or a list)? */
export const includes = (set, viewer) => set === "all" || (Array.isArray(set) && typeof viewer === "string" && set.includes(viewer));

/**
 * Whose parts of a shake's lots stay sealed (lots-run.js draw): the
 * holder's alone, so its client knows the roll at once and nobody else's
 * can; shaken blind, every seated player's and the holder's, so nobody
 * knows it while the cup is down and, once it's lifted, each releases to
 * the others but the holder (the stage's audience), and the holder never.
 */
export const sealersFor = (holder, blind, seated) => (blind ? [...new Set([holder, ...(Array.isArray(seated) ? seated : [])])].sort() : [holder]);

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Is a lots draw (lots-run.js state(): { draw, by, of, asked, sealers, … })
 * the one this cup's shake asked for? Its draw, asked by its holder, of the
 * shake's dice in their order, sealed as the shake says: the holder's part
 * alone, or (blind) the holder's among others. The doc isn't signed, so a
 * round on a cup can be anybody's: one written over it by someone else (to
 * learn the roll themselves, sealed to them), or the other of two shakes at
 * once, or a shake's dice changed after it was drawn. Its seed is no roll of
 * this cup's.
 */
export function ours(st, cup) {
  const roll = cup?.roll;
  if (!st || !roll || !cup.holder || st.draw !== roll.draw || st.by !== cup.holder || !sameList(st.of, roll.dice)) return false;
  const asked = Array.isArray(st.asked) ? st.asked : [];
  if (!roll.blind) return asked.length === 1 && asked[0] === cup.holder;
  return asked.includes(cup.holder) && asked.length > 1;
}

/**
 * Is its seed this cup's roll: ours, and, shaken blind, drawn with somebody
 * besides the holder keeping a part sealed (else the holder's client holds
 * every part, and it's no blind roll). Unsettled until the contributors
 * are fixed (`sealers` null): ours is all there is to say.
 */
export const fits = (st, cup) => ours(st, cup) && (!cup.roll.blind || !Array.isArray(st.sealers) || st.sealers.some((v) => v !== cup.holder));
