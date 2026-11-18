// The ships (DESIGN.md, "Play"): the physics as one of the scene's
// processes, the poses everyone sees, and the stations' controls. ctx.sim is
// what the other parts read.
//
// The ships are a process on the doc's clock (the "clock" service, scene STAGE.md, "Native services"):
// the view that computes the clock starts it (`start`: warm from the poses
// it last saw held and the motion last published, else cold from the doc),
// steps every ship's physics in world time, and once a frame holds each
// hull's pose and its moving parts' (the boom, the jib, the wheel, the
// anchor on the bottom) where the steps left her, and publishes what a
// sailor would read off each ship in presence, so the HUD reads the same on
// every view. (A slow frame takes many steps of 1/60 s; holding poses at
// each would cost as much again as the physics, for nothing anyone sees.) Everyone else follows: the stage plays
// the poses back, and each follower remembers the poses it saw held, so
// that if it comes to compute it carries on from them. Who computes, and
// when they hand over (hidden, leaving, paused), is the stage's.
//
// A process's holds give way to a person's: a hull nobody steers yields
// (someone may carry or drag it, and the ship starts again at rest where
// they put it down), one at the helm doesn't. A station's lasting setting
// is its trait; whoever holds its "station" claim may put live input over
// it in presence (the wheel while it turns). The doc hears of the ships at
// the clock's checkpoints (`save`: each hull's transform and motion, only
// those this view still holds).

import { createShip, specFromBox, MAX_SUBSTEPS, SUBSTEP } from "./physics.js";
import { mergeSpec } from "./hull-model.js";
import { apply, eulerFromQuat, invert, matrixOf, matrixOfPose, multiply, poseOfMatrix, quatFromEuler, rotateQ, scaleOf } from "./frames.js";
import { IDENTITY, bodyBox, frameMatrix, hullKeyOf, isIdentity, placeIn, rigContractOf, shipFrame, toBody, toObject, yawOf } from "./body.js";
import { trimModelOf } from "./trim.js";
import { ANCHOR, DEFAULTS as STATION_DEFAULTS, SHIP, STATION, heldSign, jibTransform, parentOf, partsOf, rigTransform, shipsOf, stationKind, stationValue, wheelTransform } from "./traits.js";
import { contractOn, rigKey, rigSpecParts } from "./rig-contract.js";

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

/** The sloop's body box, for a hull that says nothing of its size. */
const SLOOP_BOX = Object.freeze({ min: [-1.9, -1.9, -6], max: [1.9, 1.2, 6] });

/**
 * A ship's spec from her hull's content and her rig, at the hull object's
 * scale (as she's drawn), in her body frame (`frame`: body.js):
 * - her size: the principal dimensions her GLB declares (extras.ship),
 *   about her body's origin (midships: body.js), else her box, else the
 *   sloop's;
 * - her mass: the displacement her GLB declares (kg), else the sloop's
 *   scaled to her size;
 * - her sail (`rig`: { matrix, sail }, the boom-and-sail as placed, in the
 *   hull's frame, and its GLB's extras.sail): the plan it states
 *   (extras.sail.plan: the sail the physics flies) where the rig puts it, at
 *   the rig's scale; a rig that states none leaves the sloop's, scaled to
 *   her hull;
 * - the trait's spec overrides win over all of it.
 * A rig whose GLB carries the rig aid's contract (`rig.contract`, its
 * extras.rig: rig-contract.js) is a different path, ahead of her hull's
 * facts and her box: her waterline, beam, draft and freeboard, her mass,
 * her centre of gravity's height, her lumped sail, keel and rudder are the
 * contract's, in her body frame, and `spec.rig` carries the whole contract
 * there for the physics that reads it (DESIGN.md, "The rig contract").
 * `hullUrl` (the hull object's sourceUrl) is checked against the hull the
 * rig was designed on (spec.rig.warnings). `hullKey` is the scene's file key
 * for that hull (body.js hullKeyOf): a contract that names the hull family
 * it describes (the stock sloop's, "sailing/hull") is taken only on that
 * family's hulls, and on any other the rig is a plain one (rig-contract.js
 * contractOn). `hullMesh` is her hull's own triangles in its GLB's
 * coordinates (hullTriangles): a contract designed on that hull floats her
 * on it (rig-contract.js drawnHull). A rig whose GLB isn't drawn where its
 * contract's frame is (the stock rig: its origin at the gooseneck) says where
 * it belongs (`rig.sail.at`, in her hull's frame), and is checked against
 * that instead of the identity.
 * @param {{ box?: { min, max } | null, extras?: object | null } | null} content
 * @param {object} [overrides]
 * @param {number} [scale]
 * @param {{ frame?: { position, rotation }, rig?: { matrix: number[], sail?: object | null, contract?: object | null } | null, hullUrl?: string | null, hullKey?: string | null, hullMesh?: Float64Array | null }} [o]
 */
export function specFor(content, overrides, scale = 1, { frame = IDENTITY, rig = null, hullUrl = null, hullKey = null, hullMesh = null } = {}) {
  const k = scale > 0 ? scale : 1;
  const contract = contractOn(rig?.contract, hullKey);
  if (contract) {
    const at = rig.sail?.at;
    const matrix = rig.matrix && at ? multiply(rig.matrix, invert(matrixOf({ position: at.position, rotation: at.rotation, scale: 1 }))) : (rig.matrix ?? null);
    const { box, own } = rigSpecParts(contract, k, { matrix, hullUrl, hullKey, mesh: hullMesh });
    return mergeSpec(specFromBox(box, own), overrides);
  }
  const dims = content?.extras?.ship;
  const box = bodyBox(content?.box ?? null, frame);
  let hull = box;
  if (dims && ["length", "beam", "draft", "freeboard"].every((key) => Number(dims[key]) > 0)) {
    const { length, beam, draft, freeboard } = dims;
    hull = { min: [-beam / 2, -draft, -length / 2], max: [beam / 2, freeboard, length / 2] };
  }
  hull ??= SLOOP_BOX;
  const own = {};
  const kg = Number(dims?.displacement);
  if (kg > 0) own.mass = kg * k * k * k;
  const sail = rig?.matrix ? sailOf(rig, frame, k) : null;
  if (sail) own.sail = sail;
  return mergeSpec(specFromBox({ min: hull.min.map((v) => v * k), max: hull.max.map((v) => v * k) }, own), overrides);
}

const triangles = new WeakMap();

/**
 * A loaded model's triangles (9 numbers each) in its root's own frame (its
 * GLB's coordinates, whatever the stage or looks.js has done to the root),
 * read once per root; null while it has no meshes (not loaded yet).
 * Duck-typed on three.js's Object3D (traverse, matrixWorld.elements,
 * geometry.attributes.position, geometry.index), so it needs no import.
 * @param {object | null | undefined} root  api.content(id).root
 */
export function hullTriangles(root) {
  if (!root || typeof root.traverse !== "function") return null;
  if (triangles.has(root)) return triangles.get(root);
  root.updateMatrixWorld?.(true);
  const toRoot = invert(Array.from(root.matrixWorld?.elements ?? IDENTITY_M));
  const out = [];
  root.traverse((o) => {
    const pos = o.isMesh ? o.geometry?.attributes?.position : null;
    if (!pos?.array || pos.itemSize !== 3) return;
    const m = multiply(toRoot, Array.from(o.matrixWorld?.elements ?? IDENTITY_M));
    const a = pos.array;
    const idx = o.geometry.index?.array ?? null;
    const n = idx ? idx.length - (idx.length % 3) : pos.count - (pos.count % 3);
    for (let i = 0; i < n; i++) {
      const v = 3 * (idx ? idx[i] : i);
      out.push(...apply(m, [a[v], a[v + 1], a[v + 2]]));
    }
  });
  if (out.length < 9) return null; // not loaded yet: asked again next frame
  const tri = Float64Array.from(out);
  triangles.set(root, tri);
  return tri;
}
const IDENTITY_M = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * The sail a rig sets, in the body frame at the hull's scale `k`: its plan
 * (extras.sail.plan, in the rig's frame) where the rig is placed, at its
 * scale; null for a rig that states no plan.
 */
export function sailOf({ matrix, sail }, frame, k = 1) {
  const plan = sail?.plan;
  if (!plan || !isVec3(plan.tack) || !["luff", "foot", "area"].every((key) => Number(plan[key]) > 0)) return null;
  const inBody = isIdentity(frame) ? matrix : multiply(invert(frameMatrix(frame)), matrix);
  const tack = apply(inBody, plan.tack).map((v) => round(v * k, 1e6));
  const s = scaleOf(matrix) * k;
  return { tack, luff: plan.luff * s, foot: plan.foot * s, area: plan.area * s * s };
}

/**
 * What a ship's physics is keyed on: her spec, with a rig contract (too big
 * to stringify every frame) by name.
 */
export const specKey = (spec) => JSON.stringify(spec.rig ? { ...spec, rig: rigKey(spec.rig) } : spec);

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
 * A jib's value (`v.jib`, the Jib piece's sailing.jib: sheet, held, furl)
 * adds the physics' jibSheet, jibHeld (held "port" −1, "starboard" +1) and
 * furl, each only when it is given; a ship with no Jib piece flies a rig
 * contract's jib trimmed with the main, rolled away as the main comes down.
 * @param {{ helm?: object | null, sail?: object | null, anchor?: object | null, jib?: object | null }} v
 * @param {number[] | null} at
 * @param {{ freeboard: number }} spec
 */
export function controlsOf(v, at, spec) {
  const n = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const down = !!v.anchor?.down && isVec3(at);
  const out = {
    rudder: v.helm ? clamp(n(v.helm.angle, 0), -1, 1) : 0,
    sail: v.sail ? clamp(n(v.sail.raised, 1), 0, 1) : 0,
    sheet: v.sail ? clamp(n(v.sail.sheet, 0.5), 0, 1) : 0.5,
    anchor: down ? { at, rode: effectiveRode(n(v.anchor.rode, 0), at, spec) } : null,
  };
  const j = v.jib;
  if (j) {
    if (Number.isFinite(Number(j.sheet))) out.jibSheet = clamp(Number(j.sheet), 0, 1);
    const held = heldSign(j.held);
    if (held) out.jibHeld = held;
    if (Number.isFinite(Number(j.furl))) out.furl = clamp(Number(j.furl), 0, 1);
  }
  return out;
}

/**
 * A state ready to step to world time `t`: when it's further behind than one
 * step catches up (MAX_SUBSTEPS: a stall, or frames too slow), the rest is
 * skipped, as the doc's clock (clock.t()) skips it, so she stays on the waves drawn.
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

/** Do two doc transforms say the same thing (within a hair)? */
export function sameTransform(a, b, eps = 1e-6) {
  if (!a || !b) return !a && !b;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= eps;
  for (let i = 0; i < 3; i++) if (!near(a.position?.[i], b.position?.[i]) || !near(a.rotation?.[i], b.rotation?.[i])) return false;
  return near(a.scale ?? 1, b.scale ?? 1);
}

/**
 * Did something move the hull (the halo, the inspector, a paste, a carry),
 * as against a checkpoint writing where she was? The stage stamps each
 * object a checkpoint's save moved with `saved` (the world t it was saved
 * at: scene STAGE.md, "Native services"); a move writes only the transform. So
 * a late checkpoint, landing after another view took over, isn't taken for
 * a move.
 * @param {object} doc  the doc's transform now  @param {number | undefined} saved  the object's `saved` stamp now
 * @param {{ transform, saved: number | null }} seen  both, as last seen
 */
export function movedByEditor(doc, saved, seen) {
  return !sameTransform(doc, seen.transform) && (Number.isFinite(saved) ? saved : null) === seen.saved;
}
const stampOf = (o) => (Number.isFinite(o?.saved) ? o.saved : null);

/** A doc transform, plain and filled in. */
export function plainTransform(t) {
  const v = (a) => [0, 1, 2].map((i) => Number(a?.[i]) || 0);
  const s = Number(t?.scale);
  return { position: v(t?.position), rotation: v(t?.rotation), scale: s > 0 ? s : 1 };
}

/**
 * A ship's state from a pose ({ position, quaternion }) and a motion ({
 * velocity, spin }, world, or nothing: still), at world time t.
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

// published()'s sails per physics' read().sails array (which it fills in place): the same objects, refilled
const sailsMemo = new WeakMap();
function publishedSails(sails, r) {
  let out = sailsMemo.get(sails);
  if (!out) sailsMemo.set(sails, (out = []));
  out.length = sails.length;
  for (let i = 0; i < sails.length; i++) {
    const x = sails[i];
    const o = out[i] ?? (out[i] = {});
    o.id = x.id;
    o.main = x.main;
    o.angle = r(x.angle);
    o.limit = r(x.limit);
    o.from = r(x.from);
    o.alpha = r(x.alpha);
    o.sheet = r(x.sheet);
    o.area = r(x.area);
    o.q = r(x.q);
  }
  return out;
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
    // a contract's jib (its chord, + to starboard), so a follower sees it where the simulator does
    ...(Number.isFinite(diag.jib) ? { jib: r(diag.jib) } : null),
    // and each of its sails as flown, so a follower's HUD and looks read the trim the simulator's do (trim.js)
    ...(Array.isArray(diag.sails) ? { sails: publishedSails(diag.sails, r) } : null),
    ...motionOf(state),
  };
}

// ─── the stage side ─────────────────────────────────────────────────────────

/**
 * ctx.sim. Reads ctx.sea (oceanAt per ship, wind) at every step; the doc's clock steps
 * it (the "clock" service's process); play.js ticks it each frame for what every view
 * does (inputs, following) and, computing, to hold the poses the steps
 * reached.
 * @param {any} api
 * @param {{ sea: { oceanAt, wind } }} ctx
 */
export function createSim(api, ctx) {
  const clock = api.use("clock");
  const claims = api.use("claims");
  let computing = false; // between the process's start and stop
  let savedSinceStep = false; // a checkpoint wrote the ships since the last step: let go of them landed
  const ships = new Map(); // id → { model, key, state, good, read, seen, at, frame }
  const holding = new Set(); // ids this view holds poses on (holds that stood)
  const taken = new Set(); // hulls whose hold was refused last frame: someone else has her, so she isn't stepped
  const shown = new Map(); // id → the hull's matrix as last seen held by the computer (following)
  let inputs = {}; // this view's live input, by station
  let streamed = {}; // the computer's last published ships
  let publishedAt = -Infinity;

  let memo = { scene: null, map: new Map() };
  const modelMemo = new WeakMap(); // a contract taken → its sails' trim thresholds
  /** A ship's parts, from a snapshot (traits.js partsOf), once per snapshot. */
  function parts(sc, ship) {
    if (memo.scene !== sc) memo = { scene: sc, map: new Map() };
    let out = memo.map.get(ship);
    if (!out) memo.map.set(ship, (out = partsOf(sc, ship)));
    return out;
  }

  /** The live input over a station, from whoever holds it. */
  function liveInput(id) {
    const c = claims.claimedBy(id, STATION);
    if (!c) return null;
    if (c.mine) return inputs[id] ?? null;
    return api.channel.get()[c.session]?.input?.[id] ?? null;
  }

  function value(id, sc = api.scene()) {
    const o = sc?.objects?.[id];
    const kind = stationKind(o);
    return kind ? stationValue(kind, o.traits[kind], liveInput(id)) : null;
  }

  /** One field of a station's live value (value(id)[key]) without building the value: for reading every frame. */
  function field(id, key, sc = api.scene()) {
    const o = sc?.objects?.[id];
    const kind = stationKind(o);
    if (!kind) return undefined;
    const input = liveInput(id);
    if (input && input[key] !== undefined) return input[key];
    const fields = o.traits[kind];
    if (fields && fields[key] !== undefined) return fields[key];
    return STATION_DEFAULTS[kind]?.[key];
  }

  function setInputs(next) {
    inputs = next;
    api.channel.set("input", Object.keys(next).length ? next : undefined);
  }

  /** The session computing the doc's clock, if it's someone else. */
  function simulator() {
    const c = clock.computer();
    return c && !c.mine ? c.session : null;
  }

  // ─── the process ─────────────────────────────────────────────────────────

  /**
   * A ship to simulate from her hull's world matrix (as shown; else the
   * doc's transform) and the last motion known (else the doc's), her body
   * through her frame.
   */
  function track(id, o, t, m, motion) {
    const doc = plainTransform(o.transform);
    const frame = shipFrame(api, id);
    const pose = m ? poseOfMatrix(m) : { position: doc.position, quaternion: quatFromEuler(doc.rotation) };
    const state = stateOf(toBody(pose, frame, doc.scale), motion ?? o.traits[SHIP]?.motion, t);
    return { frame, state, good: state, seen: { transform: doc, saved: stampOf(o) } };
  }

  /** This view computes from world time t: warm from what it followed, else cold from the doc. */
  function start(t) {
    computing = true;
    savedSinceStep = false;
    const sc = api.scene();
    ships.clear();
    for (const id of shipsOf(sc)) ships.set(id, track(id, sc.objects[id], t, shown.get(id) ?? null, streamed[id]));
    shown.clear();
    taken.clear();
  }

  /** It doesn't any more (paused, hidden, gone, or someone else computes): let go of what it holds, landed where a checkpoint just wrote it. */
  function stop() {
    computing = false;
    for (const id of holding) api.pose.release(id, savedSinceStep ? { landed: true } : undefined);
    holding.clear();
    taken.clear();
    ships.clear();
    api.channel.set("ships", undefined);
  }

  /**
   * One step of world time: every ship's physics to t. What she looks like
   * (her pose held, her readings published) is drawn once a frame (pose()),
   * not at every step: a slow frame takes many steps.
   */
  function step(_dt, t) {
    savedSinceStep = false;
    const sc = api.scene();
    const wind = ctx.sea.wind;
    const ids = shipsOf(sc);
    for (const id of ids) {
      const o = sc.objects[id];
      const doc = plainTransform(o.transform);
      const frame = shipFrame(api, id);
      const p = parts(sc, id);
      const rigExtras = p.sail ? api.content(p.sail)?.extras : null;
      const rig = p.sail ? { matrix: placeIn(sc, p.sail, id), sail: rigExtras?.sail, contract: rigExtras?.rig ?? null } : null;
      const content = api.content(id);
      const hullKey = hullKeyOf(api, id);
      // a contract boat floats on her own drawn hull, once it's loaded (if the rig was designed on it)
      const hullMesh = contractOn(rig?.contract, hullKey)?.source?.hull?.kind === "linked" ? hullTriangles(content?.root) : null;
      const spec = specFor(content, o.traits[SHIP]?.spec, doc.scale, { frame, rig, hullUrl: o.sourceUrl ?? null, hullKey, hullMesh });
      const key = specKey(spec);
      let s = ships.get(id);
      if (!s) ships.set(id, (s = track(id, o, t, null)));
      if (JSON.stringify(s.frame) !== JSON.stringify(frame)) {
        // her frame changed (her model loaded and said which way is forward, or someone set it):
        // her hull stays where it is, and her body turns in it
        s.state = { ...s.state, ...toBody(toObject(s.state, s.frame, doc.scale), frame, doc.scale) };
        s.good = s.state;
        s.frame = frame;
      }
      if (s.key !== key) {
        s.model = createShip(spec);
        s.key = key;
        // what her rig's contract can't vouch for, said once per spec
        for (const w of spec.rig?.warnings ?? []) console.warn(`sailing: ${w}`);
      }
      const moved = movedByEditor(doc, o.saved, s.seen);
      if (moved) {
        // someone moved it (the halo, the inspector, a carry put down): start again from there, at rest, and drop the anchor again
        const body = toBody({ position: doc.position, quaternion: quatFromEuler(doc.rotation) }, frame, doc.scale);
        s.state = s.model.rest({ position: body.position, yaw: yawOf(body.quaternion), t });
        s.at = null;
      }
      s.seen = { transform: doc, saved: stampOf(o) };
      if (taken.has(id)) {
        // someone holds her (a person carrying or dragging her, or a hold ranked ahead of ours): the
        // process doesn't step her. She waits where she was, with her motion, and goes on from there
        // when her hold stands again: put back, she's where she was taken; put down (landed), the
        // move above starts her again at rest where she landed.
        s.state = { ...s.state, t, acc: 0 };
        s.good = s.state;
        s.stepped = null;
        continue;
      }
      // the water she is in, asked once a step at her body's origin (her waterline), leaving out what she carries.
      // None (a dry room, a tilted link, or she has left a pond's footprint): she isn't stepped, and stays where
      // she is, still. Never stepped, she rests where the doc has her; out of the water partway, she stays where she
      // left it (not back at her last checkpoint, which may be in the water again: she would loop) and goes on from
      // there if water comes back under her.
      const env = { water: ctx.sea.oceanAt(s.state.position, id), wind };
      if (!env.water) {
        s.state = { ...s.state, velocity: [0, 0, 0], spin: [0, 0, 0], t, acc: 0 };
        s.good = s.state;
        s.stepped = null;
        // put down out of the water, she is where the doc has her: nothing of ours to hold
        if (moved) s.drawn = null;
        continue;
      }

      const v = { helm: p.helm && value(p.helm, sc), sail: p.sail && value(p.sail, sc), anchor: p.anchor && value(p.anchor, sc), jib: p.jib && value(p.jib, sc) };
      anchorSpot(s, p.anchor, v.anchor, sc, spec);
      const controls = controlsOf(v, s.at, spec);
      const [from, dt] = catchUp(s.state, t);
      const next = s.model.step(from, controls, env, dt);
      // never show, publish or save what isn't a number: back to the last good pose, still
      s.state = finiteState(next) ? next : { ...s.good, velocity: [0, 0, 0], spin: [0, 0, 0], t, acc: 0, boom: undefined };
      s.good = s.state;
      s.read = published(s.model.read(s.state, controls, env), s.state);
      s.drawn = { p, controls };
      s.stepped = { spec: s.model.spec, key, controls, from, state: s.state };
    }
    for (const id of ships.keys()) if (!ids.includes(id)) ships.delete(id);
  }

  /** This frame's poses, held from where the steps left each ship, and her readings published. */
  function pose() {
    const sc = api.scene();
    const held = new Set();
    const hold = (id, transform, yields = true) => {
      if (api.pose.hold(id, transform, { yields })) held.add(id);
    };
    // (what the steps saw may have gone since: only what's still in the doc is held)
    for (const [id, s] of ships) {
      const o = sc.objects[id];
      if (!o || !s.drawn || !finiteState(s.state)) continue;
      const { p, controls } = s.drawn;
      const doc = plainTransform(o.transform);
      const hull = toObject(s.state, s.frame ?? IDENTITY, doc.scale);
      // her hull yields to a person (someone may carry it) unless someone is at the helm: then she's driven
      const steered = !!(p.helm && claims.claimedBy(p.helm, STATION));
      if (api.pose.hold(id, transformOf(hull, doc.scale), { yields: !steered })) {
        held.add(id);
        taken.delete(id);
      } else taken.add(id);
      // the boom swung about the mast from where the rig was put
      if (p.sail && sc.objects[p.sail]) hold(p.sail, rigTransform(plainTransform(sc.objects[p.sail].transform), s.read.boom));
      // the jib swung about its luff from where it was put, when her physics flies one
      if (p.jib && sc.objects[p.jib] && Number.isFinite(s.read.jib)) hold(p.jib, jibTransform(plainTransform(sc.objects[p.jib].transform), s.read.jib));
      // the wheel is its helmsman's to hold (stations.js, a person's hold), so it turns as their key does; else ours
      const at = p.helm && claims.claimedBy(p.helm, STATION);
      if (p.helm && sc.objects[p.helm] && (!at || at.mine)) hold(p.helm, wheelTransform(plainTransform(sc.objects[p.helm].transform), controls.rudder), !at);
      // the anchor lies on the bottom while it's down, and hangs at the bow (the doc's place) when it's up
      if (p.hook && sc.objects[p.hook] && controls.anchor) {
        // upright on the bottom, in the frame of whatever it hangs from aboard
        const under = placeIn(sc, parentOf(sc, p.hook), id);
        const back = invert(multiply(matrixOfPose(hull.position, hull.quaternion, doc.scale), under));
        const scale = plainTransform(sc.objects[p.hook].transform).scale;
        hold(p.hook, { position: apply(back, controls.anchor.at), rotation: eulerFromQuat(poseOfMatrix(back).quaternion), scale });
      }
    }
    for (const id of holding) if (!held.has(id)) api.pose.release(id);
    holding.clear();
    for (const id of held) holding.add(id);

    const now = api.now();
    if (now - publishedAt >= PUBLISH_EVERY_MS) {
      publishedAt = now;
      const out = {};
      for (const [id, s] of ships) if (s.read) out[id] = s.read;
      streamed = out;
      api.channel.set("ships", out);
    }
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

  /** The checkpoint's: write each ship this view still holds into the draft, transform and motion (a process saves only what it holds). */
  function save(d) {
    for (const [id, s] of ships) {
      const o = d.objects?.[id];
      if (!o || !s.model || !holding.has(id) || !finiteState(s.state)) continue;
      const scale = plainTransform(o.transform).scale;
      writeTransform(o, transformOf(toObject(s.state, s.frame ?? IDENTITY, scale), scale));
      if (o.traits?.[SHIP]) o.traits[SHIP].motion = motionOf(s.state);
    }
    savedSinceStep = true;
  }

  const removeProcess = clock.process({ start, step, save, stop });

  return {
    ships: () => shipsOf(api.scene()),
    /** What a sailor reads off a ship (published()): as simulated here, else as the computer last published it. */
    read(id) {
      if (computing) return ships.get(id)?.read ?? null;
      return streamed[id] ?? null;
    },
    /**
     * Each of a ship's contract sails' trim thresholds by id (trim.js
     * trimModelOf), from her rig's GLB as this view has it loaded (so a
     * follower has them too); {} when she takes no contract (body.js
     * rigContractOf: the gate her physics reads it through, so a rig her
     * physics sails plain has no contract sails' advice either).
     */
    sailModels(id) {
      const contract = rigContractOf(api, id);
      if (!Array.isArray(contract?.sails)) return {};
      let m = modelMemo.get(contract);
      if (!m) modelMemo.set(contract, (m = Object.fromEntries(contract.sails.map((x) => [x.id, trimModelOf(x)]))));
      return m;
    },
    /**
     * Her latest step of world time on this view, as it was taken: `{ spec,
     * key, controls, from, state }`, the spec her physics stepped with
     * (createShip's own) and its key, the controls, the state it went on
     * from and the state it reached (the physics' own, unrounded). null on a
     * view that isn't computing, before her first step, and when her latest
     * step didn't step her (held by a person, or no water under her). For
     * tests and the probe's trace (probes/sailing-probe.html ?trace): what
     * two runs are compared on.
     */
    stepped: (id) => ships.get(id)?.stepped ?? null,
    stationsOf(id) {
      const { helm, sail, anchor, mainsheet, jib, ladder, winches } = parts(api.scene(), id);
      return { helm, sail, anchor, mainsheet, jib, ladder, winches };
    },
    value: (id) => value(id),
    field: (id, key) => field(id, key),
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
    /** Does this view compute the ships (the doc's clock)? */
    simulating: () => computing,
    simulator,
    /** One frame, every view: drop stale inputs; computing, hold the poses the steps reached; following, keep what the computer publishes and the poses it holds. */
    tick() {
      const sc = api.scene();
      // what this view put in for stations it no longer holds goes
      const stale = Object.keys(inputs).filter((id) => !claims.claimedBy(id, STATION)?.mine);
      if (stale.length) setInputs(Object.fromEntries(Object.entries(inputs).filter(([id]) => !stale.includes(id))));
      if (computing) return pose();
      const c = simulator();
      const latest = c ? api.channel.get()[c]?.ships : null;
      if (latest) streamed = latest;
      // where the computer last held each hull (its hold, or a person's ahead of it): a successor starts there, not at the last save
      for (const id of shipsOf(sc)) if (api.heldBy?.(id, { yields: true })) shown.set(id, api.worldOf(id));
    },
    dispose() {
      removeProcess?.();
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
