// The provider: a part of a map as a GLB, from a file doc's bytes and params.
import { describe, expect, it } from "vitest";
import source, { buildPart } from "./source.js";
import { FREEDOOM_NOTICE, noticeOf } from "./freedoom.js";
import { anchorOf, mapModel, placeIn } from "./parts.js";
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

  it("every part says where its frame is: the map, its anchor in map units, the scale", async () => {
    const m = mapModel(fixture(), "E1M1");
    for (const [params, anchor] of [
      [{ door: null }, [1272, 636, 0]],
      [{ door: 100 }, [960, -152, 0]],
      [{ line: 407 }, [-400, 1296, -120]],
      [{ whole: true }, [1272, 636, 0]],
    ]) {
      const { json } = parseGLB((await buildPart(fixture(), { map: "E1M1", ...params })).glb);
      expect(json.scenes[0].extras).toEqual({ doom: { map: "E1M1", anchor, unitsPerMetre: 36 } });
      expect(anchor).toEqual(anchorOf(m, params.door ?? null, params.line ?? null));
    }
  });

  it("the whole map: the static part at the root, each door and exit switch a node in it, exactly its own part at its own anchor", async () => {
    const wad = fixture();
    const m = mapModel(wad, "E1M1");
    const whole = parseGLB((await buildPart(wad, { map: "E1M1", whole: true })).glb);
    const nodes = whole.json.nodes;
    expect(whole.json.scenes[0].nodes).toEqual([0]);
    expect(nodes[0]).toMatchObject({ name: "E1M1", mesh: 0 });
    expect(nodes[0].translation).toBeUndefined();
    const kids = nodes[0].children.map((i) => nodes[i]);
    expect(kids.map((n) => n.extras)).toEqual([10, 34, 48, 54, 64, 78, 79, 80, 81, 84, 100].map((door) => ({ door })).concat([{ line: 407 }]));
    expect(kids.map((n) => n.name)).toEqual(["door-10", "door-34", "door-48", "door-54", "door-64", "door-78", "door-79", "door-80", "door-81", "door-84", "door-100", "exit-407"]);
    // one material per texture across every node: the static part's 153, the exit switch's and the two flats
    // only door undersides use (the static part draws no door's ceiling)
    expect(whole.json.materials).toHaveLength(156);

    /** A mesh's triangles by material name: { [material]: [positions, indices] }, read out of the GLB's buffer. */
    const read = ({ json, bin }, mesh) => {
      const acc = (i, T) => {
        const a = json.accessors[i];
        const v = json.bufferViews[a.bufferView];
        const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
        return [...new T(bin.slice(v.byteOffset, v.byteOffset + v.byteLength).buffer, 0, a.count * size)];
      };
      const out = {};
      for (const p of json.meshes[mesh].primitives) {
        const ix = json.accessors[p.indices].componentType === 5125 ? Uint32Array : Uint16Array;
        out[json.materials[p.material].name] = [acc(p.attributes.POSITION, Float32Array), acc(p.indices, ix), acc(p.attributes.TEXCOORD_0, Float32Array), acc(p.attributes.COLOR_0, Float32Array)];
      }
      return out;
    };
    const part = async (params) => parseGLB((await buildPart(wad, { map: "E1M1", ...params })).glb);
    expect(read(whole, 0)).toEqual(read(await part({ door: null }), 0));
    const origin = anchorOf(m, null);
    for (const n of kids) {
      const own = await part(n.extras);
      expect([n.name, read(whole, n.mesh)]).toEqual([n.name, read(own, 0)]);
      expect([n.name, n.translation]).toEqual([n.name, placeIn(origin, anchorOf(m, n.extras.door ?? null, n.extras.line ?? null))]);
    }
  });

  it("the whole map has no door or exit switch of its own", async () => {
    await expect(buildPart(fixture(), { map: "E1M1", whole: true, door: 100 })).rejects.toThrow(/no door or exit switch of its own/);
    await expect(buildPart(fixture(), { map: "E1M1", whole: true, line: 407 })).rejects.toThrow(/no door or exit switch of its own/);
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
    expect(meta).toMatchObject({ id: "doom-map", supportedDatatypes: ["file"], extensions: ["wad"], content: "built", version: 4 });
    const { load, ...rest } = meta;
    expect(structuredClone(rest)).toEqual(rest);
    // which map, and which door or exit switch (neither: the static part), or the whole map; no scale: one for every part
    expect(params).toEqual({ map: "", door: null, line: null, whole: false });
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
});
