// @vitest-environment node
import { describe, it, expect } from "vitest";
import source from "./source.js";
import { storeTerrainData, readTerrainData, dataFits } from "./store.js";
import { parseGLB } from "./glb.js";
import { sha256Hex } from "./hash.js";
import { quantize } from "./fetch-data.js";
import { FakeRepo } from "./test/fake-repo.js";
import { features, demValues, terrainDoc } from "./test/fixture.js";
import { plugins } from "./index.js";

/** A terrain doc with its data stored as the tool stores it. */
async function stored() {
  const repo = new FakeRepo();
  const doc = terrainDoc();
  delete doc.data;
  const handle = repo.add(doc);
  const demBytes = quantize(demValues(), 0.02);
  const featBytes = new TextEncoder().encode(JSON.stringify(features()));
  const fetched = {
    dem: { bytes: demBytes, record: { encoding: "int16le", scale: 0.02, offset: 0, datum: "NAVD88", n: doc.grid.n, cell: doc.grid.cell, x0: doc.grid.x0, z0: doc.grid.z0, origin: { ...doc.origin }, sha256: await sha256Hex(demBytes) } },
    features: { bytes: featBytes, record: { encoding: "json", origin: { ...doc.origin }, sha256: await sha256Hex(featBytes) } },
    sources: [{ id: "test", name: "made up", licence: "none", attribution: "tests" }],
    summary: { fetched: "2026-11-09T00:00:00.000Z" },
  };
  await storeTerrainData(repo, handle, fetched);
  return { repo, handle };
}

describe("the terrain-mesh source", () => {
  it("builds a GLB from the doc and its two file docs, and nothing else", async () => {
    const { repo, handle } = await stored();
    const d = handle.doc();
    expect(dataFits(d)).toBe(true);
    expect(source.dependencies(d)).toEqual([d.data.dem.url, d.data.features.url]);
    const out = await source.build({ doc: d, handle, url: handle.url, repo, params: {} });
    expect(out.kind).toBe("glb");
    expect(parseGLB(out.glb).json.scenes[0].extras.terrain.version).toBe(1);
    expect(out.meta.notes).toMatch(/triangles/);
    expect(out.meta.bounds.min[0]).toBe(-256);
  });

  it("refuses data whose bytes aren't what the doc recorded", async () => {
    const { repo, handle } = await stored();
    const d = handle.doc();
    (await repo.find(d.data.dem.url)).change((f) => {
      f.content = new Uint8Array(f.content);
      f.content[10] ^= 1;
    });
    await expect(readTerrainData(repo, handle.doc())).rejects.toThrow(/SHA-256/);
  });

  it("asks for data when there is none, and for a fresh fetch when the place moved", async () => {
    const { repo, handle } = await stored();
    await expect(source.build({ doc: { ...terrainDoc(), data: null }, repo, params: {} })).rejects.toThrow(/Fetch data/);
    handle.change((d) => (d.origin.lat += 0.01));
    await expect(source.build({ doc: handle.doc(), repo, params: {} })).rejects.toThrow(/another place/);
  });

  it("fingerprints what build() reads: a rename doesn't rebuild, an exaggeration does", async () => {
    const { handle } = await stored();
    const a = source.fingerprint(handle.doc());
    handle.change((d) => (d.title = "Renamed"));
    expect(source.fingerprint(handle.doc())).toBe(a);
    handle.change((d) => (d.exaggeration = 2));
    expect(source.fingerprint(handle.doc())).not.toBe(a);
  });

  it("keeps its fingerprint when the docs are copied under new urls (as publishing does), and changes it when the data does", async () => {
    const { handle } = await stored();
    const d = handle.doc();
    const a = source.fingerprint(d);
    const moved = JSON.parse(JSON.stringify(d));
    moved.data.dem.url = "automerge:2rewrittenDemUrlxxxxxxxxxxxx";
    moved.data.features.url = "automerge:3rewrittenFeaturesUrlxxxxxxx";
    expect(source.fingerprint(moved)).toBe(a);
    expect(source.dependencies(moved)).toEqual([moved.data.dem.url, moved.data.features.url]);
    moved.data.dem.sha256 = "0".repeat(64);
    expect(source.fingerprint(moved)).not.toBe(a);
  });

  it("fingerprints the same whatever order the doc's keys come in (automerge sorts a map's keys; a plain object doesn't)", async () => {
    const { handle } = await stored();
    const d = JSON.parse(JSON.stringify(handle.doc()));
    const reorder = (v, dir) => (Array.isArray(v) ? v.map((x) => reorder(x, dir)) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, reorder(v[k], dir)]).sort(() => dir)) : v);
    const fp = source.fingerprint(d);
    expect(source.fingerprint(reorder(d, 0))).toBe(fp);
    const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, reversed(v[k])])) : v);
    expect(source.fingerprint(reversed(d))).toBe(fp);
    expect(JSON.stringify(reversed(d))).not.toBe(JSON.stringify(d));
  });

  it("stores each data file with its licence: the OSM features as ODbL with their notice", async () => {
    const { repo, handle } = await stored();
    const d = handle.doc();
    const feat = (await repo.find(d.data.features.url)).doc();
    expect(feat).toMatchObject({ licence: "ODbL-1.0", attribution: expect.stringContaining("© OpenStreetMap contributors") });
    expect((await repo.find(d.data.dem.url)).doc().licence).toMatch(/Public domain/);
    expect(d.credit).toMatch(/OpenStreetMap/);
  });

  it("keys a data file by its content, not its heads", async () => {
    const { repo, handle } = await stored();
    const url = handle.doc().data.dem.url;
    const f = (await repo.find(url)).doc();
    const k = source.fingerprintDependency(url, f);
    expect(k).toMatch(/^8450:/);
    expect(source.fingerprintDependency(url, { ...f, content: new Uint8Array(f.content) })).toBe(k);
  });
});

describe("plugins", () => {
  it("are metadata only: they survive structuredClone without load()", () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(() => structuredClone(meta)).not.toThrow();
    }
    expect(plugins.map((p) => `${p.type}:${p.id}`)).toEqual(["patchwork:datatype:terrain", "patchwork:tool:terrain", "scene:source:terrain-mesh", "scene:template:terrain.cadboro-bay", "scene:extension:terrain.credit"]);
  });
  it("load what they say", async () => {
    const [dt, tool, src, tpl, credit] = await Promise.all(plugins.map((p) => p.load()));
    expect(typeof credit.create).toBe("function");
    expect(typeof dt.init).toBe("function");
    expect(typeof tool).toBe("function");
    expect(typeof src.build).toBe("function");
    expect(typeof tpl.create).toBe("function");
  });
});
