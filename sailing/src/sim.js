// The ships in play (DESIGN.md, "Play"): who simulates, the physics, the
// poses everyone sees, and the stations' controls. ctx.sim is what the
// other parts read.
//
// One view holds the scene's "sim" claim. It steps every ship's physics at
// the sea's clock, holds each hull's pose and its moving parts' (the boom,
// the wheel, the anchor on the bottom), and publishes what a sailor would
// read off each ship in presence, so the HUD reads the same on every view.
// Everyone else follows: the stage plays the poses back, and a follower
// checks the claim each frame, taking over from the poses it last saw held
// when the simulator has gone. A simulator whose tab is hidden (its frames
// stop) writes the ships down and lets the claim go, so a visible peer
// carries on.
//
// A station's lasting setting is its trait; whoever holds its "station"
// claim may put live input over it in presence (the wheel while it turns).
// The doc hears of the ships only now and then: each hull's transform and
// motion every ten seconds or so when it has moved, and when the simulator
// stops or hides.

import { createShip, specFromBox, MAX_SUBSTEPS, SUBSTEP } from "./physics.js";
import { conjQ, eulerFromQuat, poseOfMatrix, quatFromEuler, rotateQ } from "./frames.js";
import { ANCHOR, SHIP, SIM, STATION, partsOf, shipsOf, stationKind, stationValue, wheelTransform } from "./traits.js";

/** How often the simulator writes the ships to the doc (ms), if they've moved. */
export const SAVE_EVERY_MS = 10000;
/** Moved this far (m), or turned this far (rad), since the last save: worth another. */
export const SAVE_MOVED = 0.25;
export const SAVE_TURNED = 0.02;
/** How often the simulator publishes each ship's diagnostics (ms). */
export const PUBLISH_EVERY_MS = 200;
/** The sea floor under a dropped anchor (m). */
export const DEPTH = 10;
/** Chain beyond the straight drop to the bottom, whatever the windlass says (m). */
export const SLACK = 4;
/** An anchor further than its rode and this from the bow (m) isn't hers: it's dropped again where she is. */
export const ANCHOR_REACH = 5;

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const round = (v, k) => Math.round(v * k) / k + 0;

// ─── the ship from the doc (pure) ───────────────────────────────────────────

/**
 * A ship's spec from its hull's content: the principal dimensions its GLB
 * declares (extras.ship, about its origin) when it does, else its body box,
 * else the sloop's, all at the object's scale (as it's drawn); the trait's
 * spec overrides win.
 * @param {{ box?: { min, max } | null, extras?: object | null } | null} content
 * @param {object} [overrides]
 * @param {number} [scale]
 */
export function specFor(content, overrides, scale = 1) {
  const k = scale > 0 ? scale : 1;
  const dims = content?.extras?.ship;
  let box = null;
  if (dims && ["length", "beam", "draft", "freeboard"].every((key) => Number(dims[key]) > 0)) {
    const { length, beam, draft, freeboard } = dims;
    box = { min: [-beam / 2, -draft, -length / 2], max: [beam / 2, freeboard, length / 2] };
  } else box = content?.box ?? null;
  if (!box && k === 1) return createShip(overrides).spec;
  box ??= { min: [-1.9, -1.9, -6], max: [1.9, 1.2, 6] }; // the sloop's
  return specFromBox({ min: box.min.map((v) => v * k), max: box.max.map((v) => v * k) }, overrides);
}

/** The bow's fairlead in the body frame, where the rode leaves (as physics.js puts it). */
export function bowOf(spec) {
  const c = spec.center ?? [0, 0];
  return [c[0], spec.freeboard, c[1] - spec.length / 2 + 0.03 * spec.length];
}

/** Where an anchor let go now comes to rest: on the bottom, under the bow. */
export function dropPoint(state, spec) {
  const b = rotateQ(state.quaternion, bowOf(spec));
  return [round(state.position[0] + b[0], 1e3), -DEPTH, round(state.position[2] + b[2], 1e3)];
}

/** The chain the physics holds her on: never shorter than the drop to the anchor and some slack. */
export const effectiveRode = (rode, at, spec) => Math.max(Number(rode) || 0, Math.max(0, -at[1]) + spec.freeboard + SLACK);

/**
 * Can an anchor lying at `at` be hers: within her rode (and a little) of
 * the bow? A spot written before the ship was moved, or copied with her, is
 * not, and pulling her to it would fling her there.
 */
export function anchorReaches(at, state, spec, rode) {
  if (!isVec3(at)) return false;
  const b = rotateQ(state.quaternion, bowOf(spec));
  const d = Math.hypot(at[0] - state.position[0] - b[0], at[1] - state.position[1] - b[1], at[2] - state.position[2] - b[2]);
  return d <= effectiveRode(rode, at, spec) + ANCHOR_REACH;
}

/**
 * The physics' controls from the stations' live values (null where a ship
 * has no such station: no helm leaves the rudder amidships, no sail station
 * means no sail set, no windlass no anchor), and where the anchor lies.
 * @param {{ helm?: object | null, sail?: object | null, anchor?: object | null }} v
 * @param {number[] | null} at
 * @param {{ freeboard: number }} spec
 */
export function controlsOf(v, at, spec) {
  const n = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const down = !!v.anchor?.down && isVec3(at);
  return {
    rudder: v.helm ? clamp(n(v.helm.angle, 0), -1, 1) : 0,
    sail: v.sail ? clamp(n(v.sail.raised, 1), 0, 1) : 0,
    sheet: v.sail ? clamp(n(v.sail.sheet, 0.5), 0, 1) : 0.5,
    anchor: down ? { at, rode: effectiveRode(n(v.anchor.rode, 0), at, spec) } : null,
  };
}

/**
 * Who simulates, from the scene's "sim" claim (claimedBy's answer) and
 * whether this view holds it:
 * "run" (it's ours), "yield" (we held it and someone else has it now),
 * "take" (nobody holds a live one), "follow" (someone else simulates).
 */
export function simRole(claim, holding) {
  if (holding) return claim && !claim.mine ? "yield" : "run";
  return claim ? "follow" : "take";
}

/**
 * A state ready to step to sea time `t`: when it's further behind than one
 * step catches up (MAX_SUBSTEPS: a stall, or frames too slow), the rest is
 * skipped, as the sea's clock skips it, so she stays on the waves drawn.
 * @returns {[object, number]}  the state, and the dt to step it by
 */
export function catchUp(state, t) {
  const cap = MAX_SUBSTEPS * SUBSTEP;
  let s = state;
  if (t - (s.t + (s.acc ?? 0)) > cap) s = { ...s, t: t - cap, acc: 0 };
  return [s, Math.max(0, t - (s.t + (s.acc ?? 0)))];
}

/** Is every number in a ship's state a number? */
export const finiteState = (s) => [s.position, s.quaternion, s.velocity, s.spin].every((v) => Array.isArray(v) && v.every(Number.isFinite));

/** Should the ship be written to the doc: long enough since the last time, and moved or turned since? */
export function shouldSave({ now, lastAt, last, pose, every = SAVE_EVERY_MS }) {
  if (!last) return true;
  if (now - lastAt < every) return false;
  const moved = Math.hypot(pose.position[0] - last.position[0], pose.position[2] - last.position[2]);
  const dot = Math.abs(pose.quaternion.reduce((s, v, i) => s + v * last.quaternion[i], 0));
  const turned = 2 * Math.acos(clamp(dot, 0, 1));
  return moved > SAVE_MOVED || turned > SAVE_TURNED;
}

/** Do two doc transforms say the same thing (within a hair)? */
export function sameTransform(a, b, eps = 1e-6) {
  if (!a || !b) return !a && !b;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= eps;
  for (let i = 0; i < 3; i++) if (!near(a.position?.[i], b.position?.[i]) || !near(a.rotation?.[i], b.rotation?.[i])) return false;
  return near(a.scale ?? 1, b.scale ?? 1);
}

const motionKey = (m) => JSON.stringify(m ? { velocity: m.velocity ?? null, spin: m.spin ?? null } : null);

/**
 * Did someone move the hull (the editor), as against a simulator saving
 * where she was? A save writes her motion with her transform; a move
 * writes only the transform. So a late save, landing after another view
 * took over, isn't taken for a move.
 * @param {object} doc  the doc's transform now  @param {object | undefined} motion  sailing.ship.motion now
 * @param {{ transform, motion: string }} seen  both, as last seen
 */
export function movedByEditor(doc, motion, seen) {
  return !sameTransform(doc, seen.transform) && motionKey(motion) === seen.motion;
}

/** A doc transform, plain and filled in. */
export function plainTransform(t) {
  const v = (a) => [0, 1, 2].map((i) => Number(a?.[i]) || 0);
  const s = Number(t?.scale);
  return { position: v(t?.position), rotation: v(t?.rotation), scale: s > 0 ? s : 1 };
}

/**
 * A ship's state from a pose ({ position, quaternion }) and a motion ({
 * velocity, spin }, world, or nothing: still), at sea time t.
 */
export function stateOf(pose, motion, t) {
  return {
    position: [...pose.position],
    quaternion: [...pose.quaternion],
    velocity: isVec3(motion?.velocity) ? [...motion.velocity] : [0, 0, 0],
    spin: isVec3(motion?.spin) ? [...motion.spin] : [0, 0, 0],
    t,
    acc: 0,
  };
}

/** The doc transform for a ship's state (its scale kept), rounded as the doc gets it. */
export function transformOf(state, scale = 1) {
  return {
    position: state.position.map((v) => round(v, 1e3)),
    rotation: eulerFromQuat(state.quaternion).map((v) => round(v, 1e4)),
    scale,
  };
}

/** A ship's motion as the doc keeps it (sailing.ship.motion). */
export const motionOf = (state) => ({ velocity: state.velocity.map((v) => round(v, 1e3)), spin: state.spin.map((v) => round(v, 1e4)) });

/** A point in the world, in the frame of a ship at `state` (unscaled): a part held under the hull. */
export function toShip(state, p) {
  return rotateQ(conjQ(state.quaternion), [p[0] - state.position[0], p[1] - state.position[1], p[2] - state.position[2]]);
}

/** What a sailor reads off a ship, as it goes out in presence: numbers rounded, plus the motion a successor starts from. */
export function published(diag, state) {
  const r = (v) => round(v, 1e4);
  return {
    speed: r(diag.speed),
    heading: r(diag.heading),
    heel: r(diag.heel),
    pitch: r(diag.pitch),
    leeway: r(diag.leeway),
    apparentWind: { speed: r(diag.apparentWind.speed), angle: r(diag.apparentWind.angle) },
    boom: r(diag.boom),
    sailForce: Math.round(diag.sailForce),
    submerged: r(diag.submerged),
    ...motionOf(state),
  };
}

// ─── the stage side ─────────────────────────────────────────────────────────

/**
 * ctx.sim. Reads ctx.sea (ocean, wind, clock) at every step; play.js ticks
 * it after the sea, each frame.
 * @param {any} api
 * @param {{ sea: { ocean, wind, clock(): number } }} ctx
 */
export function createSim(api, ctx) {
  let release = null; // our "sim" claim, while we simulate
  const ships = new Map(); // id → { model, key, state, good, read, seen, at, savedAt, saved }
  const holding = new Set(); // ids this view holds poses on
  const shown = new Map(); // id → the hull's matrix as last seen held by the simulator (following)
  let inputs = {}; // this view's live input, by station
  let streamed = {}; // the simulator's last published ships
  let publishedAt = -Infinity;

  let memo = { scene: null, map: new Map() };
  /** A ship's parts, from a snapshot (traits.js partsOf), once per snapshot. */
  function parts(sc, ship) {
    if (memo.scene !== sc) memo = { scene: sc, map: new Map() };
    let out = memo.map.get(ship);
    if (!out) memo.map.set(ship, (out = partsOf(sc, ship)));
    return out;
  }

  /** The live input over a station, from whoever holds it. */
  function liveInput(id) {
    const c = api.claimedBy(id, STATION);
    if (!c) return null;
    if (c.mine) return inputs[id] ?? null;
    return api.presence.get()?.[c.session]?.keys?.[api.id]?.input?.[id] ?? null;
  }

  function value(id, sc = api.scene()) {
    const o = sc?.objects?.[id];
    const kind = stationKind(o);
    return kind ? stationValue(kind, o.traits[kind], liveInput(id)) : null;
  }

  function setInputs(next) {
    inputs = next;
    api.presence.set("input", Object.keys(next).length ? next : undefined);
  }

  /** The simulating session, if it's someone else. */
  function simulator() {
    const c = api.claimedBy(null, SIM);
    return c && !c.mine ? c.session : null;
  }

  // ─── simulating ──────────────────────────────────────────────────────────

  /** A ship to simulate from a world matrix (as shown; else the doc's transform) and the last motion known (else the doc's). */
  function track(o, t, m, motion) {
    const doc = plainTransform(o.transform);
    const pose = m ? poseOfMatrix(m) : { position: doc.position, quaternion: quatFromEuler(doc.rotation) };
    const state = stateOf(pose, motion ?? o.traits[SHIP]?.motion, t);
    return { state, good: state, seen: { transform: doc, motion: motionKey(o.traits[SHIP]?.motion) }, savedAt: Date.now(), saved: { position: state.position, quaternion: state.quaternion } };
  }

  function start(sc) {
    release = api.claim(null, SIM, { onLost: stop });
    if (!release) return;
    ships.clear();
    // from the poses it last saw the simulator hold, and the last motion it knew
    for (const id of shipsOf(sc)) ships.set(id, track(sc.objects[id], ctx.sea.clock(), shown.get(id) ?? api.worldOf(id), streamed[id]));
    shown.clear();
  }

  /** We're not simulating any more: someone else won the claim (they hold the poses now). */
  function stop() {
    release = null;
    for (const id of holding) api.pose.release(id);
    holding.clear();
    ships.clear();
    api.presence.set("ships", undefined);
  }

  /**
   * We're going (the view stops, or hides): the doc gets where the ships
   * are, and peers keep showing them there until their doc does, so nobody
   * sees her jump back to the last save.
   */
  function letGo() {
    if (!release) return;
    save(api.scene(), true);
    for (const id of holding) api.pose.release(id, { landed: true });
    holding.clear();
    const r = release;
    release = null;
    ships.clear();
    api.presence.set("ships", undefined);
    r();
  }

  function step(sc) {
    const t = ctx.sea.clock();
    const env = { water: ctx.sea.ocean, wind: ctx.sea.wind };
    const held = new Set();
    const hold = (id, transform) => {
      api.pose.hold(id, transform);
      held.add(id);
    };
    const ids = env.water ? shipsOf(sc) : []; // no sea, nothing sails
    for (const id of ids) {
      const o = sc.objects[id];
      const doc = plainTransform(o.transform);
      const motion = o.traits[SHIP]?.motion;
      const spec = specFor(api.content(id), o.traits[SHIP]?.spec, doc.scale);
      const key = JSON.stringify(spec);
      let s = ships.get(id);
      if (!s) ships.set(id, (s = track(o, t, null)));
      if (s.key !== key) {
        s.model = createShip(spec);
        s.key = key;
      }
      if (movedByEditor(doc, motion, s.seen)) {
        // someone moved it (the editor): start again from there, at rest, and drop the anchor again
        s.state = s.model.rest({ position: doc.position, yaw: doc.rotation[1], t });
        s.at = null;
      }
      s.seen = { transform: doc, motion: motionKey(motion) };

      const p = parts(sc, id);
      const v = { helm: p.helm && value(p.helm, sc), sail: p.sail && value(p.sail, sc), anchor: p.anchor && value(p.anchor, sc) };
      anchorSpot(s, p.anchor, v.anchor, sc, spec);
      const controls = controlsOf(v, s.at, spec);
      const [from, dt] = catchUp(s.state, t);
      const next = s.model.step(from, controls, env, dt);
      // never show, publish or save what isn't a number: back to the last good pose, still
      s.state = finiteState(next) ? next : { ...s.good, velocity: [0, 0, 0], spin: [0, 0, 0], t, acc: 0, boom: undefined };
      s.good = s.state;
      s.read = published(s.model.read(s.state, controls, env), s.state);

      hold(id, transformOf(s.state, doc.scale));
      if (p.sail) {
        const r = plainTransform(sc.objects[p.sail].transform);
        hold(p.sail, { ...r, rotation: [r.rotation[0], s.read.boom, r.rotation[2]] });
      }
      // the wheel is its helmsman's to hold (stations.js), so it turns as their key does; else ours
      const at = p.helm && api.claimedBy(p.helm, STATION);
      if (p.helm && (!at || at.mine)) hold(p.helm, wheelTransform(plainTransform(sc.objects[p.helm].transform), controls.rudder));
      // the anchor lies on the bottom while it's down, and hangs at the bow (the doc's place) when it's up
      if (p.hook && controls.anchor) {
        const scale = plainTransform(sc.objects[p.hook].transform).scale;
        hold(p.hook, { position: toShip(s.state, controls.anchor.at).map((x) => x / doc.scale), rotation: eulerFromQuat(conjQ(s.state.quaternion)), scale });
      }
    }
    for (const id of holding) if (!held.has(id)) api.pose.release(id);
    holding.clear();
    for (const id of held) holding.add(id);
    for (const id of ships.keys()) if (!ids.includes(id)) ships.delete(id);

    const now = Date.now();
    if (now - publishedAt >= PUBLISH_EVERY_MS) {
      publishedAt = now;
      const out = {};
      for (const [id, s] of ships) if (s.read) out[id] = s.read;
      streamed = out;
      api.presence.set("ships", out);
    }
    save(sc, false);
  }

  /**
   * Where the anchor lies while it's down: where the doc says, if that can
   * be hers; else where we last dropped it; else dropped under the bow now
   * and written down. Forgotten (and cleared from the doc) when it's up.
   */
  function anchorSpot(s, station, v, sc, spec) {
    const docAt = station && sc.objects[station]?.traits?.[ANCHOR]?.at;
    const write = (at) =>
      api.change((d) => {
        const tr = d.objects?.[station]?.traits?.[ANCHOR];
        if (!tr) return;
        if (at) tr.at = [...at];
        else delete tr.at;
      });
    if (!v?.down) {
      s.at = null;
      if (docAt && !s.cleared) write(null);
      s.cleared = true;
      return;
    }
    s.cleared = false;
    const fits = (at) => anchorReaches(at, s.state, spec, v.rode);
    if (fits(docAt)) s.at = docAt;
    else if (!fits(s.at)) {
      s.at = dropPoint(s.state, spec);
      write(s.at);
    }
  }

  /** Write the ships that are due (or all, `force`) to the doc: transform and motion. */
  function save(sc, force) {
    const now = Date.now();
    const due = [];
    for (const [id, s] of ships) {
      if (!s.model || !sc.objects[id] || !finiteState(s.state)) continue;
      if (force || shouldSave({ now, lastAt: s.savedAt, last: s.saved, pose: s.state })) due.push([id, s]);
    }
    if (!due.length) return;
    const writes = due.map(([id, s]) => {
      const t = transformOf(s.state, plainTransform(sc.objects[id].transform).scale);
      const motion = motionOf(s.state);
      s.seen = { transform: t, motion: motionKey(motion) };
      s.savedAt = now;
      s.saved = { position: [...s.state.position], quaternion: [...s.state.quaternion] };
      return [id, t, motion];
    });
    api.change((d) => {
      for (const [id, t, motion] of writes) {
        const o = d.objects?.[id];
        if (!o) continue;
        writeTransform(o, t);
        if (o.traits?.[SHIP]) o.traits[SHIP].motion = motion;
      }
    });
  }

  // stopping (the activity switched), hiding or closing the tab: write the ships down and let go
  api.signal?.addEventListener?.("abort", letGo);
  const doc = globalThis.document;
  if (doc) api.listen?.(doc, "visibilitychange", () => doc.visibilityState === "hidden" && letGo());
  api.listen?.(globalThis, "pagehide", letGo);

  return {
    ships: () => shipsOf(api.scene()),
    /** What a sailor reads off a ship (published()): as simulated here, else as the simulator last published it. */
    read(id) {
      if (release) return ships.get(id)?.read ?? null;
      return streamed[id] ?? null;
    },
    stationsOf(id) {
      const { helm, sail, anchor, ladder } = parts(api.scene(), id);
      return { helm, sail, anchor, ladder };
    },
    value: (id) => value(id),
    input(id, partial) {
      if (partial == null) {
        if (!(id in inputs)) return;
        const { [id]: _gone, ...rest } = inputs;
        setInputs(rest);
      } else setInputs({ ...inputs, [id]: { ...inputs[id], ...partial } });
    },
    commit(id, fields) {
      const kind = stationKind(api.scene()?.objects?.[id]);
      if (!kind) return;
      api.change((d) => {
        const t = d.objects?.[id]?.traits?.[kind];
        if (!t) return;
        for (const [k, v] of Object.entries(fields ?? {})) {
          if (v === undefined) delete t[k];
          else t[k] = v;
        }
      });
    },
    simulating: () => !!release,
    simulator,
    /** One frame: take over, follow or step. */
    tick() {
      const sc = api.scene();
      // what this view put in for stations it no longer holds goes
      const stale = Object.keys(inputs).filter((id) => !api.claimedBy(id, STATION)?.mine);
      if (stale.length) setInputs(Object.fromEntries(Object.entries(inputs).filter(([id]) => !stale.includes(id))));

      const role = simRole(api.claimedBy(null, SIM), !!release);
      if (role === "yield") stop();
      else if (role === "take") start(sc);
      else if (role === "follow") {
        const c = api.claimedBy(null, SIM);
        const latest = api.presence.get()?.[c.session]?.keys?.[api.id]?.ships;
        if (latest) streamed = latest;
        // where the simulator last held each hull: a successor starts there, not at the last save
        for (const id of shipsOf(sc)) if (api.heldBy?.(id)) shown.set(id, api.worldOf(id));
      }
      if (release) step(sc);
    },
    dispose() {
      api.signal?.removeEventListener?.("abort", letGo);
    },
  };
}

/** Write a transform's numbers into a doc object, each one only if it changed (STAGE.md: never replace a transform). */
function writeTransform(o, t) {
  if (!o.transform) {
    o.transform = { position: [...t.position], rotation: [...t.rotation], scale: t.scale };
    return;
  }
  for (const k of ["position", "rotation"]) {
    if (!Array.isArray(o.transform[k])) o.transform[k] = [0, 0, 0];
    for (let i = 0; i < 3; i++) if (o.transform[k][i] !== t[k][i]) o.transform[k][i] = t[k][i];
  }
  if (o.transform.scale !== t.scale) o.transform.scale = t.scale;
}
