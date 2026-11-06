// The verbs aboard (DESIGN.md, "Play"): what the use prompt offers when you
// look at the helm, the sail, the windlass or the ladder from within reach,
// and what its keys do. Commands over the stage's contract (STAGE.md, "A
// command"); held verbs are sessions the prompt keeps open while the key is
// down.
//
// A station's lasting setting is its trait, written through ctx.sim.commit
// when you let go (and at the helm each time a steering key comes up, so a
// tab that closes leaves the wheel where it was); while you work it, your
// live input goes through ctx.sim.input. Whoever is working a station holds
// its "station" claim, so one person steers at a time; a claim lost to
// someone else stops you without writing, and a station that's gone stops
// you too. The helmsman holds the wheel's pose too, so it turns as their
// key does, not a round trip later.
//
// The mainsheet is led aft: at the helm, Q and E trim it as they do at the
// mast. Looking at the mast (a part of the ship with no traits of its own)
// offers the sail's verbs.

import { ANCHOR, HELM, RODE, SAIL, STATION, isUnder, shipOf, wheelTransform } from "./traits.js";

export { RODE };

/** How far you can reach a station from (eye to its origin, m). */
export const REACH = 2.5;
export const WHEEL_RATE = 0.6; // of the wheel's travel per second, while A or D is held
export const RAISE_RATE = 1 / 4; // the sail, all the way in 4 s
export const SHEET_RATE = 0.25; // per second
export const WINCH_RATE = RODE / 6; // m/s: a full rode comes up in 6 s
const BREAKOUT = 4; // m of winding to bring up an anchor that's down short

/** Is `point` within reach of an eye at `from`? */
export function within(from, point, reach = REACH) {
  if (!Array.isArray(from) || !Array.isArray(point)) return false;
  return Math.hypot(from[0] - point[0], from[1] - point[1], from[2] - point[2]) <= reach;
}

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
  const objectOf = (c, id) => c?.scene?.objects?.[id] ?? null;
  const traitOf = (c, id, key) => objectOf(c, id)?.traits?.[key] ?? null;
  const originOf = (id) => {
    const m = api.worldOf(id);
    return m ? [m[12], m[13], m[14]] : null;
  };
  const reach = (c, id) => within(c?.from, originOf(id));
  const value = (id) => ctx.sim.value(id) ?? {};
  const someoneElse = (id) => {
    const by = api.claimedBy(id, STATION);
    return !!by && !by.mine;
  };
  const exists = (id) => !!api.scene().objects?.[id];

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
    const sailId = ctx.sim.stationsOf(shipOf(api.scene(), id))?.sail ?? null;
    let sheeting = null; // { code, trim }: Q or E held at the helm
    let closed = false;
    const steering = (code) => code === "KeyA" || code === "ArrowLeft" || code === "KeyD" || code === "ArrowRight";
    const showWheel = () => {
      const o = api.scene().objects?.[id];
      if (o) api.pose.hold(id, wheelTransform(o.transform, angle));
    };
    const close = () => {
      if (closed) return;
      closed = true;
      sheeting?.trim.end();
      sheeting = null;
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
        const k = String(ev.key).toLowerCase();
        if (k === "f") {
          if (!ev.repeat) leave?.();
          return true;
        }
        if ((k === "q" || k === "e") && sailId) {
          if (!ev.repeat && !sheeting) {
            const trim = trimSheet(sailId, k === "q" ? 0 : 1);
            if (trim) sheeting = { code: ev.code, trim };
          }
          return true;
        }
        return false;
      },
      keyup(ev) {
        if (sheeting?.code === ev.code) {
          sheeting.trim.end();
          sheeting = null;
          return true;
        }
        if (!held.delete(ev.code)) return false;
        // let go of the wheel: where it was left is lasting
        if (![...held].some(steering) && !lost && exists(id)) ctx.sim.commit(id, { angle });
        return true;
      },
      tick(dt) {
        if (lost || !exists(id)) return leave?.();
        sheeting?.trim.update(dt);
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
        const sheet = sailId ? ` · Q / E sheet ${Math.round((Number(value(sailId).sheet) || 0) * 100)}%` : "";
        return `A / D steer${sheet} · F leave · ${wheel}`;
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
      if (!traitOf(c, target, HELM) || !reach(c, target)) return null;
      if (ctx.crew.me().station === target) return null;
      return someoneElse(target) ? { disabled: true, label: "Someone's at the helm" } : {};
    },
    run: (target) => takeHelm(target),
  };

  // ─── the sail ─────────────────────────────────────────────────────────

  /**
   * The sail station a look at `target` works: the station itself, or (the
   * mast) what the sail station hangs from below the hull, with no traits
   * of its own, when that station is within reach. Else null. (Anything
   * else aboard, a table in the cockpit say, is no part of the sail.)
   */
  function sailOf(c, target) {
    if (traitOf(c, target, SAIL)) return reach(c, target) ? target : null;
    const o = objectOf(c, target);
    if (!o || (o.traits && Object.keys(o.traits).length)) return null;
    const ship = shipOf(c.scene, target);
    const id = ship && ship !== target ? ctx.sim.stationsOf(ship)?.sail : null;
    if (!id || id === target || !isUnder(c.scene, id, target)) return null;
    return reach(c, id) ? id : null;
  }
  /** The sail station to run a sail verb on (the prompt has checked reach): the target, or its ship's. */
  const sailNow = (target) => {
    const sc = api.scene();
    if (sc.objects?.[target]?.traits?.[SAIL]) return target;
    return ctx.sim.stationsOf(shipOf(sc, target))?.sail ?? target;
  };

  const raised = (id) => {
    const v = Number(value(id).raised);
    return Number.isFinite(v) ? v : 1;
  };
  const busy = (id) => (someoneElse(id) ? { disabled: true, label: "Someone's at the sheet" } : null);

  /** A held trim of the sheet, toward `goal` (0 in, 1 out). */
  const trimSheet = (id, goal) => trim(id, "sheet", goal, SHEET_RATE, 0.5);

  const sail = {
    id: "sail",
    name: "Raise sail",
    key: "f",
    show: ["use"],
    hold: true,
    state(target, c) {
      const id = sailOf(c, target);
      if (!id) return null;
      return busy(id) ?? { label: raised(id) > 0.5 ? "Lower sail" : "Raise sail" };
    },
    run(target) {
      const id = sailNow(target);
      return trim(id, "raised", raised(id) > 0.5 ? 0 : 1, RAISE_RATE, 1);
    },
  };
  const sheet = (cid, name, key, goal) => ({
    id: cid,
    name,
    key,
    show: ["use"],
    hold: true,
    state(target, c) {
      const id = sailOf(c, target);
      return id ? (busy(id) ?? {}) : null;
    },
    run: (target) => trimSheet(sailNow(target), goal),
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
      if (!traitOf(c, target, ANCHOR) || !reach(c, target) || !isDown(target)) return null;
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
      if (!traitOf(c, target, ANCHOR) || !reach(c, target) || isDown(target)) return null;
      return someoneElse(target) ? { disabled: true, label: "Someone's at the windlass" } : {};
    },
    // where it comes to rest is the simulator's to say and write (sim.js:
    // on the bottom, under the bow)
    run(target) {
      if (someoneElse(target)) return;
      ctx.sim.commit(target, { down: true, rode: RODE });
    },
  };

  // ─── the ladder ───────────────────────────────────────────────────────

  /** The ship whose ladder this look reaches: the ladder itself, or the hull with its ladder in reach. */
  function ladderShip(target, c) {
    if (!ctx.crew.me().swimming) return null;
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
    state: (target) => (target == null && !ctx.crew.me().playing ? { title: "Walk the deck in first person (Enter)" } : null),
    run: () => ctx.crew.start?.(),
  };

  return [helm, sail, sheet("haul", "Haul in", "q", 0), sheet("ease", "Ease out", "e", 1), weigh, drop, climb, aboard];
}
