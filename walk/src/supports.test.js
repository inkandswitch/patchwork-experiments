// The input adapter (supports.js): what each support bakes, its key, the
// geometry read off content roots, the blockers drawn each frame, the water
// asked of the stage, and a ladder's Climb (spawn.js) from the water.

import { describe, it, expect } from "vitest";
import { MAX_COLUMNS, bakeInput, bakeKey, bakedObjects, blockersOf, createSupports, keptMeshes, orientedBox, ownerOf, seedsOf, trianglesOf } from "./supports.js";
import { walkBody, walkerOf } from "./body.js";
import spawnPart, { climbState, ladderFor } from "./spawn.js";
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

  it("a spawn point on an object with a stand spot is at that spot, facing its way: people come in where someone stands", () => {
    const sc = sceneOf({
      deck: { traits: { "walk.support": {} } },
      helm: { parent: "deck", transform: { position: [0, 0.5, 2], rotation: [0, 0.4, 0] }, traits: { "walk.stand": { at: [0, -0.5, 1] }, "walk.spawn": {} } },
    });
    const [stand, spawn] = ["stand", "spawn"].map((k) => seedsOf(sc, "deck").find((s) => s.kind === k));
    expect(spawn).toEqual({ ...stand, kind: "spawn" });
    expect(stand.at.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([+Math.sin(0.4).toFixed(9), 0, +(2 + Math.cos(0.4)).toFixed(9)]);
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
    Object.assign(o.floor, { sourceUrl: "automerge:floor", loaded: false });
    expect(bakeKey(f.api, null)).toBe(null);
  });
  it("is changed by each kind of seed moving: a spawn, a stand spot's `at`, a ladder's `top` (their links are in the mesh)", () => {
    const o = {
      deck: { traits: { "walk.support": {} }, tris: model([-2, -0.2, -2], [2, 0, 2]) },
      sp: { parent: "deck", traits: { "walk.spawn": {} } },
      helm: { parent: "deck", traits: { "walk.stand": { at: [0, 0, 1] } } },
      ladder: { parent: "deck", transform: { position: [2, -0.5, 0] }, traits: { "walk.ladder": { top: [-0.5, 0.5, 0] } } },
    };
    const f = stage({ objects: o });
    const keys = [bakeKey(f.api, "deck")];
    o.sp.transform = { position: [0.5, 0, 0] };
    keys.push(bakeKey(f.api, "deck"));
    o.helm.traits["walk.stand"] = { at: [0, 0, 1.5] };
    keys.push(bakeKey(f.api, "deck"));
    o.ladder.traits["walk.ladder"] = { top: [-0.6, 0.5, 0] };
    keys.push(bakeKey(f.api, "deck"));
    expect(new Set(keys).size).toBe(4);
  });
  it("a swept part is baked as its turn's solid about its own axis, placed as the part is (a spoke off its hub sweeps round the hub)", () => {
    // the wheel's hub at (1, 0.5, 0) on the deck, turning about its y; a 0.2 m spoke block 0.5 out along its x
    const o = {
      deck: { traits: { "walk.support": {} } },
      wheel: { parent: "deck", transform: { position: [1, 0.5, 0] }, traits: { "walk.moves": { swept: "y" } } },
      spoke: { parent: "wheel", transform: { position: [0.5, 0, 0] }, tris: model([-0.1, 0, -0.1], [0.1, 0.2, 0.1]) },
    };
    const f = stage({ objects: o });
    const t = bakeInput(f.api, "deck").triangles;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i++) (lo[i % 3] = Math.min(lo[i % 3], t[i])), (hi[i % 3] = Math.max(hi[i % 3], t[i]));
    const mid = lo.map((v, i) => +((v + hi[i]) / 2).toFixed(9) + 0);
    expect(mid).toEqual([1, 0.6, 0]); // round the hub, not round the spoke
    expect(hi[0] - 1).toBeGreaterThanOrEqual(Math.hypot(0.6, 0.1) - 1e-9); // reaching the spoke's far corner
  });
});

describe("what holds a support's bake back: only a model still coming (the stage's contentIn rule)", () => {
  // the ground (a floor and a spawn) and one more object, as the real stage's content(id) and status answer it
  const KINDS = {
    "a link (no GLB, ever)": [{ sourceUrl: "automerge:linked", providerId: "scene.link" }, { links: ["it"] }, false],
    "a model that failed": [{ sourceUrl: "automerge:broken" }, { status: { it: { state: "error" } } }, false],
    "a model with no provider": [{ sourceUrl: "automerge:odd" }, { status: { it: { state: "warn" } } }, false],
    "an object with no model": [{}, {}, false],
    "a model loading": [{ sourceUrl: "automerge:slow" }, { status: { it: { state: "loading" } } }, true],
  };
  for (const [kind, [fields, opts, holds]] of Object.entries(KINDS))
    it(`${kind}: ${holds ? "the walk waits for it" : "baked as nothing; the walk starts"}`, () => {
      const objects = { floor: { tris: model([-5, -0.2, -5], [5, 0, 5]) }, pad: { traits: { "walk.spawn": {} } }, it: { transform: { position: [2, 0, 2] }, ...fields } };
      const f = stage({ objects, ...opts });
      expect(bakeKey(f.api, null) === null).toBe(holds);
      const s = walkBody(f.api).enter("pad");
      f.frames(3);
      expect(s.state.mode).toBe(holds ? "waiting" : "walking");
      s.leave();
    });
  it("is 5 rows; a model that failed and then loads changes the key (it is baked in)", () => {
    expect(Object.keys(KINDS).length).toBe(5);
    const objects = { floor: { tris: model([-5, -0.2, -5], [5, 0, 5]) }, it: { sourceUrl: "automerge:late", tris: model([0, 0, 0], [1, 1, 1]), loaded: false } };
    const status = { it: { state: "error" } };
    const f = stage({ objects, status });
    const k0 = bakeKey(f.api, null);
    delete objects.it.loaded;
    delete status.it;
    expect(bakeKey(f.api, null)).not.toBe(k0);
    expect(bakeInput(f.api, null).triangles.length).toBe(9 * 24);
  });
});

describe("a support too big to bake, and the meshes the page keeps", () => {
  it("over the column cap: not baked, said once, never retried for that key; the walk waits; made small, it walks", () => {
    expect(MAX_COLUMNS).toBeGreaterThan(4.22e6); // E1M1's ground fits
    const objects = { floor: { tris: model([-10, -0.2, -10], [10, 0, 10]) }, pad: { traits: { "walk.spawn": {} } } };
    const f = stage({ objects });
    const supports = createSupports(f.api, BODY, { maxColumns: 1e4 }); // the floor is ~ 420 × 420 columns
    const s = walkBody(f.api, supports).enter("pad");
    f.frames(60);
    expect(s.state.mode).toBe("waiting");
    expect(f.calls.notices).toEqual([expect.stringMatching(/^The ground can't be walked on: it is 1\d\d,\d\d\d columns of 5 cm, and walk bakes at most 10,000 /)]);
    delete objects.floor;
    objects.small = { tris: model([-1, -0.2, -1], [1, 0, 1]) }; // (a model's own triangles aren't in the key: its url and transform are)
    supports.changed();
    f.frames(2);
    expect([s.state.mode, f.calls.notices.length]).toEqual(["walking", 1]);
    s.leave();
  });
  // Cadboro Bay's case (Decision 43): a 20 × 20 m ground the cap refuses, a 4 × 4 m deck over it that fits; the ground's spawn pad, the deck's
  // (meshes are kept for the page by key, and a key has the ground's ids, not its triangles: each test names its ground's own)
  const capped = (ground = {}, name = "floor") => ({
    [name]: { tris: model([-10, -0.2, -10], [10, 0, 10]), ...ground },
    pad: { transform: { position: [-4, 0, 2] }, traits: { "walk.spawn": {} } },
    deck: { transform: { position: [5, 1, -5] }, traits: { "walk.support": {} }, tris: model([-2, -0.3, -2], [2, 0, 2]) },
    deckpad: { parent: "deck", transform: { position: [1, 0, 1] }, traits: { "walk.spawn": {} } },
  });
  const READY = [
    // [the ground, entering at, its mode after 60 frames, on]
    ["refused", "deckpad", "walking", "deck"], // a refused support doesn't hold the walk back
    ["refused", "pad", "walking", "deck"], // a spawn on the refused ground: no floor there, so you fall, and start again on the deck (F4)
    ["loading", "deckpad", "waiting", null], // one still loading holds every walker back
    ["baked", "deckpad", "walking", "deck"],
  ];
  for (const [ground, place, mode, on] of READY)
    it(`readiness: the ground ${ground} × entering at ${place} → ${mode}`, () => {
      const f = stage({ objects: capped(ground === "loading" ? { sourceUrl: "automerge:floor", loaded: false } : {}, ground) });
      const supports = createSupports(f.api, BODY, { maxColumns: ground === "refused" ? 1e4 : MAX_COLUMNS });
      const s = walkBody(f.api, supports).enter(place);
      f.frames(300);
      expect([s.state.mode, s.state.on ?? null]).toEqual([mode, on]);
      expect(f.calls.notices.length).toBe(ground === "refused" ? 1 : 0);
      s.leave();
    });
  it("readiness is 4 rows", () => expect(READY.length).toBe(4));
  // (the ground refused and no other support: nothing can be walked, so the walk waits: the row above, "over the column cap")
  it("walking off a deck over a refused ground: no floor there (it isn't), so you fall, and land back on the deck's spawn (F4); never waiting", () => {
    const f = stage({ objects: capped({}, "off") });
    const supports = createSupports(f.api, BODY, { maxColumns: 1e4 });
    const s = walkBody(f.api, supports).enter("deckpad");
    f.frames(2);
    s.input.key({ code: "KeyW" });
    const modes = [];
    for (let i = 0; i < 300 && s.state.mode !== "falling"; i++) (f.frames(1), modes.push(s.state.mode));
    s.input.keyup({ code: "KeyW" });
    for (let i = 0; i < 400; i++) (f.frames(1), modes.push(s.state.mode));
    expect(modes.includes("waiting")).toBe(false);
    expect(modes.includes("falling")).toBe(true);
    expect([s.state.mode, s.state.on]).toEqual(["walking", "deck"]);
    s.leave();
  });
  it("a mesh is kept while a support uses it and no longer: five rebakes keep only the last; dispose lets it go", () => {
    const objects = { floor: { tris: model([-5, -0.2, -5], [5, 0, 5]) } };
    const f = stage({ objects, camera: { position: [0, 1.6, 0], target: [0, 1.6, -1] } });
    const supports = createSupports(f.api);
    const s = walkBody(f.api, supports).enter(null);
    f.frames(2);
    const keys = [bakeKey(f.api, null)];
    for (let i = 1; i <= 5; i++) {
      objects.box = { transform: { position: [i - 3, 0, 3] }, tris: model([-0.2, 0, -0.2], [0.2, 0.3, 0.2]) };
      supports.changed();
      f.frames(2);
      keys.push(bakeKey(f.api, null));
    }
    expect(new Set(keys).size).toBe(6);
    expect(keys.map((k) => keptMeshes().includes(k))).toEqual([false, false, false, false, false, true]);
    s.leave();
    supports.dispose();
    expect(keptMeshes().includes(keys[5])).toBe(false);
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
  it("only what is shown blocks: a door, hidden, under a hidden part, or carried, doesn't", () => {
    const sc = sceneOf({
      shown: { traits: { "walk.moves": { blocks: true } } },
      hidden: { visible: false, traits: { "walk.moves": { blocks: true } } },
      frame: { visible: false },
      inHidden: { parent: "frame", traits: { "walk.moves": { blocks: true } } },
      carried: { traits: { "walk.moves": { blocks: true }, "scene.carry": {} } },
      swept: { traits: { "walk.moves": { swept: "y" } } },
    });
    expect(blockersOf(sc)).toEqual(["shown"]);
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
  it("Climb: offered on the ladder, or on the support it hangs on (a thin ladder is easily looked past), only while you swim within reach of its foot; taken, you walk at its top on her", () => {
    for (const [place, offered, via] of [["buoy", true, "ladder"], ["far", false, "ladder"], ["buoy", true, "deck"], ["far", false, "deck"]]) {
      const f = stage({ objects: afloat(), water: 0, session: `s-${place}` });
      const s = walkBody(f.api).enter(place);
      f.frames(2);
      expect(s.state.mode).toBe("swimming");
      const w = walkerOf(`s-${place}`, f.api.url);
      expect([place, via, !!climbState(via, f.api.scene(), w)]).toEqual([place, via, offered]);
      expect([ladderFor(via, f.api.scene(), w), climbState("buoy", f.api.scene(), w)]).toEqual([offered ? "ladder" : null, null]);
      if (offered) {
        spawnPart.create(f.api).commands.find((c) => c.id === "climb").run(via);
        expect([s.state.mode, s.state.on]).toEqual(["walking", "deck"]);
        expect(s.state.local[0]).toBeGreaterThan(1);
        expect(climbState("ladder", f.api.scene(), w)).toBe(null);
      }
      s.leave();
      expect(walkerOf(`s-${place}`, f.api.url)).toBe(null);
    }
  });
  it("Climb finds the walker of its own doc: the same session walking another doc in the page is not it", () => {
    const other = stage({ objects: { floor: { tris: model([-5, -0.2, -5], [5, 0, 5]) } }, url: "automerge:other", session: "s" });
    const away = walkBody(other.api).enter(null);
    other.frames(2);
    const f = stage({ objects: afloat(), water: 0, url: "automerge:boat", session: "s" });
    const s = walkBody(f.api).enter("buoy");
    f.frames(2);
    const climb = spawnPart.create(f.api).commands.find((c) => c.id === "climb");
    expect(climb.state("ladder", { scene: f.api.scene() })).toEqual({ title: "Climb out of the water" });
    climb.run("ladder");
    expect([s.state.mode, s.state.on, f.calls.notices]).toEqual(["walking", "deck", []]);
    expect(away.state.mode).toBe("walking");
    s.leave();
    away.leave();
  });
});
