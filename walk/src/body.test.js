// The walk body on supports (DESIGN.md, "Standing on supports", step 4's
// tables), on a stand-in stage (test/stage.js): where it enters, riding a
// moving deck, a rebake under the feet, waiting for the first meshes, and
// the body's contract (keys, lock, reach, presses, waiting under a seat).
// Every frame the body checks invariant I itself (it throws while asserting,
// as under vitest).

import { describe, it, expect } from "vitest";
import { REACH, SPAWN, WALK_KEYS, aimOf, walkBody } from "./body.js";
import { createSupports, frameOf } from "./supports.js";
import { BODY, lookDir } from "./walk.js";
import { apply, multiply } from "./frames.js";
import * as walker from "./walker.js";
import { plugins } from "./index.js";
import { model, stage } from "./test/stage.js";

const close = (a, b, tol = 1e-5) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** A turn about +Y by yaw, then a translation, column-major. */
const M = (yaw, [x, y, z]) => [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, x, y, z, 1];
/** A heel: a turn about +Z (her fore-and-aft axis) by a. */
const heel = (a) => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const FWD = { code: "KeyW" };

/** The ground: a 20 × 20 m slab (top at 0), a 1 m crate 0.4 high at (3, 3), and a spawn point (no model) at (-4, 2), facing +X. */
const groundObjects = () => ({
  floor: { tris: model([-10, -0.2, -10], [10, 0, 10]) },
  crate: { transform: { position: [3, 0, 3] }, tris: model([-0.5, 0, -0.5], [0.5, 0.4, 0.5]) },
  pad: { transform: { position: [-4, 0, 2], rotation: [0, -Math.PI / 2, 0] }, traits: { [SPAWN]: {} } },
});
/** The same ground with no spawn of its own, and a 4 × 4 m deck (walk.support) drawn at DECK, its spawn at (1, 1) on it. */
const DECK = M(0.3, [5, 1.5, -5]);
const deckObjects = () => {
  const { floor, crate } = groundObjects();
  return {
    floor,
    crate,
    deck: { transform: { position: [5, 1, -5] }, traits: { "walk.support": {} }, tris: model([-2, -0.3, -2], [2, 0, 2]) },
    deckpad: { parent: "deck", transform: { position: [1, 0, 1] }, traits: { [SPAWN]: {} } },
  };
};
const WORLDS = {
  "ground only": () => ({ objects: groundObjects() }),
  "a moving deck": () => ({ objects: deckObjects(), deck: DECK }),
};
/** Enter walk in a world, the deck (if any) drawn where it is, and run two frames. */
const enterIn = (w, place, camera) => {
  const f = stage({ objects: w.objects, camera });
  if (w.deck) f.pose("deck", w.deck);
  const supports = createSupports(f.api);
  const s = walkBody(f.api, supports).enter(place);
  const first = s.state;
  f.frames(90); // (from the eye, falling onto the floor under it)
  return { f, s, env: supports.env, first };
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

describe("where a walk starts: place × world", () => {
  // place: a spawn point; the eye over a floor; the eye over nothing (a spawn then); a support's id (in
  // the ground-only world, an object that isn't one: P1 at it)
  const PLACES = {
    "spawn object": (world) => ({ place: world === "ground only" ? "pad" : "deckpad" }),
    "eye over floor": (world) => ({ camera: world === "ground only" ? { position: [0, 5, 0], target: [0, 5, -1] } : { position: [5, 6.5, -5], target: [5, 6.5, -6] } }),
    "eye over nothing": () => ({ camera: { position: [50, 5, 50], target: [50, 5, 49] } }),
    "support id": (world) => ({ place: world === "ground only" ? "crate" : "deck" }),
  };
  const deckPad = apply(DECK, [1, 0, 1]);
  // expected: [on, world feet, world yaw]
  const EXPECT = {
    "ground only": {
      "spawn object": [null, [-4, 0, 2], -Math.PI / 2],
      "eye over floor": [null, [0, 0, 0], 0],
      "eye over nothing": [null, [-4, 0, 2], -Math.PI / 2],
      "support id": [null, [3, 0.4, 3], 0],
    },
    "a moving deck": {
      "spawn object": ["deck", deckPad, 0.3],
      "eye over floor": ["deck", [5, 1.5, -5], 0],
      "eye over nothing": ["deck", deckPad, 0.3],
      "support id": ["deck", deckPad, 0.3],
    },
  };
  for (const world of Object.keys(WORLDS))
    for (const place of Object.keys(PLACES))
      it(`${place} × ${world}`, () => {
        const ask = PLACES[place](world);
        const { f, s, env, first } = enterIn(WORLDS[world](), ask.place ?? null, ask.camera);
        // from the eye: at the eye lowered by BODY.eye, falling onto the floor under it
        if (place === "eye over floor") expect([first.mode, ...first.feet]).toEqual(["falling", ask.camera.position[0], ask.camera.position[1] - BODY.eye, ask.camera.position[2]]);
        const [on, feet, yawW] = EXPECT[world][place];
        const st = s.state;
        expect([st.mode, st.on]).toEqual(["walking", on]);
        expect(close(st.feet, feet), `${st.feet} vs ${feet}`).toBe(true);
        const heading = on ? Math.atan2(DECK[8], DECK[10]) : 0;
        expect(wrap(st.yaw + heading - yawW)).toBeCloseTo(0, 9);
        expect(walker.checkWalker(st.walker, env)).toEqual([]);
        // the eye: BODY.eye up the support's +Y from the feet
        const eye = on ? apply(frameOf(f.api, "deck"), [st.local[0], st.local[1] + BODY.eye, st.local[2]]) : [feet[0], feet[1] + BODY.eye, feet[2]];
        expect(close(s.eye().position, eye)).toBe(true);
        s.leave();
      });
  it("is 8 rows", () => expect(Object.keys(WORLDS).length * Object.keys(PLACES).length).toBe(8));

  it("the first mesh is baked when first needed: entering, the walker stands at once (camera placed, avatar said)", () => {
    // a ground no test has baked before (meshes are cached for the page by key)
    const objects = { ...groundObjects(), crate: { transform: { position: [3, 0, -3] }, tris: model([-0.5, 0, -0.5], [0.5, 0.4, 0.5]) } };
    const f = stage({ objects });
    const s = walkBody(f.api).enter("pad");
    expect(s.state.mode).toBe("walking");
    expect(f.calls.camera.length).toBe(1);
    expect(f.calls.presence.avatar.on).toBe(null);
  });

  it("a model not loaded yet holds its support's first mesh back (it waits: no camera move, no avatar); told it loaded, the walk starts", () => {
    const objects = groundObjects();
    objects.floor.loaded = false;
    const f = stage({ objects });
    const supports = createSupports(f.api);
    const s = walkBody(f.api, supports).enter("pad");
    f.frames(5);
    expect(s.state.mode).toBe("waiting");
    expect(f.calls.camera).toEqual([]);
    expect(f.calls.presence.avatar).toBeUndefined();
    objects.floor.loaded = true;
    supports.changed();
    f.frames(2);
    expect(s.state.mode).toBe("walking");
  });
});

describe("riding a moving support: move × walker", () => {
  // the deck moves over 30 frames from DECK by: a translation, a 90° turn about her +Y, a 30° heel
  const MOVES = {
    translate: (t) => multiply(DECK, M(0, [2 * t, 0.5 * t, -1 * t])),
    "turn 90°": (t) => multiply(DECK, M((Math.PI / 2) * t, [0, 0, 0])),
    "heel 30°": (t) => multiply(DECK, heel((Math.PI / 6) * t)),
  };
  const run = (move, walking) => {
    const f = stage({ objects: deckObjects() });
    f.pose("deck", DECK);
    const s = walkBody(f.api).enter("deckpad");
    f.frames(2);
    if (walking) s.input.key(FWD);
    const locals = [];
    for (let i = 1; i <= 30; i++) {
      if (move) f.pose("deck", MOVES[move](i / 30));
      f.frames(1);
      const st = s.state;
      // the invariant: the world pose is the drawn frame times the local feet, never fed back
      expect(st.on).toBe("deck");
      expect(st.feet).toEqual(apply(frameOf(f.api, "deck"), st.local));
      locals.push(st.local);
    }
    s.leave();
    return locals;
  };
  const still = { standing: run(null, false), walking: run(null, true) };
  for (const move of Object.keys(MOVES))
    for (const walking of [false, true])
      it(`${move} × ${walking ? "walking forward" : "standing"}: the local feet are the still deck's, to the bit`, () => {
        const locals = run(move, walking);
        expect(locals).toEqual(still[walking ? "walking" : "standing"]);
        if (!walking) for (const l of locals) expect(l).toEqual(locals[0]);
        else expect(locals.at(-1)[2]).toBeLessThan(locals[0][2] - 1);
      });
});

describe("a rebake under you → P1 (R1)", () => {
  const atOrigin = { position: [0, 1.6, 0], target: [0, 1.6, -1] };
  it("a part added where you stand: the next mesh lands off the loop, and you're projected onto it (on the box)", () => {
    const objects = groundObjects();
    const f = stage({ objects, camera: atOrigin });
    const supports = createSupports(f.api);
    const s = walkBody(f.api, supports).enter(null);
    f.frames(3);
    const before = s.state;
    expect(close(before.feet, [0, 0, 0])).toBe(true);
    objects.box = { transform: { position: [0, 0, 0] }, tris: model([-0.6, 0, -0.6], [0.6, 0.3, 0.6]) };
    supports.changed();
    f.frames(1); // the new key is seen and its bake queued; the old mesh still in use
    expect(s.state.walker.mesh).toBe(before.walker.mesh);
    f.frames(1);
    const want = walker.place(supports.env, null, before.local);
    expect([s.state.mode, s.state.walker.cell, s.state.walker.u, s.state.walker.v]).toEqual([want.mode, want.cell, want.u, want.v]);
    expect(s.state.walker.mesh).not.toBe(before.walker.mesh);
    expect(s.state.feet[1]).toBeCloseTo(0.3, 5);
  });

  it("the floor removed: P1 finds no cell and no water, so you fall from where you stood", () => {
    const objects = groundObjects();
    const f = stage({ objects, camera: atOrigin });
    const supports = createSupports(f.api);
    const s = walkBody(f.api, supports).enter(null);
    f.frames(3);
    const before = s.state;
    delete objects.floor;
    supports.changed();
    f.frames(2);
    expect(s.state.mode).toBe("falling");
    expect(close(s.state.feet, before.feet, 1e-9)).toBe(true);
    f.frames(1);
    expect(s.state.feet[1]).toBeLessThan(before.feet[1]);
  });
});

describe("the walk body", () => {
  it("is `walk`: the walking keys, the pointer locked, 2 m of reach", () => {
    const b = walkBody(stage({ objects: groundObjects() }).api);
    expect(b).toMatchObject({ id: "walk", label: "Walk", keys: WALK_KEYS, lock: true, reach: REACH });
    expect(WALK_KEYS.map((k) => k.code)).toEqual(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
    expect(plugins.find((p) => p.id === "walk.spawn").describes[SPAWN].name).toBe("Spawn point");
  });

  it("walks on W, holds the camera, says where it is at 20 Hz; leaving gives it all back", () => {
    const f = stage({ objects: groundObjects(), camera: { position: [0, 1.6, 5], target: [0, 1.6, 0] } });
    const s = walkBody(f.api).enter(null);
    f.frames(2);
    expect(f.calls.holds).toBe(1);
    expect(close(s.state.feet, [0, 0, 5])).toBe(true);
    s.input.key(FWD);
    f.frames(60);
    expect(s.state.feet[2]).toBeLessThan(2);
    expect(close(s.eye().position, [s.state.feet[0], s.state.feet[1] + BODY.eye, s.state.feet[2]], 1e-9)).toBe(true);
    expect(f.calls.presence.avatar).toMatchObject({ on: null, swimming: false });
    expect(f.calls.rate).toEqual([20]);
    s.leave();
    expect(f.calls.released).toBe(1);
    expect(f.calls.presence.avatar).toBeUndefined();
    expect(f.loops).toEqual([]);
  });

  it("waits under another body (camera let go, loop stopped, avatar withdrawn); when it goes, P1 of its eye less BODY.eye (beside a seat)", () => {
    const f = stage({ objects: groundObjects() });
    const s = walkBody(f.api).enter(null);
    f.frames(2);
    s.input.key(FWD);
    s.input.suspended();
    expect(f.calls.released).toBe(1);
    expect(f.loops).toEqual([]);
    expect(f.calls.presence.avatar).toBeUndefined();
    // a seat put the view 1.15 m over the floor
    f.api.camera.set({ position: [7, 1.15, -1], target: [7, 1.15, -2] });
    s.input.resumed();
    expect(f.calls.holds).toBe(2);
    expect([s.state.mode, ...s.state.feet.map((v) => +v.toFixed(5) + 0)]).toEqual(["walking", 7, 0, -1]);
    f.frames(5);
    // the key went up while it waited: it stands
    expect(s.state.feet[2]).toBeCloseTo(-1, 9);
  });

  it("presses: without the lock a drag looks round and a tap goes on as a click; under it a press is nothing", () => {
    const f = stage({ objects: groundObjects() });
    const s = walkBody(f.api).enter(null);
    f.frames(2);
    const look = s.input.press({ button: 0, locked: false, clientX: 0, clientY: 0 });
    look.move({ clientX: 100, clientY: 0 });
    expect(s.state.yaw).not.toBe(0);
    expect(look.tap()).toBe(false);
    expect(s.input.press({ button: 0, locked: true })).toBe(null);
    expect(s.input.wheel()).toBe(true);
  });

  it("aim is lookDir's inverse", () => {
    const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);
    for (const yaw of [-2, -0.5, 0, 1, 2.5]) for (const pitch of [-1, 0, 0.6]) expect(r6(Object.values(aimOf(lookDir(yaw, pitch))))).toEqual(r6([yaw, pitch]));
  });
});
