// For tests only: leaving the anchor replayed in node (DESIGN.md, "Leaving
// the anchor"). The stock sloop as a template lays her out, with her own
// GLBs' extras (her rig contract), on a fake stage whose sea is water's own
// evaluator (fakes.js, surface.js): two views, A computing the world and B
// the crew working the stations through the verbs' own held helpers
// (stations.js heldTrim, heldWeigh) under B's station claims, as
// sailing-run.mjs plays it in Chrome. What happens at each moment is a
// timeline of world times; the frame is the probe page's (1/60 s).
import { ANCHORAGE_AIR, WIND, layOutShip, headTo } from "../layout.js";
import { createSeaView } from "../sea-view.js";
import { bowOf, createSim, effectiveRode } from "../sim.js";
import { partGLB } from "../ship.js";
import { RAISE_RATE, heldTrim, heldWeigh } from "../stations.js";
import { hudModel } from "../hud.js";
import { shipFrame, toBody } from "../body.js";
import { quatFromEuler, rotateQ } from "../frames.js";
import { ANCHOR, RODE, SAIL, SEA, SHIP, STATION, WEATHER } from "../traits.js";
import { emptyScene, fakeDrop, fakeNode, fakeWorld } from "./fakes.js";
import { readGLB } from "./frame-hulls.js";

const FRAME = 1 / 60;
const DEG = 180 / Math.PI;

let glbs = null;
const stockGLBs = () => (glbs ??= { hull: readGLB(partGLB("hull").bytes), rig: readGLB(partGLB("rig").bytes) });

/**
 * The sloop laid out on a stage of two views, sea and weather seeded `sea`:
 * Ship at sea (the template's wind), or `anchored`, Ship at anchor (its own
 * air, as template.js lays it out).
 */
async function anchorage({ sea, anchored }) {
  const doc = emptyScene();
  const hull = await layOutShip(fakeDrop(doc).ctx, { wind: anchored ? ANCHORAGE_AIR : WIND, seed: sea, anchored });
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

/** A view running the parts the ships need: the sea and the sim, ticked in play.js's order. */
function play(api) {
  const view = { api, sea: createSeaView(api) };
  view.sim = createSim(api, view);
  api.loop(() => {
    view.sea.tick();
    view.sim.tick();
  });
  return view;
}

/**
 * The stock sloop's spec as her physics has it laid out on a stage (the
 * computing view's sim.stepped, after one frame): her contract, her bow's
 * fairlead, her freeboard.
 */
export async function stockSpec() {
  const { doc, ids, content } = await anchorage({ sea: 1, anchored: false });
  const w = fakeWorld(doc, { content });
  try {
    const A = play(w.join("A"));
    w.tick(FRAME, 1);
    return A.sim.stepped(ids.hull).spec;
  } finally {
    w.done();
  }
}

/**
 * How much chain her rode has to spare (m) as the computing view `A` holds
 * her now: the chain the physics holds her on (sim.js effectiveRode of the
 * windlass's rode) less the straight line from her bow's fairlead to where
 * the anchor lies, both from the spec her physics steps with. > 0: slack,
 * the anchor doesn't pull her; < 0: taut. null while the anchor's up.
 */
export function slackOf(w, A, ids) {
  const at = w.doc.objects[ids.windlass].traits[ANCHOR].at;
  const held = w.holds.get(ids.hull)?.transform;
  const v = A.sim.value(ids.windlass);
  const sp = A.sim.stepped(ids.hull)?.spec;
  if (!Array.isArray(at) || !held || !sp || v.down === false) return null;
  const body = toBody({ position: held.position, quaternion: quatFromEuler(held.rotation) }, shipFrame(A.api, ids.hull), held.scale ?? 1);
  const b = rotateQ(body.quaternion, bowOf(sp));
  const d = Math.hypot(at[0] - body.position[0] - b[0], at[1] - body.position[1] - b[1], at[2] - body.position[2] - b[2]);
  return effectiveRode(v.rode, at, sp) - d;
}

/** What a view's HUD advises, from hud.js's own model (its predicates, not copies of its thresholds), on that view's read of her. */
export function adviceOf(view, ids) {
  const v = (id) => view.sim.value(id);
  return hudModel({
    me: { playing: true, station: ids.wheel },
    read: view.sim.read(ids.hull),
    sail: v(ids.rig),
    jib: v(ids.jib),
    anchor: v(ids.windlass),
    stations: view.sim.stationsOf(ids.hull),
    models: view.sim.sailModels(ids.hull),
  }).advice;
}

/** A view's read of her, in degrees and m/s: the apparent wind off the bow (+ from starboard), her speed through the water (− astern). */
function readOf(view, ids) {
  const r = view.sim.read(ids.hull);
  return { awa: +(r.apparentWind.angle * DEG).toFixed(2), speed: +r.speed.toFixed(3) };
}

/**
 * A moment of the replay: its world time; A's read (the simulator's, as the
 * probe's marks record it), B's (the crew's, a publish behind, as B's HUD
 * reads it: the probe's gate), and B's HUD's advice.
 */
const moment = (A, B, ids, t) => ({ t: +t.toFixed(3), sim: readOf(A, ids), crew: readOf(B, ids), advice: adviceOf(B, ids) });

/**
 * Lay her to her anchor and leave it, as sailing-run does, on a timeline
 * of world times (s):
 * - `lay`: Ship at sea's hull put head to wind where `at` says (an
 *   editor's move: she restarts at rest there; `at` null, where the
 *   template put her), main down and sheeted in, anchor down on its full
 *   rode; or, `anchored`, the template's own Ship at anchor, its clock
 *   starting at `lay`;
 * - `eased`: the main's sheet eased to ½;
 * - `hoist` for `hoistFor` s at the mast, then `raise` until raised > 0.95
 *   at the helm (each a held halyard, B's); `main: false` skips both
 *   (sails down);
 * - `weigh`: B holds the windlass until the anchor is up;
 * - `leaveAfter` that, the probe reads the HUD, back at the wheel.
 * `onFrame({ w, A, B, ids, t, phase })` sees every frame from `lay` on
 * (`phase`: "anchored" until the windlass is held, "weighing", then
 * "leaving"). Returns the `up` and `leave` moments; given `end`, stops at
 * that world time and returns what it has.
 */
export async function replay({ sea, anchored = false, lay = 0, at = null, eased = lay, hoist = null, hoistFor = 0.35, raise = null, weigh, leaveAfter = 1.25, main = true, end = Infinity, onFrame = null }) {
  const { doc, ids, content } = await anchorage({ sea, anchored });
  const w = fakeWorld(doc, { content });
  try {
    const A = play(w.join("A"));
    const bApi = w.join("B");
    const B = play(bApi);
    doc.clock = { running: true, t: lay };
    if (!anchored) {
      // the template's under way; laid at anchor at `lay`, an editor's move, from rest
      delete doc.objects[ids.hull].traits[SHIP].motion;
      const o = doc.objects[ids.hull];
      if (at) o.transform.position = [at[0], o.transform.position[1], at[2]];
      o.transform.rotation[1] = headTo(doc.traits[WEATHER].wind.from);
      Object.assign(doc.objects[ids.rig].traits[SAIL], { raised: 0, sheet: 0 });
      Object.assign(doc.objects[ids.windlass].traits[ANCHOR], { down: true, rode: RODE });
    }
    const t = () => w.clock.t;
    let held = null; // { trim, until(t) → done? }
    let next = "eased"; // the next move on the timeline
    let phase = "anchored";
    const out = { ids, up: null, leave: null };
    let leaveAt = Infinity;
    const startHalyard = (until) => {
      const release = bApi.claim(ids.rig, STATION);
      const v = Number(B.sim.value(ids.rig).raised) || 0;
      held = {
        until,
        trim: heldTrim({ value: v, goal: 1, rate: RAISE_RATE, clock: () => bApi.clock.t(), input: (x) => B.sim.input(ids.rig, { raised: x }), commit: (x) => B.sim.commit(ids.rig, { raised: x }), alive: () => true, done: release }),
      };
    };
    for (let frame = 0; frame < 60 * 600; frame++) {
      w.tick(FRAME, 1);
      const now = t();
      if (now >= end) return out;
      onFrame?.({ w, A, B, ids, t: now, phase });
      if (next === "eased" && now >= eased) {
        B.sim.commit(ids.rig, { sheet: 0.5 });
        next = main && hoist != null ? "hoist" : main && raise != null ? "raise" : "weigh";
      }
      if (held) {
        held.trim.update();
        if (!held.trim.open || held.until(now)) {
          held.trim.end();
          held = null;
          // the anchor up: this frame, as the windlass lets go
          if (phase === "weighing") {
            out.up = moment(A, B, ids, now);
            phase = "leaving";
            leaveAt = now + leaveAfter;
          }
        }
        continue;
      }
      if (next === "hoist" && now >= hoist) {
        const until = hoist + hoistFor;
        startHalyard((n) => n >= until);
        next = raise != null ? "raise" : "weigh";
      } else if (next === "raise" && now >= raise) {
        startHalyard(() => Number(A.sim.value(ids.rig).raised) > 0.95);
        next = "weigh";
      } else if (next === "weigh" && now >= weigh) {
        const release = bApi.claim(ids.windlass, STATION);
        held = {
          until: () => false,
          trim: heldWeigh({ rode: B.sim.value(ids.windlass).rode, clock: () => bApi.clock.t(), input: (f) => B.sim.input(ids.windlass, f), commit: (f) => B.sim.commit(ids.windlass, f), done: release }),
        };
        next = null;
        phase = "weighing";
      } else if (phase === "leaving" && now >= leaveAt) {
        out.leave = moment(A, B, ids, now);
        return out;
      }
    }
    throw new Error(`replay: never reached the leave (${phase} at ${t()})`);
  } finally {
    w.done();
  }
}
