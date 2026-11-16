// For tests only: leaving the anchor replayed in node (DESIGN.md, "Leaving
// the anchor"). The stock sloop as a template lays her out, with her own
// GLBs' extras (her rig contract), on a fake stage whose sea is water's own
// evaluator (fakes.js, surface.js): two views, A computing the world and B
// the crew working the stations through the verbs' own held helpers
// (stations.js heldTrim, heldWeigh) under B's station claims, as
// sailing-run.mjs plays it in Chrome. What happens at each moment is a
// timeline of world times; the frame is the probe page's (1/60 s).
import { layOutShip, headTo } from "../layout.js";
import { createSeaView } from "../sea-view.js";
import { bowOf, createSim, effectiveRode, specFor } from "../sim.js";
import { PIECES, fileKey } from "../parts.js";
import { STAND, partGLB } from "../ship.js";
import { RAISE_RATE, heldTrim, heldWeigh } from "../stations.js";
import { hudModel } from "../hud.js";
import { frameOf, placeIn, toBody } from "../body.js";
import { quatFromEuler, rotateQ } from "../frames.js";
import { ANCHOR, RODE, SAIL, SEA, SHIP, STATION, WEATHER } from "../traits.js";
import { emptyScene, fakeDrop, fakeNode, fakeWorld } from "./fakes.js";

export const FRAME = 1 / 60;
const DEG = 180 / Math.PI;

/** What the stage reads off a GLB: its positions' box and the scene's extras. */
export function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }
  return { box: { min, max }, extras: json.scenes[0].extras ?? {} };
}

let glbs = null;
const stockGLBs = () => (glbs ??= { hull: readGLB(partGLB("hull").bytes), rig: readGLB(partGLB("rig").bytes) });

/**
 * The sloop as a template lays her out, on a stage of two views (A
 * computes, B crews), sea and weather seeded `sea`.
 * @param {{ sea: number, wind?: { speed: number, from: number }, anchored?: boolean }} o
 */
export async function anchorage({ sea, wind = { speed: 7, from: 45 }, anchored = false }) {
  const doc = emptyScene();
  const hull = await layOutShip(fakeDrop(doc).ctx, { wind, seed: sea, anchored });
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), windlass: byName("Windlass"), jib: byName("Jib"), wheel: byName("Wheel") };
  // one seed for the waves and the gusts, as sailing-run pins them
  Object.values(doc.objects).find((o) => o?.traits?.[SEA]).traits[SEA].seed = sea;
  doc.traits[WEATHER].seed = sea;
  const g = stockGLBs();
  const content = {
    [hull]: { loaded: true, box: g.hull.box, extras: g.hull.extras, root: fakeNode() },
    [ids.rig]: { loaded: true, box: null, extras: g.rig.extras, root: fakeNode({ Sail: fakeNode() }) },
  };
  return { doc, ids, content };
}

let stockSpec = null;
/** Her spec as sim.js makes it for the stock rig at its stand on the stock hull: her contract, her bow's fairlead, her freeboard. */
export function spec() {
  if (stockSpec) return stockSpec;
  const g = stockGLBs();
  const doc = { objects: { h: { traits: { [SHIP]: {} } }, m: { parent: "h", transform: { position: STAND.mast } }, r: { parent: "m", transform: { position: PIECES.mast[1].at }, traits: { [SAIL]: {} } } } };
  return (stockSpec = specFor(g.hull, undefined, 1, { frame: frameOf({}, g.hull), rig: { matrix: placeIn(doc, "r", "h"), sail: g.rig.extras.sail, contract: g.rig.extras.rig }, hullUrl: "automerge:hull", hullKey: fileKey("hull") }));
}

/**
 * How much chain her rode has to spare (m) as the simulator holds her now:
 * the chain the physics holds her on (sim.js effectiveRode of the
 * windlass's rode) less the straight line from her bow's fairlead to where
 * the anchor lies. > 0: slack, the anchor doesn't pull her. null while the
 * anchor's up or not yet down.
 */
export function slackOf(w, A, ids) {
  const at = w.doc.objects[ids.windlass].traits[ANCHOR].at;
  const held = w.holds.get(ids.hull)?.transform;
  const v = A.sim.value(ids.windlass);
  if (!Array.isArray(at) || !held || v.down === false) return null;
  const sp = spec();
  const body = toBody({ position: held.position, quaternion: quatFromEuler(held.rotation) }, frameOf(w.doc.objects[ids.hull].traits[SHIP], stockGLBs().hull), held.scale ?? 1);
  const b = rotateQ(body.quaternion, bowOf(sp));
  const d = Math.hypot(at[0] - body.position[0] - b[0], at[1] - body.position[1] - b[1], at[2] - body.position[2] - b[2]);
  return effectiveRode(v.rode, at, sp) - d;
}

/** A view running the parts the ships need: the sea and the sim, ticked in play.js's order. */
function play(api) {
  const ctx = {};
  ctx.sea = createSeaView(api);
  ctx.sim = createSim(api, ctx);
  api.loop(() => {
    ctx.sea.tick();
    ctx.sim.tick();
  });
  return ctx;
}

/** What B's HUD would advise, from hud.js's own model (its predicates, not copies of its thresholds). */
export function adviceOf(ctx, ids) {
  const read = ctx.sim.read(ids.hull);
  const v = (id) => ctx.sim.value(id);
  return hudModel({
    me: { playing: true, station: ids.wheel },
    read,
    sail: v(ids.rig),
    jib: v(ids.jib),
    anchor: v(ids.windlass),
    stations: ctx.sim.stationsOf(ids.hull),
    models: ctx.sim.sailModels(ids.hull),
  }).advice;
}

/** Her read at a moment, in degrees and m/s: the apparent wind off the bow, her speed through the water, over the ground along her bow. */
export function readOf(ctx, ids, t) {
  const r = ctx.sim.read(ids.hull);
  const v = r.velocity;
  return {
    t: +t.toFixed(3),
    awa: +(r.apparentWind.angle * DEG).toFixed(2),
    speed: +r.speed.toFixed(3),
    sog: +Math.hypot(v[0], v[2]).toFixed(3),
    heading: +(r.heading * DEG).toFixed(2),
  };
}

/**
 * Lay her to her anchor and leave it, as sailing-run does, on a timeline
 * of world times (s):
 * - `lay`: the hull put head to wind where `at` says (an editor's move: she
 *   restarts at rest there), main down and sheeted in, anchor down on 25 m;
 *   or, `anchored`, the template's own Ship at anchor from t = 0;
 * - `eased`: the main's sheet eased to ½;
 * - `hoist` for `hoistFor` s at the mast, then `raise` until raised > 0.95
 *   at the helm (each a held halyard, B's);
 * - `weigh`: B holds the windlass until the anchor is up;
 * - `leave`: when the probe reads the HUD after walking back to the wheel.
 * `main: false` skips the halyard (sails down). Returns her read at the
 * frame the anchor comes up and at `leave`, each with the HUD's advice, and
 * `onFrame(ctx, ids, t)` sees every frame from `lay` on.
 */
export async function replay({ sea, wind, anchored = false, lay = 0, at = null, eased = lay, hoist = null, hoistFor = 0.35, raise = null, weigh, leaveAfter = 1.5, main = true, onFrame = null, settle = null }) {
  const { doc, ids, content } = await anchorage({ sea, wind, anchored });
  const w = fakeWorld(doc, { content });
  try {
    const A = play(w.join("A"));
    const bApi = w.join("B");
    const B = play(bApi);
    settle?.(doc, ids);
    if (!anchored) {
      // the template's under way; laid at anchor at `lay`, an editor's move, from rest
      doc.clock = { running: true, t: lay };
      delete doc.objects[ids.hull].traits[SHIP].motion;
      const o = doc.objects[ids.hull];
      if (at) o.transform.position = [at[0], o.transform.position[1], at[2]];
      o.transform.rotation[1] = headTo(doc.traits[WEATHER].wind.from);
      Object.assign(doc.objects[ids.rig].traits[SAIL], { raised: 0, sheet: 0 });
      Object.assign(doc.objects[ids.windlass].traits[ANCHOR], { down: true, rode: RODE });
    } else doc.clock = { running: true, t: lay };
    const t = () => w.clock.t;
    let held = null; // { trim, until(t) → done? }
    let state = "anchored";
    const out = { ids, up: null, leave: null };
    let leaveAt = Infinity;
    const startHalyard = (until) => {
      const release = bApi.claim(ids.rig, STATION);
      const v = Number(B.sim.value(ids.rig).raised) || 0;
      held = {
        until,
        trim: heldTrim({ value: v, goal: 1, rate: RAISE_RATE, input: (x) => B.sim.input(ids.rig, { raised: x }), commit: (x) => B.sim.commit(ids.rig, { raised: x }), alive: () => true, done: release }),
      };
    };
    let last = t();
    for (let frame = 0; frame < 60 * 600; frame++) {
      w.tick(FRAME, 1);
      const now = t();
      const dt = now - last;
      last = now;
      onFrame?.(A, ids, now, w, state);
      if (state === "anchored" && now >= eased) {
        B.sim.commit(ids.rig, { sheet: 0.5 });
        state = main && hoist != null ? "toHoist" : main && raise != null ? "toRaise" : "toWeigh";
      }
      if (held) {
        held.trim.update(dt);
        if (!held.trim.open || held.until(now)) {
          held.trim.end();
          held = null;
          // the anchor up: her read at this frame, as the windlass lets go
          if (state === "weighing") {
            out.up = { ...readOf(A, ids, now), advice: adviceOf(A, ids) };
            state = "leaving";
            leaveAt = now + leaveAfter;
          }
        }
        continue;
      }
      if (state === "toHoist" && now >= hoist) {
        const end = hoist + hoistFor;
        startHalyard((n) => n >= end);
        state = raise != null ? "toRaise" : "toWeigh";
      } else if (state === "toRaise" && now >= raise) {
        startHalyard(() => Number(A.sim.value(ids.rig).raised) > 0.95);
        state = "toWeigh";
      } else if (state === "toWeigh" && now >= weigh) {
        const release = bApi.claim(ids.windlass, STATION);
        held = {
          until: () => false,
          trim: heldWeigh({ rode: B.sim.value(ids.windlass).rode, input: (f) => B.sim.input(ids.windlass, f), commit: (f) => B.sim.commit(ids.windlass, f), done: release }),
        };
        state = "weighing";
      } else if (state === "leaving" && now >= leaveAt) {
        out.leave = { ...readOf(A, ids, now), advice: adviceOf(A, ids) };
        return out;
      }
    }
    throw new Error(`replay: never reached the leave (${state} at ${t()})`);
  } finally {
    w.done();
  }
}

export { DEG };
