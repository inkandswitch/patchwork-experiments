// The provider: a part of a map as a GLB, from a file doc's bytes and params.
import { describe, expect, it } from "vitest";
import source, { buildPart, notesOf } from "./source.js";
import { FREEDOOM_NOTICE, noticeOf } from "./freedoom.js";
import { mapModel } from "./parts.js";
import { parseGLB, SAMPLER } from "./glb.js";
import { plugins } from "./index.js";
import { fixture, fixtureBytes } from "./test/fixture.js";

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

describe("building a part", () => {
  it("the static part: one primitive per texture, unlit, sampled nearest, PNGs embedded, in metres", async () => {
    const wad = fixture();
    const { glb, bounds } = await buildPart(wad, { map: "E1M1", door: null }, { copyright: "© someone" });
    const { json, bin } = parseGLB(glb);
    const prims = json.meshes[0].primitives;
    // 154 textures in E1M1, less the exit switch's (SW1GRAY: on that line alone, now a part of its own)
    expect(prims.length).toBe(153);
    expect(json.materials).toHaveLength(153);
    expect(json.materials.map((m) => m.name)).not.toContain("wall:SW1GRAY");
    expect(json.materials.every((m) => m.extensions?.KHR_materials_unlit && m.pbrMetallicRoughness.baseColorTexture)).toBe(true);
    expect(json.samplers).toEqual([SAMPLER]);
    expect(SAMPLER.magFilter).toBe(9728); // NEAREST
    expect(json.asset.copyright).toBe("© someone");
    expect(json.asset.extras.units).toBe("m");
    for (const img of json.images) {
      const v = json.bufferViews[img.bufferView];
      expect([...bin.subarray(v.byteOffset, v.byteOffset + 8)]).toEqual(PNG);
    }
    // every primitive carries uvs and the sector's light as a colour
    for (const p of prims) expect(Object.keys(p.attributes).sort()).toEqual(["COLOR_0", "POSITION", "TEXCOORD_0"]);
    // E1M1 is about 110 × 94 m at 36 units a metre, centred on its anchor
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(3952 / 36, 3);
    expect(bounds.min[0]).toBeCloseTo(-bounds.max[0], 6);
  });

  it("a door: its origin on its shut underside, as tall as its travel, at the one scale every part has", async () => {
    const { glb, bounds } = await buildPart(fixture(), { map: "E1M1", door: 100 });
    expect(bounds.min[1]).toBe(0);
    expect(bounds.max[1]).toBeCloseTo(124 / 36, 6);
    expect(parseGLB(glb).json.asset.copyright).toBeUndefined();
  });

  it("an exit switch: its line's wall alone, its origin on the middle of its line at its floor", async () => {
    const { glb, bounds } = await buildPart(fixture(), { map: "E1M1", line: 407 });
    const { json } = parseGLB(glb);
    expect(json.meshes[0].name).toBe("E1M1 exit 407");
    expect(json.materials.map((m) => m.name)).toEqual(["wall:SW1GRAY"]);
    // line 407 runs north 32 units at x = -400, its sector's floor -120 and ceiling -56: a wall 32 × 64 units, facing east
    for (const k of [0, 1, 2]) expect(bounds.min[k]).toBeCloseTo([0, 0, -16 / 36][k], 6);
    for (const k of [0, 1, 2]) expect(bounds.max[k]).toBeCloseTo([0, 64 / 36, 16 / 36][k], 6);
  });

  it("a part is a door or an exit switch, not both", async () => {
    await expect(buildPart(fixture(), { map: "E1M1", door: 100, line: 407 })).rejects.toThrow(/not both/);
  });

  it("the same doc and params build the same bytes", async () => {
    const one = await buildPart(fixture(), { map: "E1M1", door: 34 });
    const two = await buildPart(fixture(), { map: "E1M1", door: 34 });
    expect(Buffer.from(one.glb).equals(Buffer.from(two.glb))).toBe(true);
  });
});

describe("the scene:source", () => {
  const meta = plugins.find((p) => p.type === "scene:source");
  const params = Object.fromEntries(meta.params.map((p) => [p.key, p.default]));

  it("is for .wad file docs, and its metadata is plain data", () => {
    expect(meta).toMatchObject({ id: "doom-map", supportedDatatypes: ["file"], extensions: ["wad"], version: 3 });
    const { load, ...rest } = meta;
    expect(structuredClone(rest)).toEqual(rest);
    // which map, and which door or exit switch (neither: the static part); no scale: one for every part
    expect(params).toEqual({ map: "", door: null, line: null });
  });

  it("builds from a file doc; the doc's notice goes in every GLB; the notes say what doesn't work here", async () => {
    const doc = { "@patchwork": { type: "file" }, name: "e1m1.wad", extension: "wad", content: fixtureBytes(), origin: { notice: "Copyright © them" } };
    const r = await source.build({ doc, params: { ...params, map: "E1M1" } });
    expect(r.kind).toBe("glb");
    expect(parseGLB(r.glb).json.asset.copyright).toBe("Copyright © them");
    expect(r.meta.notes).toMatch(/11 doors and 1 exit switch are objects of their own/);
    expect(r.meta.notes).toMatch(/lift \(sectors 98, 103\)/);
    expect(r.meta.notes).toMatch(/locked door \(sectors 51, 71\)/);
    // E1M1's only exit is its switch, which is imported: nothing about exits is left out
    expect(r.meta.notes).not.toMatch(/exit \(/);
  });

  it("a Freedoom WAD's GLBs carry its release's notice whether or not the drop has written it on the doc yet", async () => {
    const doc = { "@patchwork": { type: "file" }, name: "e1m1.wad", extension: "wad", content: fixtureBytes() };
    const r = await source.build({ doc, params: { map: "E1M1", door: 100 } });
    expect(parseGLB(r.glb).json.asset.copyright).toBe(FREEDOOM_NOTICE);
  });

  it("an origin's notice is only a non-empty string", () => {
    expect(noticeOf({ notice: "x" })).toBe("x");
    for (const o of [null, {}, { notice: "  " }, { notice: 3 }]) expect(noticeOf(o)).toBe(null);
  });

  it("a part that isn't there fails with why; there is no default map", async () => {
    const doc = { content: fixtureBytes() };
    await expect(source.build({ doc, params: { map: "E1M1", door: 98 } })).rejects.toThrow(/isn't a door that works here/);
    await expect(source.build({ doc, params: { map: "E1M1", line: 406 } })).rejects.toThrow(/line 406 of E1M1 isn't an exit switch/);
    await expect(source.build({ doc, params: { map: "MAP01", door: null } })).rejects.toThrow(/no map MAP01 in this WAD: it has E1M1/);
    await expect(source.build({ doc, params })).rejects.toThrow(/which map\?: it has E1M1/);
    await expect(source.build({ doc: { content: "text" }, params })).rejects.toThrow(/no bytes/);
  });

  it("notes for a door, and for an exit switch", () => {
    expect(notesOf(mapModel(fixture(), "E1M1"), 100, ["X"])).toBe("E1M1: the door of sector 100, 124 units of travel. Not in this WAD, left undrawn: X.");
    expect(notesOf(mapModel(fixture(), "E1M1"), null, [], 407)).toBe("E1M1: the exit switch, line 407.");
  });
});
