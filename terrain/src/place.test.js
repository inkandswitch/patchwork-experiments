// The place (terrain.place, place.js): which object it is, and that it gives
// no sky. A place's sky is its world's weather (the weather package's trait,
// which the templates write: template.test.js, template-ucluelet.test.js).
import { describe, it, expect } from "vitest";
import { placeObject, PLACE } from "./place.js";
import { layOut } from "./template-ucluelet.js";
import { layOut as layOutCadboro } from "./template.js";
import { plugins } from "./index.js";
import { sceneCtx } from "./test/scene-ctx.js";

describe("the trait", () => {
  it("has no fields: it says only that this object is the place", () => {
    const d = plugins.find((x) => x.id === PLACE).describes[PLACE];
    expect(d.on).toBe("object");
    expect(d.fields ?? []).toEqual([]);
    expect(d.init ?? {}).toEqual({});
  });
});

describe("which object is the place", () => {
  // [objects, the place]
  it.each([
    [{}, null],
    [{ a: { traits: {} } }, null],
    [{ b: { traits: { [PLACE]: {} } } }, "b"],
    [{ b: { traits: { [PLACE]: {} } }, a: { visible: false, traits: { [PLACE]: {} } }, c: { traits: { [PLACE]: {} } } }, "b"],
    [{ c: { traits: { [PLACE]: {} } }, a: { traits: { [PLACE]: {} } } }, "a"],
    [{ a: { visible: false, traits: { [PLACE]: {} } } }, null],
    [{ a: { traits: { "terrain.sky": {} } } }, null],
  ])("%j → %j", (objects, want) => expect(placeObject({ objects })).toBe(want));
  it("no doc, no place", () => {
    expect(placeObject(null)).toBe(null);
    expect(placeObject({})).toBe(null);
  });
});

describe("no terrain extension offers an ambient (the sky is the weather's)", () => {
  /** A stage's api enough for each extension to start on `doc`. */
  const apiOn = (doc) => ({ doc: () => doc, scene: () => doc, style() {}, overlay: () => document.createElement("div"), content: () => null, worldOf: () => null, invalidate() {} });
  const extensions = plugins.filter((p) => p.type === "scene:extension");
  it.each([
    ["Ucluelet", layOut],
    ["Cadboro Bay", layOutCadboro],
  ])("on %s's scene, made by its template, neither has an ambient", async (_, lay) => {
    const { ctx, scene } = sceneCtx({ sailing: true });
    await lay(ctx, "automerge:terrain", { seed: 7 });
    for (const p of extensions) {
      const ext = await p.load();
      const inst = ext.create(apiOn(scene.doc()));
      expect(inst.ambient, p.id).toBeUndefined();
      inst.update?.(scene.doc());
      expect("ambient" in inst, p.id).toBe(false);
      inst.dispose?.();
    }
  });
  it("the place still gives the water its shore and shelter (null until its GLB is here)", async () => {
    const { ctx, scene } = sceneCtx({ sailing: false });
    await layOut(ctx, "automerge:terrain", { seed: 7 });
    const inst = (await plugins.find((p) => p.id === PLACE).load()).create(apiOn(scene.doc()));
    expect(inst["water.shore"].v).toBe(1);
    expect(inst["water.shore"].profile([0, 2, 0])).toBe(null);
    expect(inst["water.shore"].exposure(300)).toBe(null);
  });
});

describe("a dry place's ground is dressed by update alone (no water asks for its shore)", () => {
  /** A mesh whose GLB gives it the grain, on its own material; a root holding it. */
  const rootWith = () => {
    const m = { name: "ground", needsUpdate: false };
    const mesh = { isMesh: true, material: m, geometry: { attributes: { _grain: {} } } };
    return { m, root: { traverse: (f) => f(mesh) } };
  };
  const dressed = (m) => m.customProgramCacheKey?.() === "|terrain-grain";
  // a dry place (the trait, no water) and what the stage gives, step by step: [the place shown, its content] → which root's material is dressed
  const A = rootWith(), B = rootWith();
  const steps = [
    ["shown, GLB not here", true, null, []],
    ["shown, GLB loading", true, { loaded: false, root: A.root }, []],
    ["shown, GLB here", true, { loaded: true, root: A.root }, [A]],
    ["shown, a new GLB", true, { loaded: true, root: B.root }, [B]],
    ["hidden", false, { loaded: true, root: B.root }, []],
  ];
  it("each step's update dresses the place's loaded root and only it; dispose puts it back", async () => {
    let shown = true, content = null, invalidated = 0;
    const doc = () => ({ objects: { t: { visible: shown, traits: { [PLACE]: {} } } } });
    const api = { doc, scene: doc, content: (id) => (id === "t" ? content : null), worldOf: () => null, invalidate: () => invalidated++ };
    const inst = (await plugins.find((p) => p.id === PLACE).load()).create(api);
    for (const [name, s, c, want] of steps) {
      [shown, content] = [s, c];
      inst.update(doc());
      for (const r of [A, B]) expect(dressed(r.m), `${name}: ${r === A ? "A" : "B"}`).toBe(want.includes(r));
    }
    expect(invalidated).toBe(2); // once per root dressed
    [shown, content] = [true, { loaded: true, root: A.root }];
    inst.update(doc());
    expect(dressed(A.m)).toBe(true);
    inst.dispose();
    expect(dressed(A.m) || dressed(B.m)).toBe(false);
  });
});
