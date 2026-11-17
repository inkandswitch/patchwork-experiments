// The crew over walk (DESIGN.md, "Play"; walk/DESIGN.md, "Bodies over
// walk"): the walk traits her parts write, part kind × hull; each station's
// body, take × leave, against a stand-in for the stage's body stack and for
// walk (its avatar here and its `stand`: where a walker stood at a spot has
// its eye is walk's, so the stand-in's eye is any point, and the crew must
// use exactly it); and what the viewer is doing, read from the top body and
// walk's avatar.

import { describe, it, expect } from "vitest";
import { REACH, createCrew, seatedView, viewerOf } from "./crew.js";
import * as parts from "./parts.js";
import { sloopObjects } from "./parts.js";
import { FIT, deckAt, deckSurfaceAt } from "./ship.js";
import { HALYARD, SHIP, STATION, WINCH, partsOf } from "./traits.js";
import { placeIn } from "./body.js";
import { apply, matrixOf, multiply } from "./frames.js";
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

/** A stand spot whose claim is the one its station's verb holds (stations.js): the station's own, the sail's halyard at the mast. */
const stand = (at, claim = STATION) => ({ "walk.stand": { at, claim } });
/** Exactly the walk traits each kind carries (in its own frame), on any hull. */
const WANT = {
  hull: { "walk.support": {} },
  rig: { "walk.moves": { blocks: true }, ...stand([0, -1.072511454, 0.6], HALYARD) },
  jib: { "walk.moves": {} },
  hook: { "walk.moves": {} },
  helm: { "walk.moves": { swept: "z" }, ...stand([0, -0.9, 0.6]), "walk.spawn": {} },
  mainsheet: stand([0, 0, 0.35]),
  mast: {},
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

  it("nothing else of hers carries a walk trait (but the other winch, as its pair): no object is only a spawn point", () => {
    for (const doc of Object.values(HULLS)) {
      const k = new Set([...Object.values(kinds(doc)), ...Object.keys(doc.objects).filter((id) => doc.objects[id].traits?.[WINCH]?.side === "starboard")]);
      expect(Object.keys(doc.objects).filter((id) => !k.has(id) && Object.keys(walkTraits(doc.objects[id])).length)).toEqual([]);
    }
  });

  it("each stock stand spot is on what's drawn there, in her frame: STAND_OFF aft of its station (ship.js deckSurfaceAt); a winch's across the well on the side deck (deckAt)", () => {
    const doc = HULLS["the stock sloop"];
    const k = kinds(doc);
    const sc = snapshot(doc);
    const spot = (kind) => apply(placeIn(sc, k[kind], k.hull), doc.objects[k[kind]].traits["walk.stand"].at);
    for (const [kind, station, off] of [["helm", "wheel", 0.6], ["mainsheet", "mainsheet", 0.35], ["windlass", "windlass", 0.6], ["rig", "rig", 0.6]]) {
      const [x, , z] = FIT[station].position;
      expect(close(spot(kind), [x, deckSurfaceAt(x, z + off), z + off])).toBe(true);
    }
    const [wx, , wz] = FIT.winch.position; // the port winch's: tailed from the starboard side deck, as far out as it is in
    expect(close(spot("winch"), [wx + 2.25, deckAt(wx + 2.25, wz), wz])).toBe(true);
  });
});

// ─── the station body over walk ─────────────────────────────────────────────

/** Her drawn pose: turned, heeled 20° and pitched a little, somewhere on the water. */
const POSE = matrixOf({ position: [40, 0.3, -25], rotation: [0.05, 2.1, 0.35], scale: 1 });
const STATIONS = ["helm", "mainsheet", "mast", "windlass", "winch"];
/** The object each station kind is taken at (the mast's: the sail's station, the rig, which carries its stand spot). */
const takenAt = (k, kind) => ({ helm: k.helm, mainsheet: k.mainsheet, mast: k.rig, windlass: k.windlass, winch: k.winch })[kind];

/**
 * A stand-in for the stage around the crew: her doc and drawn frame (`pose`,
 * which moves), a camera, and a body stack whose "walk" says its avatar here
 * and stands its walker at a spot (`stand`): its eye there is a point the
 * stand-in makes up from the spot and her pose now (walk's own geometry is
 * walk's, tested there), and resumed, it records where the eye was left.
 */
function harness(doc = stockSloop()) {
  const sc = snapshot(doc);
  const k = kinds(doc);
  let pose = POSE;
  const worldOf = (id) => (id === k.hull ? pose : doc.objects[id] ? multiply(pose, placeIn(sc, id, k.hull)) : null);
  const cam = { position: [0, 5, 10], target: [0, 0, 0] };
  const stack = [];
  const walk = { stood: [], resumedAt: null, eyeOf: (id) => apply(worldOf(id), [0.123, 1.7, -0.456]) };
  let crew = null;
  const walkHere = () => stack.some((s) => s.id === "walk");
  const api = {
    id: "sailing",
    scene: () => sc,
    worldOf,
    camera: { get: () => ({ ...cam }), set: (c) => Object.assign(cam, c), hold: () => () => {}, ride: () => () => {}, touched: () => true },
    view: { get: () => ({ pointer: { locked: true } }) },
    collect: (name) =>
      name === "avatar"
        ? [{ id: "walk", value: () => (walkHere() ? { on: k.hull, feet: [0, 0.72, 4.85], yaw: 0, pitch: 0, swimming: false } : null) }]
        : name === "stand"
          ? [{ id: "walk", value: (id) => (walkHere() && sc.objects[id]?.traits?.["walk.stand"] ? (walk.stood.push(id), { eye: () => walk.eyeOf(id), yaw: 0.3 }) : null) }]
          : [],
    body: {
      current: () => (stack.length ? { id: stack.at(-1).id, ext: stack.at(-1).ext, depth: stack.length, keys: stack.at(-1).keys } : { id: "look", depth: 0 }),
      enter(id, place) {
        if (id === "walk") return stack.push({ id, ext: "walk", sitting: {}, place, keys: [{ code: "KeyW", label: "Forward" }] }), true;
        if (id !== "station") return false;
        const sitting = crew.bodies[0].enter(place);
        return !!sitting && (stack.push({ id, ext: "sailing", sitting, keys: sitting.keys }), true);
      },
      leave() {
        const top = stack.pop();
        top?.sitting.leave?.();
        if (stack.at(-1)?.id === "walk") walk.resumedAt = [...cam.position];
        return !!top;
      },
      eye: () => null,
    },
  };
  crew = createCrew(api, { sim: { ships: () => [k.hull] }, sea: { world: () => true } });
  return { crew, api, k, cam, stack, walk, sc, move: (m) => (pose = m) };
}

describe("each station's body: kind × take / leave", () => {
  const rows = [];
  for (const kind of STATIONS) {
    rows.push(`${kind} × take`);
    it(`${kind} × take: walk under it, stood at the station's own stand spot; the eye exactly walk's eye there`, () => {
      const h = harness();
      const id = takenAt(h.k, kind);
      expect(h.sc.objects[id].traits["walk.stand"]).toBeTruthy();
      h.crew.take(id, { keys: [] });
      expect(h.stack.map((s) => s.id)).toEqual(["walk", "station"]);
      expect(h.walk.stood).toEqual([id]);
      expect(h.cam.position).toEqual(h.walk.eyeOf(id));
      expect(h.crew.me()).toMatchObject({ playing: true, station: id, on: h.k.hull });
    });
    rows.push(`${kind} × leave`);
    it(`${kind} × leave: the body pops, and walk resumes from walk's eye at the spot as she is drawn now (she moved)`, () => {
      const h = harness();
      const id = takenAt(h.k, kind);
      let left = 0;
      h.crew.take(id, { keys: [], left: () => left++ });
      h.move(matrixOf({ position: [41, 0.5, -26], rotation: [-0.1, 2.2, -0.3], scale: 1 }));
      h.crew.tick(1 / 60);
      h.crew.leave();
      expect(h.stack.map((s) => s.id)).toEqual(["walk"]);
      expect(h.walk.resumedAt).toEqual(h.walk.eyeOf(id));
      expect(left).toBe(1);
      expect(h.crew.me()).toMatchObject({ playing: true, station: null });
    });
  }
  it("is 10 rows", () => expect(rows.length).toBe(10));

  it("taking a station while walking in another stage (a harbour's ground): her walk is entered first, at her hull, and the station goes over it", () => {
    const h = harness();
    h.stack.push({ id: "walk", ext: "walk", sitting: {}, other: true }); // another stage's walk: its avatar isn't here
    const collect = h.api.collect;
    h.api.collect = (name) => (h.stack.some((s) => s.id === "walk" && !s.other) ? collect(name) : name === "avatar" ? [{ id: "walk", value: () => null }] : []);
    h.crew.take(h.k.windlass, { keys: [] });
    expect(h.stack.map((s) => [s.id, s.place ?? null])).toEqual([["walk", null], ["walk", h.k.hull], ["station", null]]);
    expect(h.walk.stood).toEqual([h.k.windlass]);
  });

  it("a station with no stand spot of its own, or walk not standing anyone there: no body", () => {
    const h = harness();
    expect(h.crew.take(h.k.mast, { keys: [] })).toBeTypeOf("function");
    expect(h.stack.map((s) => s.id)).toEqual(["walk"]);
    h.walk.eyeOf = () => null;
    h.crew.take(h.k.helm, { keys: [] });
    expect(h.stack.map((s) => s.id)).toEqual(["walk"]);
  });

  it("a station's body needs its verb: entering it bare does nothing, and the chip doesn't offer it", () => {
    const h = harness();
    expect(h.crew.bodies.map((b) => [b.id, b.here, b.reach])).toEqual([["station", false, REACH]]);
    expect(h.crew.bodies[0].enter(h.k.helm)).toBe(null);
  });

  it("the viewer's keys are the top body's: walk's walking, the station's at a station", () => {
    const h = harness();
    h.crew.start();
    expect(h.crew.me().keys).toEqual([{ code: "KeyW", label: "Forward" }]);
    h.crew.take(h.k.helm, { keys: [{ code: "KeyA", label: "Port" }] });
    expect(h.crew.me().keys).toEqual([{ code: "KeyA", label: "Port" }]);
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
