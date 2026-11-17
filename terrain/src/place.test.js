// The place (terrain.place, place.js): which object it is, and that it gives
// no sky. A place's sky is its world's weather (the weather package's trait,
// which the templates write: template.test.js, template-ucluelet.test.js).
import { describe, it, expect } from "vitest";
import { placeObject, PLACE } from "./place.js";
import { PLACE as TEMPLATE_PLACE } from "./template.js";
import { layOut } from "./template-ucluelet.js";
import { layOut as layOutCadboro } from "./template.js";
import { plugins } from "./index.js";
import { sceneCtx } from "./test/scene-ctx.js";

describe("the trait", () => {
  it("is terrain.place everywhere it is named: the extension's, the templates', the plugin's", () => {
    expect(PLACE).toBe("terrain.place");
    expect(TEMPLATE_PLACE).toBe(PLACE);
    const p = plugins.find((x) => x.type === "scene:extension" && x.id === PLACE);
    expect(p.traits).toEqual([PLACE]);
    expect(Object.keys(p.describes)).toEqual([PLACE]);
  });
  it("has no fields: it says only that this object is the place", () => {
    const d = plugins.find((x) => x.id === PLACE).describes[PLACE];
    expect(d.on).toBe("object");
    expect(d.fields ?? []).toEqual([]);
    expect(d.init ?? {}).toEqual({});
  });
  it("no plugin describes the old terrain.sky", () => {
    for (const p of plugins) {
      expect(p.id).not.toBe("terrain.sky");
      expect(Object.keys(p.describes ?? {})).not.toContain("terrain.sky");
    }
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
  it("there are two: the credit and the place", () => expect(extensions.map((p) => p.id)).toEqual(["terrain.place", "terrain.credit"]));
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
