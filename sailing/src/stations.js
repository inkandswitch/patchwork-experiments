// The verbs aboard (DESIGN.md, "Play"): what the use prompt offers when you
// look at the helm, the mainsheet, the mast and sail, the windlass or the
// ladder from within reach, and what its keys do. Commands over the stage's
// contract (STAGE.md, "A command"); held verbs are sessions the prompt keeps
// open while the key is down.
//
// Reach is measured to what you look at: the point the look lands on, when
// it lands on the thing (or something under it), else its origin. So the
// boom over the cockpit is in reach when it's over your head, however far
// its gooseneck is. Looked at from further off (up to FAR), a station still
// answers, greyed, with where to go to work it ("Sail · walk to the cockpit"),
// or, when you're already at one of the sail's stations, which to take
// ("Sail · work it at the wheel or the mainsheet (F)").
//
// The stations you stand at and lock in to (crew.take: an arm over walking,
// at the station's stand spot in her navmesh; F again leaves):
// - the helm: A / D steer; the sheet and the halyard are led aft, so Q / E
//   trim the sheet and hold R raises or lowers the sail from there too;
// - the mainsheet (a traveller aft in the cockpit, by the boom's end): Q / E
//   trim, hold R raises or lowers;
// - the mast (looking at the mast, or at the rig by its gooseneck): the
//   halyard, hold R. Not the sheet: the mast is no place to trim a sail
//   from, unless she has neither a helm nor a mainsheet to trim it at.
// Without locking in: the rig (and its mast) offers a quick hold R, and hold
// Q / E only on a ship with no mainsheet; the mainsheet a quick hold Q / E
// but not R (take it, F, to raise the sail there, as at the wheel); the
// windlass its own.
//
// A station's lasting setting is its trait, written through ctx.sim.commit
// when you let go (and at the helm each time a steering key comes up, so a
// tab that closes leaves the wheel where it was); while you work it, your
// live input goes through ctx.sim.input. Whoever is changing a station's
// value holds its "station" claim, so one person steers (or trims) at a
// time; a claim lost to someone else stops you without writing, and a
// station that's gone stops you too. The sail's claim is held only while a
// key is down, wherever it's worked from: someone at the mast (who holds the
// sail's "halyard" claim) doesn't stop the helmsman trimming. The helmsman
// holds the wheel's pose too, so it turns as their key does, not a round
// trip later.
//
// Looking at the mast (a part of the ship with no traits of its own) works
// the sail it carries: the rig hangs under it, or (a doc made before the
// rig hung from the mast) the rig's gooseneck stands over it.

import { ANCHOR, HALYARD, HELM, MAINSHEET, RODE, SAIL, STATION, isUnder, shipOf, wheelTransform } from "./traits.js";
import { bodyOf } from "./body.js";
import { apply, invert } from "./frames.js";

export { RODE };

/** How far you can reach a station from (eye to the point you look at on it, m). */
export const REACH = 2.5;
/** How far off a station you look at still says where to go to work it (m). */
export const FAR = 12;
/** A traitless object aboard whose origin is this near the sail's gooseneck in plan (her frame, m) is its mast. */
export const MAST_NEAR = 0.6;
export const WHEEL_RATE = 0.6; // of the wheel's travel per second, while A or D is held
export const RAISE_RATE = 1 / 4; // the sail, all the way in 4 s
export const SHEET_RATE = 0.25; // per second
export const WINCH_RATE = RODE / 6; // m/s: a full rode comes up in 6 s
const BREAKOUT = 4; // m of winding to bring up an anchor that's down short

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Is `point` within reach of an eye at `from`? */
export function within(from, point, reach = REACH) {
  if (!Array.isArray(from) || !Array.isArray(point)) return false;
  return dist(from, point) <= reach;
}

/**
 * How far a look is from `target` (m): to where it landed, when it landed on
 * the target or anything under it (its distance, else its point from the
 * eye); else from the eye to the target's origin. Infinity with no eye.
 * Pure.
 * @param {{ scene, from?: number[], hit?: { id, point?, distance? } }} c  the prompt's look
 * @param {string} target
 * @param {number[] | null} origin  the target's origin (world)
 */
export function lookDistance(c, target, origin) {
  const h = c?.hit;
  if (h?.id != null && isUnder(c.scene, h.id, target)) {
    if (Number.isFinite(h.distance)) return h.distance;
    if (Array.isArray(h.point) && Array.isArray(c.from)) return dist(c.from, h.point);
  }
  return Array.isArray(c?.from) && Array.isArray(origin) ? dist(c.from, origin) : Infinity;
}

/** Within this of a station (eye to its origin, m) you're at it, for where-to-go: a cockpit's length. */
export const NEAR = 3.5;

const orList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/**
 * Where to go to work a station of `kind` ("helm", "mainsheet", "sail",
 * "anchor") on a ship with these stations (ctx.sim.stationsOf): the greyed
 * line the prompt shows when it's out of reach. `near` says which of her
 * sail's stations you're already at (within NEAR): then it names the station
 * to take, not a place to walk to (at the wheel, the sail overhead isn't
 * "walk to the cockpit"). Pure.
 * @param {string} kind
 * @param {{ helm?, mainsheet?, sail? }} stations
 * @param {{ helm?: boolean, mainsheet?: boolean, mast?: boolean }} near
 */
export function walkTo(kind, stations = {}, near = {}) {
  switch (kind) {
    case "helm":
      return "Helm · walk to the wheel";
    case "mainsheet":
      return "Mainsheet · walk to the cockpit";
    case "sail": {
      const here = [stations.helm && near.helm && "the wheel", stations.mainsheet && near.mainsheet && "the mainsheet", near.mast && "the mast"].filter(Boolean);
      if (here.length) return `Sail · work it at ${orList(here)} (F)`;
      if (stations.mainsheet) return "Sail · walk to the cockpit";
      if (stations.helm) return "Sail · walk to the wheel, or the mast";
      return "Sail · walk to the mast";
    }
    case "anchor":
      return "Anchor · walk to the windlass";
    default:
      return null;
  }
}

/** Whether the sheet can be trimmed at the mast: only on a ship with neither a helm nor a mainsheet to trim it at. */
export const sheetAtMast = (stations = {}) => !stations.helm && !stations.mainsheet;

/** `v` moved toward `goal` by at most `rate·dt`. */
export function approach(v, goal, rate, dt) {
  const d = goal - v;
  const s = rate * dt;
  return Math.abs(d) <= s ? goal : v + Math.sign(d) * s;
}

/** The wheel turned for `dt` with `dir` held (−1 port, +1 starboard): toward ±1, staying where it's left. */
export const wheelStep = (angle, dir, dt, rate = WHEEL_RATE) => (dir ? approach(angle, Math.sign(dir), rate, dt) : angle);

/**
 * A held verb that moves one number toward a goal while the key is down.
 * Pure but for what it's handed: `input` for each live value, `commit` once
 * at the end (let go or cancelled: wherever it got to), `alive()` false when
 * the station's gone or the claim was lost (then it stops, writing nothing),
 * `done` when it's over either way.
 * @param {{ value: number, goal: number, rate: number, input(v), commit(v), alive?(): boolean, done?() }} o
 * @returns {{ update(dt), end(), cancel(), readonly value: number, readonly open: boolean }}
 */
export function heldTrim({ value, goal, rate, input, commit, alive = () => true, done = () => {} }) {
  let v = value;
  let open = true;
  const close = (write) => {
    if (!open) return;
    open = false;
    if (write) commit(v);
    done();
  };
  return {
    update(dt) {
      if (!open) return;
      if (!alive()) return close(false);
      v = approach(v, goal, rate, dt);
      input(v);
    },
    end: () => close(alive()),
    cancel: () => close(alive()),
    get value() {
      return v;
    },
    get open() {
      return open;
    },
  };
}

/**
 * Winding the anchor up while the key is down: the chain comes in at
 * WINCH_RATE, and an anchor down short still takes a moment to break out.
 * Up, it commits { down: false, rode: 0 } at once; let go before that, the
 * rode where it got to.
 * @param {{ rode: number, input(fields), commit(fields), alive?(): boolean, done?() }} o
 */
export function heldWeigh({ rode, input, commit, alive = () => true, done = () => {} }) {
  const start = Math.max(0, Number(rode) || 0);
  let left = Math.max(start, BREAKOUT); // metres of winding still to do
  let open = true;
  const out = () => Math.max(0, Math.min(start, left));
  const close = (fields) => {
    if (!open) return;
    open = false;
    if (fields) commit(fields);
    done();
  };
  return {
    update(dt) {
      if (!open) return;
      if (!alive()) return close(null);
      left -= WINCH_RATE * dt;
      if (left <= 0) return close({ down: false, rode: 0 });
      input({ rode: out() });
    },
    end: () => close(alive() ? { rode: out() } : null),
    cancel: () => close(alive() ? { rode: out() } : null),
    get open() {
      return open;
    },
  };
}

/**
 * The commands for the use prompt (and Enter to come aboard).
 * @param {object} api
 * @param {{ sea, sim, crew }} ctx
 */
export function stationCommands(api, ctx) {
  const objectOf = (sc, id) => sc?.objects?.[id] ?? null;
  const traitOf = (sc, id, key) => objectOf(sc, id)?.traits?.[key] ?? null;
  const originOf = (id) => {
    const m = api.worldOf(id);
    return m ? [m[12], m[13], m[14]] : null;
  };
  const distanceTo = (c, target) => lookDistance(c, target, originOf(target));
  const reach = (c, target) => distanceTo(c, target) <= REACH;
  const value = (id) => ctx.sim.value(id) ?? {};
  const someoneElse = (id, kind = STATION) => {
    const by = api.claimedBy(id, kind);
    return !!by && !by.mine;
  };
  const exists = (id) => !!api.scene().objects?.[id];
  const stationsOf = (sc, id) => {
    const ship = shipOf(sc, id);
    return ship ? (ctx.sim.stationsOf(ship) ?? {}) : {};
  };
  const me = () => ctx.crew.me() ?? {};

  // Held verbs' claims, counted: haul in and ease out at once share one
  // claim, and it goes when the last of them lets go.
  const claims = new Map(); // id → { release, lost, n }

  /**
   * Take a station's claim for a held verb; null when someone else has it.
   * `lost()` says whether it has gone since.
   */
  function claim(id) {
    let h = claims.get(id);
    if (!h || h.lost) {
      const entry = { release: null, lost: false, n: 0 };
      entry.release = api.claim(id, STATION, { onLost: () => (entry.lost = true) });
      if (!entry.release) return null;
      claims.set(id, (h = entry));
    }
    h.n++;
    let gone = false;
    return {
      lost: () => h.lost,
      release() {
        if (gone) return;
        gone = true;
        if (--h.n > 0) return;
        if (claims.get(id) === h) claims.delete(id);
        ctx.sim.input(id, null); // the lasting value is in the doc now
        h.release();
      },
    };
  }

  /** A held trim of one field of a station, under its claim. */
  function trim(id, field, goal, rate, fallback) {
    const c = claim(id);
    if (!c) return undefined;
    const v = Number(value(id)[field]);
    return heldTrim({
      value: Number.isFinite(v) ? v : fallback,
      goal,
      rate,
      input: (x) => ctx.sim.input(id, { [field]: x }),
      commit: (x) => ctx.sim.commit(id, { [field]: x }),
      alive: () => !c.lost() && exists(id),
      done: () => c.release(),
    });
  }

  // ─── the sail, and what works it ───────────────────────────────────────

  const raised = (id) => {
    const v = Number(value(id).raised);
    return Number.isFinite(v) ? v : 1;
  };
  const pct = (v) => Math.round((Number(v) || 0) * 100);
  /** A held trim of the sheet, toward `goal` (0 in, 1 out). */
  const trimSheet = (id, goal) => trim(id, "sheet", goal, SHEET_RATE, 0.5);
  /** The halyard, held: a raised sail comes down, a lowered one goes up. */
  const hoist = (id) => trim(id, "raised", raised(id) > 0.5 ? 0 : 1, RAISE_RATE, 1);

  /**
   * The sail station a look at `target` works, and whether that look is at
   * its mast: the station itself; or (the mast) a traitless object aboard
   * the same ship that the rig hangs under, or one tagged as her mast, or
   * (a doc made before the rig hung from the mast: both under the hull) one
   * whose origin stands under the rig's gooseneck in plan. Else null:
   * anything else aboard (a table in the cockpit) is no part of the sail.
   */
  function sailOf(sc, target) {
    if (traitOf(sc, target, SAIL)) return { id: target, mast: false };
    const o = objectOf(sc, target);
    if (!o || (o.traits && Object.keys(o.traits).length)) return null;
    const ship = shipOf(sc, target);
    const id = ship && ship !== target ? ctx.sim.stationsOf(ship)?.sail : null;
    if (!id || id === target) return null;
    if (isUnder(sc, id, target)) return { id, mast: true };
    if (Array.isArray(o.tags) && o.tags.includes("sailing.mast")) return { id, mast: true };
    const B = bodyOf(api, ship);
    const a = originOf(target);
    const b = originOf(id);
    if (!B || !a || !b) return null;
    const back = invert(B);
    const [pa, pb] = [apply(back, a), apply(back, b)];
    return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) <= MAST_NEAR ? { id, mast: true } : null;
  }

  /** Is this look at the mast (the mast itself, or the rig within reach of its gooseneck)? Where the halyard is worked. */
  const atMast = (c, s) => s.mast || within(c?.from, originOf(s.id));

  /**
   * The sail's keys at a station you stand at: Q / E trim the sheet (one at
   * a time), hold R raises or lowers the sail. Each held key is a trim under
   * the sail's own claim, taken on the press and let go on the release.
   * @param {string | null} sailId
   * @param {{ sheet: boolean, halyard: boolean }} o  which of them work here
   */
  function sailKeys(sailId, { sheet, halyard }) {
    const open = new Map(); // "sheet" | "raised" → { code, trim }
    const start = (slot, code, make) => {
      if (open.has(slot)) return;
      const t = make();
      if (t) open.set(slot, { code, trim: t });
    };
    return {
      key(ev) {
        if (!sailId) return false;
        const k = String(ev.key).toLowerCase();
        if (sheet && (k === "q" || k === "e")) {
          if (!ev.repeat) start("sheet", ev.code, () => trimSheet(sailId, k === "q" ? 0 : 1));
          return true;
        }
        if (halyard && k === "r") {
          if (!ev.repeat) start("raised", ev.code, () => hoist(sailId));
          return true;
        }
        return false;
      },
      keyup(ev) {
        for (const [slot, h] of open) {
          if (h.code !== ev.code) continue;
          open.delete(slot);
          h.trim.end();
          return true;
        }
        return false;
      },
      tick(dt) {
        for (const [slot, h] of [...open]) {
          h.trim.update(dt);
          if (!h.trim.open) open.delete(slot);
        }
      },
      end() {
        for (const h of open.values()) h.trim.end();
        open.clear();
      },
      /** What the keys do here, and how the sail stands: "Q / E sheet 50% · hold R lower sail". */
      hint() {
        if (!sailId) return "";
        const out = [];
        if (sheet) out.push(`Q / E sheet ${pct(value(sailId).sheet ?? 0.5)}%`);
        if (halyard) out.push(`hold R ${raised(sailId) > 0.5 ? "lower" : "raise"} sail`);
        return out.join(" · ");
      },
    };
  }

  /**
   * Stand at a post that works the sail (the mainsheet, the mast) and lock
   * in: `claimOn`'s `kind` claim says who's there; the sail's keys work
   * under the sail's own claim while they're down; F leaves.
   */
  function takePost(stationId, { claimOn, kind, sailId, sheet, halyard }) {
    let lost = false;
    let leave = null;
    const release = api.claim(claimOn, kind, {
      onLost: () => {
        lost = true;
        leave?.();
      },
    });
    if (!release) return;
    const keys = sailKeys(sailId, { sheet, halyard });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      keys.end();
      release();
    };
    leave = ctx.crew.take(stationId, {
      key(ev) {
        if (keys.key(ev)) return true;
        if (String(ev.key).toLowerCase() !== "f") return false;
        if (!ev.repeat) leave?.();
        return true;
      },
      keyup: (ev) => keys.keyup(ev),
      tick(dt) {
        if (lost || !exists(stationId) || (sailId && !exists(sailId))) return leave?.();
        keys.tick(dt);
      },
      left: close,
      hint: () => [keys.hint(), "F leave", sailId ? `sail ${pct(raised(sailId))}%` : ""].filter(Boolean).join(" · "),
    });
    if (lost) leave?.();
  }

  // ─── the helm ─────────────────────────────────────────────────────────

  function takeHelm(id) {
    let lost = false;
    let leave = null;
    const release = api.claim(id, STATION, {
      onLost: () => {
        lost = true;
        leave?.();
      },
    });
    if (!release) return;
    let angle = Number(value(id).angle) || 0;
    const held = new Set();
    // the sheet and the halyard are led aft: both work from the wheel
    const sailId = stationsOf(api.scene(), id).sail ?? null;
    const keys = sailKeys(sailId, { sheet: true, halyard: true });
    let closed = false;
    const steering = (code) => code === "KeyA" || code === "ArrowLeft" || code === "KeyD" || code === "ArrowRight";
    const showWheel = () => {
      const o = api.scene().objects?.[id];
      if (o) api.pose.hold(id, wheelTransform(o.transform, angle));
    };
    const close = () => {
      if (closed) return;
      closed = true;
      keys.end();
      if (!lost && exists(id)) ctx.sim.commit(id, { angle });
      ctx.sim.input(id, null);
      // the simulator draws it from here (and peers keep this pose until it does)
      api.pose.release(id, { landed: true });
      release();
    };
    ctx.sim.input(id, { angle });
    leave = ctx.crew.take(id, {
      key(ev) {
        if (steering(ev.code)) {
          held.add(ev.code);
          return true;
        }
        if (keys.key(ev)) return true;
        if (String(ev.key).toLowerCase() === "f") {
          if (!ev.repeat) leave?.();
          return true;
        }
        return false;
      },
      keyup(ev) {
        if (keys.keyup(ev)) return true;
        if (!held.delete(ev.code)) return false;
        // let go of the wheel: where it was left is lasting
        if (![...held].some(steering) && !lost && exists(id)) ctx.sim.commit(id, { angle });
        return true;
      },
      tick(dt) {
        if (lost || !exists(id)) return leave?.();
        keys.tick(dt);
        const dir = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
        const next = wheelStep(angle, dir, dt);
        if (next !== angle) {
          angle = next;
          ctx.sim.input(id, { angle });
        }
        showWheel();
      },
      left: close,
      hint: () => {
        const wheel = `wheel ${angle > 0.02 ? "▶" : angle < -0.02 ? "◀" : "•"} ${Math.round(Math.abs(angle) * 100)}%`;
        const sail = keys.hint();
        return `A / D steer${sail ? ` · ${sail}` : ""} · F leave · ${wheel}`;
      },
    });
    if (lost) leave?.();
  }

  const helm = {
    id: "helm",
    name: "Take the helm",
    key: "f",
    show: ["use"],
    state(target, c) {
      if (!traitOf(c?.scene, target, HELM) || !reach(c, target)) return null;
      if (me().station === target) return null;
      return someoneElse(target) ? { disabled: true, label: "Someone's at the helm" } : {};
    },
    run: (target) => takeHelm(target),
  };

  // ─── the mainsheet ────────────────────────────────────────────────────

  const mainsheet = {
    id: "mainsheet",
    name: "Take the mainsheet",
    key: "f",
    show: ["use"],
    state(target, c) {
      if (!traitOf(c?.scene, target, MAINSHEET) || !reach(c, target)) return null;
      if (me().station === target) return null;
      return someoneElse(target) ? { disabled: true, label: "Someone's at the mainsheet" } : {};
    },
    run(target) {
      const sailId = stationsOf(api.scene(), target).sail ?? null;
      takePost(target, { claimOn: target, kind: STATION, sailId, sheet: true, halyard: true });
    },
  };

  // ─── the mast: the halyard ────────────────────────────────────────────

  const halyard = {
    id: "halyard",
    name: "Work the halyard",
    key: "f",
    show: ["use"],
    state(target, c) {
      const s = sailOf(c?.scene, target);
      if (!s || !reach(c, target) || !atMast(c, s)) return null;
      if (me().station === s.id) return null;
      return someoneElse(s.id, HALYARD) ? { disabled: true, label: "Someone's at the mast" } : {};
    },
    run(target) {
      const sc = api.scene();
      const s = sailOf(sc, target);
      if (!s) return;
      takePost(s.id, { claimOn: s.id, kind: HALYARD, sailId: s.id, sheet: sheetAtMast(stationsOf(sc, s.id)), halyard: true });
    },
  };

  // ─── quick verbs on the sail and the mainsheet, held ──────────────────

  const busy = (id) => (someoneElse(id) ? { disabled: true, label: "Someone's at the sheet" } : null);

  const sail = {
    id: "sail",
    name: "Raise sail",
    key: "r",
    show: ["use"],
    hold: true,
    state(target, c) {
      const s = sailOf(c?.scene, target);
      if (!s || !reach(c, target)) return null;
      return busy(s.id) ?? { label: raised(s.id) > 0.5 ? "Lower sail" : "Raise sail" };
    },
    run(target) {
      const s = sailOf(api.scene(), target);
      return s ? hoist(s.id) : undefined;
    },
  };

  /**
   * The sail a quick sheet verb on `target` trims: the mainsheet's ship's;
   * or the rig itself, away from the mast, on a ship with no mainsheet (else
   * the sheet's at the mainsheet: walk there).
   */
  function sheetOf(c, target) {
    const sc = c?.scene;
    if (traitOf(sc, target, MAINSHEET)) return stationsOf(sc, target).sail ?? null;
    const s = sailOf(sc, target);
    if (!s || s.mast || stationsOf(sc, s.id).mainsheet || (c && atMast(c, s))) return null;
    return s.id;
  }
  const sheet = (cid, name, key, goal) => ({
    id: cid,
    name,
    key,
    show: ["use"],
    hold: true,
    state(target, c) {
      const id = reach(c, target) ? sheetOf(c, target) : null;
      return id ? (busy(id) ?? {}) : null;
    },
    run(target) {
      const id = sheetOf({ scene: api.scene() }, target);
      return id ? trimSheet(id, goal) : undefined;
    },
  });

  // ─── the anchor ───────────────────────────────────────────────────────

  const isDown = (id) => value(id).down !== false;

  const weigh = {
    id: "weigh",
    name: "Raise anchor",
    key: "f",
    show: ["use"],
    hold: true,
    state(target, c) {
      if (!traitOf(c?.scene, target, ANCHOR) || !reach(c, target) || !isDown(target)) return null;
      if (someoneElse(target)) return { disabled: true, label: "Someone's at the windlass" };
      const out = Math.round(Number(value(target).rode) || 0);
      return out > 0 ? { label: `Raise anchor · ${out} m of chain out` } : {};
    },
    run(target) {
      const c = claim(target);
      if (!c) return undefined;
      return heldWeigh({
        rode: value(target).rode,
        input: (f) => ctx.sim.input(target, f),
        commit: (f) => ctx.sim.commit(target, f),
        alive: () => !c.lost() && exists(target),
        done: () => c.release(),
      });
    },
  };

  const drop = {
    id: "drop",
    name: "Drop anchor",
    key: "f",
    show: ["use"],
    state(target, c) {
      if (!traitOf(c?.scene, target, ANCHOR) || !reach(c, target) || isDown(target)) return null;
      return someoneElse(target) ? { disabled: true, label: "Someone's at the windlass" } : {};
    },
    // where it comes to rest is the simulator's to say and write (sim.js:
    // on the bottom, under the bow)
    run(target) {
      if (someoneElse(target)) return;
      ctx.sim.commit(target, { down: true, rode: RODE });
    },
  };

  // ─── out of reach: where to go ────────────────────────────────────────

  /** What kind of station a look at `target` is at, if any: "helm", "mainsheet", "sail" (the rig or its mast), "anchor". */
  function kindOf(sc, target) {
    if (traitOf(sc, target, HELM)) return "helm";
    if (traitOf(sc, target, MAINSHEET)) return "mainsheet";
    if (traitOf(sc, target, ANCHOR)) return "anchor";
    return sailOf(sc, target) ? "sail" : null;
  }

  // Aboard, walking: a station looked at from beyond reach (but not past
  // FAR) still answers, greyed, saying where to go. Never at a station (you
  // work it from there), in the water, or before you're aboard.
  const far = {
    id: "far",
    name: "Walk closer",
    key: "f",
    show: ["use"],
    state(target, c) {
      const m = me();
      if (!m.playing || m.station || m.swimming) return null;
      const kind = kindOf(c?.scene, target);
      if (!kind) return null;
      const d = distanceTo(c, target);
      if (!(d > REACH && d <= FAR)) return null;
      const st = stationsOf(c.scene, target);
      const at = (id) => !!id && within(c?.from, originOf(id), NEAR);
      return { disabled: true, label: walkTo(kind, st, { helm: at(st.helm), mainsheet: at(st.mainsheet), mast: at(st.sail) }) };
    },
    run() {},
  };

  // ─── the ladder ───────────────────────────────────────────────────────

  /** The ship whose ladder this look reaches: the ladder itself, or the hull with its ladder in reach. */
  function ladderShip(target, c) {
    if (!me().swimming) return null;
    const ship = shipOf(c?.scene, target);
    if (!ship) return null;
    const ladder = ctx.sim.stationsOf(ship)?.ladder;
    if (!ladder || (target !== ladder && target !== ship)) return null;
    return within(c?.from, originOf(ladder)) ? ship : null;
  }

  const climb = {
    id: "climb",
    name: "Climb aboard",
    key: "f",
    show: ["use"],
    state: (target, c) => (ladderShip(target, c) ? {} : null),
    run(target) {
      const ship = shipOf(api.scene(), target);
      if (ship) ctx.crew.board(ship);
    },
  };

  // ─── coming aboard ────────────────────────────────────────────────────

  const aboard = {
    id: "aboard",
    name: "Come aboard",
    key: "Enter",
    show: [],
    state: (target) => (target == null && !me().playing ? { title: "Walk the deck in first person (Enter)" } : null),
    run: () => ctx.crew.start?.(),
  };

  // in the order the prompt shows them (at most three for one look)
  return [helm, mainsheet, halyard, sail, sheet("haul", "Haul in", "q", 0), sheet("ease", "Ease out", "e", 1), weigh, drop, climb, far, aboard];
}
