// The crew over walk (DESIGN.md, "Play"; walk/DESIGN.md, "Bodies over
// walk"): the walk traits her parts write, part kind × hull; each station's
// body, take × leave, against a stand-in for the stage's body stack whose
// walk resumes as walk does (P1 of the eye less BODY.eye along her up); and
// what the viewer is doing, read from the top body and walk's avatar.

import { describe, it, expect } from "vitest";
import { EYE, REACH, createCrew, seatedView, standEye, standOf, viewerOf } from "./crew.js";
import * as parts from "./parts.js";
import { sloopObjects } from "./parts.js";
import { FIT, deckSurfaceAt } from "./ship.js";
import { ANCHOR, HELM, HOOK, JIB, LADDER, MAINSHEET, SAIL, SHIP, WINCH, partsOf } from "./traits.js";
import { placeIn } from "./body.js";
import { apply, matrixOf, multiply, rotateM } from "./frames.js";
import { emptyScene, fakeDrop } from "./test/fakes.js";

const files = new Proxy({}, { get: () => ({ url: "automerge:f", hint: null }) });
const walkTraits = (o) => Object.fromEntries(Object.entries(o?.traits ?? {}).filter(([k]) => k.startsWith("walk.")));
const snapshot = (doc) => {
  const parents = new Map();
  for (const [id, o] of Object.entries(doc.objects)) parents.set(id, o.parent && doc.objects[o.parent] ? o.parent : null);
  return { objects: doc.objects, ids: doc.order, parents };
};
const close = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** The stock sloop's doc: her objects as sloopObjects writes them. */
function stockSloop() {
  const doc = emptyScene();
  let n = 0;
  for (const [id, o] of sloopObjects({ position: [0, 0, 0], yaw: 0 }, files, (p) => `${p}${++n}`)) {
    doc.objects[id] = o;
    doc.order.push(id);
  }
  return doc;
}

/** A hull made a ship by hand (camber's: her bow +X, a metre long scaled to 12 m), fitted out from the bin. */
async function camberHull() {
  const doc = emptyScene();
  doc.objects.hull = { name: "Hull", parent: null, transform: { position: [3, 0, -2], rotation: [0, 0.7, 0], scale: 12 }, traits: { [SHIP]: { frame: { position: [0.5, 0, 0], rotation: [0, -Math.PI / 2, 0] } } } };
  doc.order.push("hull");
  const { ctx } = fakeDrop(doc);
  for (const [part, at] of [["mast", [0.1, 0.1, 0]], ["wheel", [-0.3, 0.06, 0]], ["windlass", [0.35, 0.1, 0]], ["ladder", [0, 0.1, 0.12]], ["mainsheet", [-0.25, 0.06, 0]], ["winches", [-0.1, 0.1, -0.08]]])
    await parts[part].create(ctx, { parent: "hull", transform: { position: at } });
  return doc;
}

/** Each part kind's object in a fitted ship's doc. */
function kinds(doc) {
  const sc = snapshot(doc);
  const ship = Object.keys(doc.objects).find((id) => doc.objects[id].traits?.[SHIP]);
  const p = partsOf(sc, ship);
  const by = (pred) => Object.keys(doc.objects).find((id) => pred(doc.objects[id]));
  return {
    hull: ship,
    rig: p.sail,
    jib: p.jib,
    hook: p.hook,
    helm: p.helm,
    mainsheet: p.mainsheet,
    mast: by((o) => o.name === "Mast"),
    windlass: p.anchor,
    winch: by((o) => o.traits?.[WINCH]?.side === "port"),
    ladder: p.ladder,
  };
}

const stand = (at) => ({ "walk.stand": { at, claim: "stand" } });
/** Exactly the walk traits each kind carries (in its own frame), on any hull. */
const WANT = {
  hull: { "walk.support": {} },
  rig: { "walk.moves": { blocks: true } },
  jib: { "walk.moves": {} },
  hook: { "walk.moves": {} },
  helm: { "walk.moves": { swept: "z" }, ...stand([0, -0.9, 0.6]) },
  mainsheet: stand([0, 0, 0.35]),
  mast: stand([0, 0.377488546, 0.7]),
  windlass: stand([0, -0.038740851, 0.6]),
  winch: stand([2.25, -0.014028873, 0]),
  ladder: { "walk.ladder": { top: [-0.5, 0.028107697, 0] } },
};

describe("her parts' walk traits: part kind × hull", async () => {
  const HULLS = { "the stock sloop": stockSloop(), "a camber hull fitted out from the bin": await camberHull() };
  for (const [hull, doc] of Object.entries(HULLS))
    for (const [kind, want] of Object.entries(WANT))
      it(`${kind} × ${hull}`, () => {
        const id = kinds(doc)[kind];
        expect(id).toBeTruthy();
        expect(walkTraits(doc.objects[id])).toEqual(want);
      });
  it("is 20 rows", () => expect(Object.keys(HULLS).length * Object.keys(WANT).length).toBe(20));

  it("nothing else of hers carries a walk trait (but the other winch) save the stock sloop's spawn, at the helm's stand spot facing forward, with no model", () => {
    for (const doc of Object.values(HULLS)) {
      const k = new Set([...Object.values(kinds(doc)), ...Object.keys(doc.objects).filter((id) => doc.objects[id].traits?.[WINCH]?.side === "starboard")]);
      const others = Object.keys(doc.objects).filter((id) => !k.has(id) && Object.keys(walkTraits(doc.objects[id])).length);
      const spawn = others.map((id) => doc.objects[id]);
      if (doc === HULLS["the stock sloop"]) {
        expect(spawn.map(walkTraits)).toEqual([{ "walk.spawn": {} }]);
        expect(spawn[0].sourceUrl).toBe(null);
        expect(spawn[0].transform).toEqual({ position: [0, COCKPIT_FLOOR, FIT.wheel.position[2] + 0.6], rotation: [0, 0, 0], scale: 1 });
      } else expect(spawn).toEqual([]);
    }
  });

  it("each stock stand spot is on what's drawn there, STAND_OFF aft of its station (ship.js deckSurfaceAt), in her frame", () => {
    const doc = HULLS["the stock sloop"];
    const k = kinds(doc);
    const sc = snapshot(doc);
    for (const [kind, station, off] of [["helm", "wheel", 0.6], ["mainsheet", "mainsheet", 0.35], ["windlass", "windlass", 0.6], ["mast", "rig", 0.6]]) {
      const [x, , z] = FIT[station].position;
      const at = apply(placeIn(sc, k[kind], k.hull), doc.objects[k[kind]].traits["walk.stand"].at);
      expect(close(at, [x, deckSurfaceAt(x, z + off), z + off])).toBe(true);
    }
  });
});
const COCKPIT_FLOOR = 0.72;

// ─── the station body over walk ─────────────────────────────────────────────

/** Her drawn pose: turned, heeled 20° and pitched a little, somewhere on the water. */
const POSE = multiply(matrixOf({ position: [40, 0.3, -25], rotation: [0.05, 2.1, 0.35], scale: 1 }), matrixOf(null));
const upOf = (W) => rotateM(W, [0, 1, 0]);

/**
 * A stand-in for the stage around the crew: her doc and drawn frames (the
 * wheel drawn turned, the rig swung: play's, not where the doc puts them),
 * a camera, claims, and a body stack whose "walk" says its avatar here and,
 * resumed, asks P1 of the eye less EYE along her up (walk's rule).
 */
function harness(doc = stockSloop()) {
  const sc = snapshot(doc);
  const k = kinds(doc);
  const turned = { [k.helm]: matrixOf({ position: [0, 0, 0], rotation: [0, 0, 1.3], scale: 1 }), [k.rig]: matrixOf({ position: [0, 0, 0], rotation: [0, 0.8, 0], scale: 1 }) };
  const worldOf = (id) => (id === k.hull ? POSE : doc.objects[id] ? multiply(multiply(POSE, placeIn(sc, id, k.hull)), turned[id] ?? matrixOf(null)) : null);
  const cam = { position: [0, 5, 10], target: [0, 0, 0] };
  const claims = new Map();
  const stack = [];
  const walk = { asked: null, resumed: 0 };
  let crew = null;
  const api = {
    id: "sailing",
    scene: () => sc,
    worldOf,
    camera: { get: () => ({ ...cam }), set: (c) => Object.assign(cam, c), hold: () => () => {}, ride: () => () => {}, touched: () => true },
    view: { get: () => ({ pointer: { locked: true } }) },
    collect: (name) => (name === "avatar" ? [{ id: "walk", value: () => (stack.some((s) => s.id === "walk") ? { on: k.hull, feet: [0, 0.72, 4.85], yaw: 0, pitch: 0, swimming: false } : null) }] : []),
    claim: (id, kind) => (claims.has(`${id}/${kind}`) ? null : (claims.set(`${id}/${kind}`, true), () => claims.delete(`${id}/${kind}`))),
    body: {
      current: () => (stack.length ? { id: stack.at(-1).id, ext: stack.at(-1).ext, depth: stack.length } : { id: "look", depth: 0 }),
      enter(id, place) {
        if (id === "walk") return stack.push({ id, ext: "walk", sitting: {} }), true;
        if (id !== "station") return false;
        const sitting = crew.bodies[0].enter(place);
        return !!sitting && (stack.push({ id, ext: "sailing", sitting }), true);
      },
      leave() {
        const top = stack.pop();
        top?.sitting.leave?.();
        if (stack.at(-1)?.id === "walk") {
          const up = upOf(POSE);
          walk.asked = cam.position.map((v, i) => v - up[i] * EYE);
          walk.resumed++;
        }
        return !!top;
      },
      eye: () => null,
    },
  };
  crew = createCrew(api, { sim: { ships: () => [k.hull] }, sea: { world: () => true } });
  return { crew, api, k, cam, claims, stack, walk, sc };
}

/** Where a station's stand spot is in the world, from ship.js's geometry (not from the traits): her pose · the spot in her frame. */
const STATIONS = { helm: ["wheel", 0.6], mainsheet: ["mainsheet", 0.35], mast: ["rig", 0.6], windlass: ["windlass", 0.6] };
function spotOf(kind) {
  if (kind === "winch") {
    const [x, , z] = [1.3, 0, FIT.winch.position[2]]; // the port winch's: across the well, on the starboard side deck
    return apply(POSE, [x, FIT.winch.position[1] + -0.014028873, z]);
  }
  const [station, off] = STATIONS[kind];
  const [x, , z] = FIT[station].position;
  return apply(POSE, [x, deckSurfaceAt(x, z + off), z + off]);
}

describe("each station's body: kind × take / leave", () => {
  for (const kind of ["helm", "mainsheet", "mast", "windlass", "winch"]) {
    it(`${kind} × take: walk under it, the eye at its stand spot, EYE up her up, to 1e-9; the spot's stand claim held`, () => {
      const h = harness();
      const id = { helm: h.k.helm, mainsheet: h.k.mainsheet, mast: h.k.rig, windlass: h.k.windlass, winch: h.k.winch }[kind];
      h.crew.take(id, { keys: [] });
      expect(h.stack.map((s) => s.id)).toEqual(["walk", "station"]);
      const spot = spotOf(kind);
      const up = upOf(POSE);
      expect(close(h.cam.position, spot.map((v, i) => v + up[i] * EYE), kind === "winch" ? 1e-6 : 1e-9)).toBe(true);
      const at = standOf(h.sc, id);
      expect(at).toBe(kind === "mast" ? h.k.mast : id);
      expect([...h.claims.keys()]).toEqual([`${at}/stand`]);
      expect(h.crew.me()).toMatchObject({ playing: true, station: id, on: h.k.hull });
    });
    it(`${kind} × leave: the body pops, the claim goes, and walk is asked P1 of the stand spot, to 1e-9`, () => {
      const h = harness();
      const id = { helm: h.k.helm, mainsheet: h.k.mainsheet, mast: h.k.rig, windlass: h.k.windlass, winch: h.k.winch }[kind];
      let left = 0;
      h.crew.take(id, { keys: [], left: () => left++ });
      const want = standEye(h.sc, h.api.worldOf, id).feet;
      h.crew.leave();
      expect(h.stack.map((s) => s.id)).toEqual(["walk"]);
      expect(h.walk.resumed).toBe(1);
      expect(close(h.walk.asked, want)).toBe(true);
      expect(close(h.walk.asked, spotOf(kind), kind === "winch" ? 1e-6 : 1e-9)).toBe(true);
      expect([h.claims.size, left]).toEqual([0, 1]);
      expect(h.crew.me()).toMatchObject({ playing: true, station: null });
    });
  }
  it("is 10 rows", () => expect(5 * 2).toBe(10));

  it("the wheel drawn turned and the boom swung don't move a stand spot: it is placed by the doc", () => {
    const h = harness();
    const v = standEye(h.sc, h.api.worldOf, h.k.helm);
    expect(close(v.feet, apply(multiply(POSE, placeIn(h.sc, h.k.helm, h.k.hull)), [0, -0.9, 0.6]))).toBe(true);
  });

  it("a station's body needs its verb: entering it bare does nothing, and the chip doesn't offer it", () => {
    const h = harness();
    expect(h.crew.bodies.map((b) => [b.id, b.here, b.reach])).toEqual([["station", false, REACH]]);
    expect(h.crew.bodies[0].enter(h.k.helm)).toBe(null);
  });
});

// ─── what the viewer is doing ───────────────────────────────────────────────

describe("viewerOf: top body × walk's avatar here", () => {
  const BODIES = { look: { id: "look", depth: 0 }, walk: { id: "walk", ext: "walk", depth: 1 }, seat: { id: "seat", ext: "seats", depth: 2 } };
  const AVATARS = { none: null, "on her deck": { on: "hull", feet: [0, 0.72, 4], yaw: 0.5, pitch: -0.1, swimming: false }, swimming: { on: null, feet: [3, -1.3, 2], yaw: 0, pitch: 0, swimming: true } };
  for (const [b, body] of Object.entries(BODIES))
    for (const [a, avatar] of Object.entries(AVATARS))
      it(`${b} × ${a}`, () => {
        const v = viewerOf({ body, avatar });
        const walking = b === "walk" && !!avatar;
        expect([v.playing, v.on, v.swimming, v.station]).toEqual([walking, avatar?.on ?? null, walking && a === "swimming", null]);
      });
  it("at a station: playing on her, whatever is under it", () => {
    expect(viewerOf({ body: { id: "station", depth: 2 }, avatar: AVATARS["on her deck"], station: "w", ship: "hull", hint: "A / D steer" })).toMatchObject({ playing: true, on: "hull", station: "w", swimming: false, hint: "A / D steer" });
  });
  it("seatedView: a seat over the stage is seated; walk and her own station are not", () => {
    const api = (b) => ({ id: "sailing", body: { current: () => b } });
    expect([BODIES.look, BODIES.walk, BODIES.seat, { id: "station", ext: "sailing", depth: 2 }].map((b) => seatedView(api(b)))).toEqual([false, false, true, false]);
  });
});
