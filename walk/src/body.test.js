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

  it("a stand spot: at its `at`, facing its `facing`, not at its object's origin", () => {
    // a helm at (2, 0, -2) turned a quarter about +Y: its `at` (0, 0, 1) is the world's (3, 0, -2), facing back at the helm (world −X)
    const objects = { ...groundObjects(), helm: { transform: { position: [2, 0, -2], rotation: [0, Math.PI / 2, 0] }, traits: { "walk.stand": { at: [0, 0, 1], facing: [0, 0, 0] } } } };
    const { s } = enterIn({ objects }, "helm");
    expect([s.state.mode, ...s.state.feet.map((v) => +v.toFixed(6) + 0)]).toEqual(["walking", 3, 0, -2]);
    expect(wrap(s.state.yaw - Math.PI / 2)).toBeCloseTo(0, 9);
    s.leave();
  });

  it("the eye held low (1 m over the floor, under BODY.eye): on the floor under it at once, not at a spawn", () => {
    const f = stage({ objects: groundObjects(), camera: { position: [1, 1, 1], target: [1, 1, 0] } });
    const s = walkBody(f.api).enter(null);
    expect([s.state.mode, ...s.state.feet.map((v) => +v.toFixed(6) + 0)]).toEqual(["walking", 1, 0, 1]);
    s.leave();
  });

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
    Object.assign(objects.floor, { sourceUrl: "automerge:floor", loaded: false });
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

describe("on a support: presence while jumping, coming back from a station, a scaled support, the eye over a STEP", () => {
  it("jumping on the deck, presence still says the deck (airborne is on it)", () => {
    const f = stage({ objects: deckObjects() });
    f.pose("deck", DECK);
    const s = walkBody(f.api).enter("deckpad");
    f.frames(2);
    s.input.key({ code: "Space" });
    f.frames(6);
    expect([s.state.mode, s.state.on, f.calls.presence.avatar.on]).toEqual(["airborne", "deck", "deck"]);
    s.leave();
  });

  it("coming back from a body over it on a turned deck: looking the way the eye looked, in the world", () => {
    const f = stage({ objects: deckObjects() });
    f.pose("deck", DECK);
    const s = walkBody(f.api).enter("deckpad");
    f.frames(2);
    s.input.suspended();
    const at = apply(DECK, [0, BODY.eye, 0]);
    const d = lookDir(1, 0); // world yaw 1, where the deck's heading is 0.3
    f.api.camera.set({ position: at, target: [at[0] + d[0], at[1] + d[1], at[2] + d[2]] });
    s.input.resumed();
    expect(s.state.on).toBe("deck");
    expect(close(s.eye().direction, d, 1e-9)).toBe(true);
    s.leave();
  });

  // a body over walk (a stand spot's) puts its eye BODY.eye up the support's up from a point on the
  // deck; when it goes, walk stands exactly at P1 of that point, however the deck is heeled or turned
  const POSES = { still: M(0, [5, 1.5, -5]), turned: DECK, "heeled 20°": multiply(DECK, heel(0.35)), "heeled 30° the other way": multiply(M(2, [4, 2, -6]), heel(-0.52)) };
  for (const [name, pose] of Object.entries(POSES)) {
    it(`a body over walk on a deck ${name}: resumed, the feet are P1 of its eye less BODY.eye along the deck's up, to 1e-9`, () => {
      const f = stage({ objects: deckObjects() });
      f.pose("deck", pose);
      const supports = createSupports(f.api);
      const s = walkBody(f.api, supports).enter("deckpad");
      f.frames(2);
      s.input.suspended();
      const spot = apply(pose, [-0.7, 0, 0.4]); // a point on the deck's top
      const up = apply(pose, [0, 1, 0]).map((v, i) => v - pose[12 + i]);
      const eye = spot.map((v, i) => v + up[i] * BODY.eye);
      f.api.camera.set({ position: eye, target: [eye[0], eye[1], eye[2] - 1] });
      s.input.resumed();
      const want = walker.worldPose(walker.placeAt(supports.env, spot), supports.env).feet;
      expect(s.state.on).toBe("deck");
      expect(close(s.state.feet, want, 1e-9)).toBe(true);
      expect(close(s.state.feet, spot, 1e-9)).toBe(true);
      s.leave();
    });
  }

  // a stand spot (walk.stand) a body goes over walk at (a station): walk stands its walker at P1 of the
  // spot and that walker's eye is the body's; when the body goes, walk resumes at P1 of the eye less
  // BODY.eye along the deck's up, which is that same P1, however the deck is heeled or turned and wherever
  // the spot is set against the deck (on it, in the air over it, sunk into it: on the deck under it)
  const SPOT_Y = { "on the deck": 0, "0.3 m over it": 0.3, "0.2 m into it": -0.2 };
  for (const [name, pose] of Object.entries(POSES))
    for (const [where, h] of Object.entries(SPOT_Y)) {
      it(`a stand spot ${where}, the deck ${name}: stand() puts the eye BODY.eye up the deck's up over the deck under it; resumed there, the feet are that point, to 1e-9`, () => {
        const objects = { ...deckObjects(), post: { parent: "deck", transform: { position: [-0.7, 0, -0.1] }, traits: { "walk.stand": { at: [0, h, 0.5], claim: "post" } } } };
        const f = stage({ objects });
        f.pose("deck", pose);
        const def = walkBody(f.api);
        const s = def.enter("deckpad");
        f.frames(2);
        const at = def.stand("post");
        s.input.suspended();
        const feet = apply(pose, [-0.7, 0, 0.4]); // the deck's top under the spot
        const eye = apply(pose, [-0.7, BODY.eye, 0.4]);
        expect(close(at.eye(), eye, 1e-9)).toBe(true);
        expect(wrap(at.yaw - Math.atan2(pose[8], pose[10]))).toBeCloseTo(0, 9); // facing its origin: forward on the deck (its −Z)
        f.api.camera.set({ position: at.eye(), target: at.eye().map((v, i) => v - pose[8 + i]) });
        s.input.resumed();
        expect(s.state.on).toBe("deck");
        expect(close(s.state.feet, feet, 1e-9)).toBe(true);
        s.leave();
      });
    }

  it("stand(): null when not walking here, for an object that isn't a stand spot, and after walk leaves", () => {
    const objects = { ...deckObjects(), post: { parent: "deck", transform: { position: [-0.7, 0, -0.1] }, traits: { "walk.stand": { at: [0, 0, 0.5] } } } };
    const f = stage({ objects });
    f.pose("deck", DECK);
    const def = walkBody(f.api);
    expect(def.stand("post")).toBe(null);
    const s = def.enter("deckpad");
    f.frames(2);
    expect([def.stand("deck"), def.stand("crate"), def.stand("nothing")]).toEqual([null, null, null]);
    expect(def.stand("post")).not.toBe(null);
    s.leave();
    expect(def.stand("post")).toBe(null);
  });

  it("the avatar contribution: this viewer's walker here (on top or waiting under a body), null before and after", () => {
    const f = stage({ objects: deckObjects() });
    f.pose("deck", DECK);
    const def = walkBody(f.api);
    expect(def.avatar()).toBe(null);
    const s = def.enter("deckpad");
    f.frames(2);
    expect(def.avatar()).toEqual(f.calls.presence.avatar);
    expect(def.avatar().on).toBe("deck");
    s.input.suspended();
    expect(def.avatar()?.on).toBe("deck");
    expect(def.avatar()?.swimming).toBe(false);
    s.leave();
    expect(def.avatar()).toBe(null);
  });

  it("a support drawn at scale 2: its mesh in metres, its frame rigid (a spawn 1.5 of its units out is 3 m out)", () => {
    const objects = {
      deck: { transform: { position: [5, 1, -5], scale: 2 }, traits: { "walk.support": {} }, tris: model([-2, -0.3, -2], [2, 0, 2]) },
      pad: { parent: "deck", transform: { position: [1.5, 0, 0] }, traits: { [SPAWN]: {} } },
    };
    const f = stage({ objects });
    const s = walkBody(f.api).enter("pad");
    f.frames(2);
    expect([s.state.mode, s.state.on]).toEqual(["walking", "deck"]);
    expect(s.state.local.map((v) => +v.toFixed(9) + 0)).toEqual([3, 0, 0]);
    expect(s.state.feet.map((v) => +v.toFixed(9) + 0)).toEqual([8, 1, -5]);
    // her deck reaches 4 m out (2 units): walking 3.5 m along her −Z from the middle, still on her
    s.input.key(FWD);
    f.frames(48);
    expect([s.state.mode, s.state.on]).toEqual(["walking", "deck"]);
    expect(s.state.local[2]).toBeLessThan(-3);
    s.leave();
  });

  it("stepping up onto a platform: the drawn eye lags the step and eases up to it", () => {
    // a spawn 1 m short of a platform 0.4 high (a STEP) and 6 m long, facing it
    const objects = { floor: groundObjects().floor, platform: { tris: model([-1, 0, -6], [1, 0.4, 0]) }, at: { transform: { position: [0, 0, 1] }, traits: { [SPAWN]: {} } } };
    const f = stage({ objects });
    const s = walkBody(f.api).enter("at");
    f.frames(2);
    s.input.key(FWD);
    const lags = [];
    for (let i = 0; i < 40; i++) {
      f.frames(1);
      lags.push(+(s.eye().position[1] - f.calls.camera.at(-1).position[1]).toFixed(6));
    }
    expect(s.state.feet[1]).toBeCloseTo(0.4, 6);
    const first = lags.findIndex((v) => v > 0);
    expect(lags[first]).toBeGreaterThan(0.2); // most of the step, the frame it's taken
    expect(lags.slice(first).every((v, i, a) => i === 0 || v <= a[i - 1])).toBe(true); // easing up, never back
    expect(lags.at(-1)).toBe(0);
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

  it("when the body over it goes and P1 moves you (a seat's eye over the table), you look at what its view looked at, from where you stand", () => {
    const objects = { ...groundObjects(), table: { transform: { position: [3, 0, -3] }, tris: model([-0.5, 0, -0.5], [0.5, 0.7, 0.5]) } };
    const f = stage({ objects });
    const s = walkBody(f.api).enter(null);
    f.frames(2);
    s.input.suspended();
    const target = [3, 0.7, -2.7];
    f.api.camera.set({ position: [3.3, 1.15, -3.3], target });
    s.input.resumed();
    const eye = s.eye();
    const d = target.map((v, i) => v - eye.position[i]);
    const n = Math.hypot(...d);
    expect(Math.hypot(eye.position[0] - 3.3, eye.position[2] + 3.3)).toBeGreaterThan(0.3); // moved off the table
    expect(close(eye.direction, d.map((v) => v / n), 1e-9)).toBe(true);
    s.leave();
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
