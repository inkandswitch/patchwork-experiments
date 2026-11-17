// The input adapter (supports.js): what each support bakes, its key, the
// geometry read off content roots, the blockers drawn each frame, the water
// asked of the stage, and a ladder's Climb (spawn.js) from the water.

import { describe, it, expect } from "vitest";
import { bakeKey, bakedObjects, createSupports, orientedBox, ownerOf, seedsOf, trianglesOf } from "./supports.js";
import { walkBody, walkerOf } from "./body.js";
import { climbState } from "./spawn.js";
import { meetsBlock } from "./walker.js";
import { BODY } from "./walk.js";
import { matrixOf } from "./frames.js";
import { meshRoot, model, stage } from "./test/stage.js";

const tri = [0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("trianglesOf", () => {
  it("an instanced mesh of n instances is n copies, each through its instance matrix", () => {
    for (const n of [0, 1, 3]) {
      const inst = Array.from({ length: n }, (_, i) => matrixOf({ position: [10 * i, 0, 0] })).flat();
      const root = { ...meshRoot(tri), isInstancedMesh: true, count: n, instanceMatrix: { array: Float32Array.from(inst) } };
      const out = trianglesOf(root);
      expect(out.length).toBe(9 * n);
      for (let i = 0; i < n; i++) expect(out.slice(9 * i, 9 * i + 9)).toEqual(tri.map((v, k) => (k % 3 === 0 ? v + 10 * i : v)));
    }
  });
  it("an indexed mesh by its index; a node's own transform; hidden nodes left out", () => {
    const quad = { isMesh: true, position: { x: 1, y: 2, z: 3 }, geometry: { attributes: { position: { array: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], itemSize: 3, count: 4 } }, index: { array: [0, 1, 2, 0, 2, 3], count: 6 } }, children: [] };
    const hidden = { ...meshRoot(tri), visible: false };
    const out = trianglesOf({ children: [quad, hidden] });
    expect(out).toEqual([1, 2, 3, 2, 2, 3, 2, 2, 4, 1, 2, 3, 2, 2, 4, 1, 2, 4]);
  });
});

/**
 * A doc with every kind of object a support's bake must sort: the ground's
 * floor; a deck (a support) with a fitting, a hidden locker, a carried die,
 * a swept wheel with a spoke under it, a blocking boom with a block on it,
 * an ignored sail, a dinghy (a support of her own) in chocks with a thwart.
 */
const DOC = {
  floor: {},
  deck: { traits: { "walk.support": {} } },
  fitting: { parent: "deck" },
  locker: { parent: "deck", visible: false },
  inLocker: { parent: "locker" },
  die: { parent: "deck", traits: { "scene.carry": {} } },
  wheel: { parent: "deck", traits: { "walk.moves": { swept: "z" } } },
  spoke: { parent: "wheel" },
  boom: { parent: "deck", traits: { "walk.moves": { blocks: true } } },
  block: { parent: "boom" },
  sail: { parent: "deck", traits: { "walk.moves": {} } },
  dinghy: { parent: "deck", traits: { "walk.support": {} } },
  thwart: { parent: "dinghy" },
  group: { kind: "group" },
};
const sceneOf = (objects) => ({ objects, ids: Object.keys(objects), parents: new Map(Object.keys(objects).map((id) => [id, objects[id].parent ?? null])) });

describe("what each support bakes", () => {
  it("every object × its owner and its place in the bake (a table over the kinds)", () => {
    const sc = sceneOf(DOC);
    const owners = Object.fromEntries(Object.keys(DOC).map((id) => [id, ownerOf(sc, id)]));
    expect(owners).toEqual({ floor: null, deck: "deck", fitting: "deck", locker: "deck", inLocker: "deck", die: "deck", wheel: "deck", spoke: "deck", boom: "deck", block: "deck", sail: "deck", dinghy: "dinghy", thwart: "dinghy", group: null });
    expect(bakedObjects(sc, null)).toEqual([{ id: "floor", swept: null }]);
    expect(bakedObjects(sc, "deck")).toEqual([
      { id: "deck", swept: null },
      { id: "fitting", swept: null },
      { id: "spoke", swept: { part: "wheel", axis: 2 } },
      { id: "wheel", swept: { part: "wheel", axis: 2 } },
    ]);
    expect(bakedObjects(sc, "dinghy")).toEqual([{ id: "dinghy", swept: null }, { id: "thwart", swept: null }]);
  });

  it("seeds: a spawn at its origin facing its way, a stand at `at` facing `facing`, a ladder's top hanging at its origin; each in its owner's frame", () => {
    const sc = sceneOf({
      deck: { traits: { "walk.support": {} }, transform: { position: [100, 0, 0] } },
      sp: { parent: "deck", transform: { position: [1, 0, 0], rotation: [0, Math.PI / 2, 0] }, traits: { "walk.spawn": {} } },
      helm: { parent: "deck", transform: { position: [0, 0, 2] }, traits: { "walk.stand": { at: [0, 0, 1], facing: [0, 0, 0] } } },
      ladder: { parent: "deck", transform: { position: [2, 0, 0] }, traits: { "walk.ladder": { top: [-0.5, 0.5, 0] } } },
      ground: { traits: { "walk.spawn": {} } },
    });
    const r = (a) => a.map((v) => Math.round(v * 1e9) / 1e9 + 0);
    const seeds = seedsOf(sc, "deck").map((s) => ({ ...s, at: r(s.at), yaw: +s.yaw.toFixed(9) + 0, hook: s.hook && r(s.hook) }));
    expect(seeds).toEqual([
      { kind: "stand", id: "helm", at: [0, 0, 3], yaw: 0, hook: undefined },
      { kind: "ladder", id: "ladder", at: [1.5, 0.5, 0], hook: [2, 0, 0], yaw: +(Math.PI / 2).toFixed(9) },
      { kind: "spawn", id: "sp", at: [1, 0, 0], yaw: +(Math.PI / 2).toFixed(9), hook: undefined },
    ]);
    expect(seedsOf(sc, null).map((s) => s.id)).toEqual(["ground"]);
  });
});

describe("the bake key", () => {
  const objects = () => ({
    floor: { tris: model([-5, -0.2, -5], [5, 0, 5]) },
    deck: { transform: { position: [0, 2, 0] }, traits: { "walk.support": {} }, tris: model([-1, -0.2, -1], [1, 0, 1]) },
    box: { parent: "deck", transform: { position: [0.5, 0, 0] }, tris: model([-0.1, 0, -0.1], [0.1, 0.2, 0.1]) },
    door: { transform: { position: [3, 0, 0] }, traits: { "walk.moves": { blocks: true } }, tris: model([-0.5, 0, -0.05], [0.5, 2, 0.05]) },
  });
  it("is not changed by the support's drawn pose or a blocker's (door) pose; is by a part's transform, a model loading, a trait", () => {
    const o = objects();
    const f = stage({ objects: o });
    const k0 = [bakeKey(f.api, null), bakeKey(f.api, "deck")];
    f.pose("deck", matrixOf({ position: [3, 2.5, 1], rotation: [0.2, 1, 0] }));
    f.pose("door", matrixOf({ position: [3, 2, 0] }));
    expect([bakeKey(f.api, null), bakeKey(f.api, "deck")]).toEqual(k0);
    o.box.transform = { position: [0.6, 0, 0] };
    expect([bakeKey(f.api, null), bakeKey(f.api, "deck")]).toEqual([k0[0], expect.not.stringMatching(k0[1])]);
    o.floor.traits = { other: {} };
    expect(bakeKey(f.api, null)).not.toBe(k0[0]);
    o.floor.loaded = false;
    expect(bakeKey(f.api, null)).toBe(null);
  });
});

describe("blockers: an oriented box drawn where it is, in the walker's support's frame", () => {
  // a corridor 2 m wide along -Z, a door across it at z = -3 (its box 2 × 2.4 × 0.1), a deck elsewhere
  const corridor = () => ({
    floor: { tris: [...model([-1, -0.2, -10], [1, 0, 2]), ...model([-1.2, 0, -10], [-1, 3, 2]), ...model([1, 0, -10], [1.2, 3, 2])] },
    door: { transform: { position: [0, 0, -3] }, traits: { "walk.moves": { blocks: true } }, tris: model([-1, 0, -0.05], [1, 2.4, 0.05]) },
  });
  it("shut (drawn at its doc pose): walking up the corridor stops you short of it; open (drawn 2.4 m up), you walk through", () => {
    for (const open of [false, true]) {
      const f = stage({ objects: corridor(), camera: { position: [0, 1.6, 0], target: [0, 1.6, -1] } });
      if (open) f.pose("door", matrixOf({ position: [0, 2.4, -3] }));
      const s = walkBody(f.api).enter(null);
      f.frames(2);
      s.input.key({ code: "KeyW" });
      f.frames(90);
      const z = s.state.feet[2];
      if (open) expect(z).toBeLessThan(-4);
      else expect([z > -3 + 0.05 + BODY.radius - 1e-9, z < -3 + 0.05 + BODY.radius + 0.1]).toEqual([true, true]);
      s.leave();
    }
  });
  it("its box in a support's frame: the door's drawn box through the inverse of the deck's frame", () => {
    const f = stage({ objects: { ...corridor(), deck: { transform: { position: [0, 0, -3], rotation: [0, Math.PI / 2, 0] }, traits: { "walk.support": {} }, tris: model([-1, -0.1, -1], [1, 0, 1]) } } });
    const { env } = createSupports(f.api);
    const [onGround] = env.blockers(null);
    const [onDeck] = env.blockers("deck");
    expect(onGround.o.map((v) => +v.toFixed(9) + 0)).toEqual([0, 1.2, -3]);
    expect(onDeck.o.map((v) => +v.toFixed(9) + 0)).toEqual([0, 1.2, 0]);
    // the door runs along the deck's z: a body at her (0, 0.9) meets it, at her (0.5, 0) doesn't
    expect(meetsBlock([0, 0.9], 0, BODY.height, BODY.radius, onDeck)).toBe(true);
    expect(meetsBlock([0.5, 0], 0, BODY.height, BODY.radius, onDeck)).toBe(false);
    expect(orientedBox(matrixOf(null), { min: [0, 0, 0], max: [2, 2, 2] })).toEqual({ o: [1, 1, 1], A: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h: [1, 1, 1] });
  });
});

describe("water and the ladder", () => {
  // a 4 × 4 m deck (a support) afloat, her deck 0.5 above the water, a ladder over her +X side
  const afloat = () => ({
    deck: { transform: { position: [0, 0.5, 0] }, traits: { "walk.support": {} }, tris: model([-2, -1, -2], [2, 0, 2]) },
    ladder: { parent: "deck", transform: { position: [2.1, -0.5, 0] }, traits: { "walk.ladder": { top: [-0.6, 0.5, 0] } } },
    buoy: { transform: { position: [3.2, 0, 0] } },
    far: { transform: { position: [9, 0, 0] } },
  });
  it("water is asked leaving out every support's own (`not`: all their ids)", () => {
    const f = stage({ objects: afloat(), water: 0 });
    const { env } = createSupports(f.api);
    expect(env.water(5, 5)).toBe(0);
    expect(f.calls.waterNot.at(-1)).toEqual(["deck"]);
  });
  it("Climb: offered on the ladder only while you swim within reach of its foot; taken, you walk at its top on her", () => {
    for (const [place, offered] of [["buoy", true], ["far", false]]) {
      const f = stage({ objects: afloat(), water: 0, session: `s-${place}` });
      const s = walkBody(f.api).enter(place);
      f.frames(2);
      expect(s.state.mode).toBe("swimming");
      const w = walkerOf(`s-${place}`);
      expect([place, !!climbState("ladder", f.api.scene(), w)]).toEqual([place, offered]);
      expect(climbState("deck", f.api.scene(), w)).toBe(null);
      if (offered) {
        expect(w.climb("ladder")).toBe(true);
        expect([s.state.mode, s.state.on]).toEqual(["walking", "deck"]);
        expect(s.state.local[0]).toBeGreaterThan(1);
        expect(climbState("ladder", f.api.scene(), w)).toBe(null);
      }
      s.leave();
      expect(walkerOf(`s-${place}`)).toBe(null);
    }
  });
});
