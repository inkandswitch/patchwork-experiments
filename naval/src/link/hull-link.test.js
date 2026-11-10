// Hull linking: camber's own hulls through the render / file / source paths,
// floated and measured against camber's own hydrostatics.
//
// src/test/fixtures/camber/ holds GLBs built by camber's Patchwork wrapper
// (buildHullGlb, at 12 m) and camber-hydro.json, camber core's
// hydrostatics() for the same hulls, both made by the scratch script
// make-camber-hydro.mts.txt next to them (provenance inside the JSON).
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acquireHull, findChartroomTable, hullPathChip, matchProviders, meshFromGlb } from "./hull-link.js";
import { CHARTROOM_SOURCE } from "./chartroom-link.js";
import { glbTriangles } from "./glb-read.js";
import { toHullFrame, glbToFrameMatrix } from "../naval/hull-frame.js";
import { floatHull, rigToTable, MODEL_LOA_M } from "../naval/hull-form.js";
import { buildTable, rightingAt } from "../naval/statics.js";
import { getRegistry, resetRegistries } from "../test/patchwork-plugins-stub.js";
import { RHO_SEA } from "../naval/units.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => new Uint8Array(readFileSync(here(`../test/fixtures/camber/${name}`)));
const oracle = JSON.parse(new TextDecoder().decode(fixture("camber-hydro.json")));
const CAMBER_FRAME = { bow: "+X", up: "+Y" };
const formOf = (name, massKg = null) => floatHull(toHullFrame(glbTriangles(fixture(`${name}.glb`)).triangles, CAMBER_FRAME), { massKg });

describe("camber's hulls at 12 m against camber's own hydrostatics", () => {
  // Tolerances (the plan's): ∇ ±1%, LCB ±0.05 m, BWL ±1%, Cp ±0.01, WSA ±3%, KMt ±2%; and LWL ±1%,
  // Ax ±1%, Aw ±2%, LCF ±0.1 m, half-entrance ±2°, which the plan didn't list. The GLB is camber's
  // 64-section mesh; camber's figures come from its 240-section sweep, which caps transom-ended
  // sections, so near a wide immersed transom (cuvature-kink) Aw and LCF differ most.
  // camber's wetted area is the skin only (hydrostaticExport.ts says so): compared with ours
  // less the faces that look aft. Mesh LOA is the drawn extent; camber's "Scale to length" scales
  // its own loa(model) to 12 m, and the drawn hull comes out 0.5–6% shorter (cuvature-kink's transom
  // trims the most). The rig aid uses the drawn extent.
  for (const name of ["cuvature-kink-with-unmodified-pchip", "flat-bottom", "narrow-transom"])
    it(name, () => {
      const o = oracle[name].hydro;
      const f = formOf(name);
      expect(f.ok, f.error).toBe(true);
      const h = f.hydro;
      const rows = [
        ["∇ m³", h.volumeM3, o.volM3, 0.01, "rel"],
        ["LWL", h.lwl, o.lwl, 0.01, "rel"],
        ["BWL", h.bwl, o.bwl, 0.01, "rel"],
        ["Tc", h.tc, o.draft, 0.01, "rel"],
        ["WSA skin", h.wsaCanoeM2, o.wsaM2, 0.03, "rel"],
        ["Aw", h.awM2, o.awM2, 0.02, "rel"],
        ["LCB m", h.lcb, o.lcbM, 0.05, "abs"],
        ["LCF m", h.lcf, o.lcfM, 0.1, "abs"],
        ["Cp(Ax)", h.cp, o.cpOnAmax, 0.01, "abs"],
        ["Ax", h.amaxM2, o.amaxM2, 0.01, "rel"],
        ["KMt", h.kmt, o.kmt, 0.02, "rel"],
        ["½ entr °", h.halfEntranceDeg, o.halfEntranceDeg, 2, "abs"],
      ];
      console.log(
        `\n${name} (ours vs camber)\n` +
          rows.map(([k, a, b, tol, kind]) => `  ${k.padEnd(9)} ${a.toFixed(4).padStart(9)} ${b.toFixed(4).padStart(9)}  Δ ${(kind === "rel" ? `${(((a - b) / b) * 100).toFixed(2)}%` : (a - b).toFixed(4)).padStart(8)}  (±${kind === "rel" ? `${tol * 100}%` : tol})`).join("\n"),
      );
      for (const [k, a, b, tol, kind] of rows) expect(kind === "rel" ? Math.abs(a / b - 1) : Math.abs(a - b), k).toBeLessThan(tol);
      const loa = oracle[name].loaDocUnits * oracle[name].scale;
      console.log(`  LOA mesh ${f.loa.toFixed(3)} m, camber ${loa.toFixed(3)} m; immersed transom ${h.transomWetM2.toFixed(2)} m²`);
      // the mesh is the hull as drawn, trimmed at its transom: never longer than camber's LOA
      expect(f.loa).toBeLessThanOrEqual(loa + 1e-6);
      expect(f.loa / loa).toBeGreaterThan(0.9);
      expect(f.float.from).toBe("design-waterline");
    });

  it("a hull drawn with its waterline at the deck (hull-default) asks for a displacement, then floats at 8 t", () => {
    expect(oracle["hull-default"].validWaterplane).toBe(false);
    const a = formOf("hull-default");
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/give a displacement/);
    const b = formOf("hull-default", 8000);
    expect(b.ok).toBe(true);
    expect(b.float.massKg).toBeCloseTo(8000, 6);
    expect(b.hydro.awM2).toBeGreaterThan(0);
    expect(b.freeboardMin).toBeGreaterThan(0);
    console.log(`hull-default at 8 t: LWL ${b.hydro.lwl.toFixed(2)} m, BWL ${b.hydro.bwl.toFixed(2)} m, Tc ${b.hydro.tc.toFixed(3)} m, sinks ${(-b.shiftZ).toFixed(3)} m below its drawn waterline`);
  });

  it("is used at its own size: a 1 m model is said to be a model", () => {
    const t = toHullFrame(glbTriangles(fixture("narrow-transom.glb")).triangles, CAMBER_FRAME).map((v) => v / 12);
    const f = floatHull(t);
    expect(f.ok).toBe(true);
    expect(f.loa).toBeLessThan(MODEL_LOA_M);
    expect(f.warnings.join(" ")).toMatch(/looks like a model, not a boat.*real size only.*length overall/);
    expect(formOf("narrow-transom").warnings.join(" ")).not.toMatch(/model/);
  });

  it("the frame chooser: the same hull modelled Z-up reads the same", () => {
    const yUp = glbTriangles(fixture("narrow-transom.glb")).triangles;
    // re-model it Z-up: (X, Y, Z) → (X, −Z, Y), so up is +Z and the bow still +X
    const zUp = Float64Array.from(yUp, (v, i) => (i % 3 === 0 ? v : i % 3 === 1 ? -yUp[i + 1] : yUp[i - 1]));
    const a = formOf("narrow-transom");
    const b = floatHull(toHullFrame(zUp, { bow: "+X", up: "+Z" }));
    expect(b.hydro.volumeM3).toBeCloseTo(a.hydro.volumeM3, 9);
    expect(b.hydro.lcb).toBeCloseTo(a.hydro.lcb, 9);
    // and the wrong choice is visibly wrong, not silently accepted as the same hull
    const c = floatHull(toHullFrame(zUp, CAMBER_FRAME));
    expect(c.ok && Math.abs(c.hydro.lwl - a.hydro.lwl) < 0.1).toBe(false);
    // glbToFrame is the same map as toHullFrame
    const M = glbToFrameMatrix({ bow: "-X", up: "+Y" }, [0, 0, 0.5]);
    const p = [1, 2, 3];
    const q = toHullFrame(p, { bow: "-X", up: "+Y" }, [0, 0, 0.5]);
    const m = [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
    m.forEach((v, k) => expect(v).toBeCloseTo(q[k], 12));
  });
});

describe("a Chartroom table carried by the hull", () => {
  it("is found wherever a producer nests it in the scene extras", () => {
    const t = { format: "hydrostatic-table", version: 1 };
    expect(findChartroomTable({ scene: 0, scenes: [{ extras: { chartroom: { hydrostaticTable: t } } }] })).toBe(t);
    expect(findChartroomTable({ scenes: [{ extras: { camber: {}, ship: { length: 9 } } }] })).toBeNull();
  });

  it("is read in its own frame: GZ through rigToTable equals GZ in the rig frame", () => {
    const f = formOf("narrow-transom");
    const V = f.float.volumeM3;
    const G = [f.hydro.lcb, 0, 0.4];
    const heels = [0, 10, 20, 30];
    const ours = buildTable(f.mesh, { volumes: [V], heels });
    // the same hull in another producer's frame: x from 3 m further aft, z from a datum 1.2 m lower
    const theirsMesh = Float64Array.from(f.mesh.triangles, (v, i) => (i % 3 === 0 ? v + 3 : i % 3 === 2 ? v + 1.2 : v));
    const theirs = buildTable(theirsMesh, { volumes: [V], heels, reference: { heelDeg: 0, trimDeg: 0, waterplaneOffsetM: 1.2 } });
    const map = rigToTable(theirs, f);
    expect(map.available).toBe(true);
    const Gt = map.map(G);
    expect(Gt[0]).toBeCloseTo(G[0] + 3, 6);
    expect(Gt[2]).toBeCloseTo(G[2] + 1.2, 6);
    for (const heelDeg of heels.slice(1)) {
      const a = rightingAt(ours, { volumeM3: V, G }, { heelDeg }).gz;
      const b = rightingAt(theirs, { volumeM3: V, G: Gt }, { heelDeg }).gz;
      expect(b).toBeCloseTo(a, 6);
    }
  });
});

describe("acquireHull: the hull itself (source or file), never a scene render", () => {
  const GLB = fixture("narrow-transom.glb");
  const urls = { render: "automerge:rend111111111111111111111", file: "automerge:g1b1111111111111111111111", hull: "automerge:hu11111111111111111111111", rig: "automerge:r1g1111111111111111111111" };
  const handle = (url, doc) => ({ url, doc: () => doc, heads: () => ["a"], on() {}, off() {} });
  const docs = {
    [urls.render]: { "@patchwork": { type: "scene-render" }, title: "Narrow transom", parent: urls.hull, providerId: "camber-hull-surface", params: { size: "length", lengthMeters: 12 }, glbUrl: urls.file, status: "idle" },
    [urls.file]: { "@patchwork": { type: "file" }, name: "Hull.glb", extension: "glb", content: GLB },
    [urls.hull]: { "@patchwork": { type: "camber-hull" }, title: "Narrow transom" },
    [urls.rig]: { "@patchwork": { type: "rig-design" } },
  };
  const repo = { find: async (u) => (docs[u] ? handle(u, docs[u]) : Promise.reject(new Error("unknown"))) };
  beforeEach(() => resetRegistries());

  // Every render is refused, scaled or not: its GLB is built with a scene's params, and the hull a
  // scene's sailing hull names is the source doc, so a rig linked to a render was "designed on another hull".
  for (const params of [{ size: "length", lengthMeters: 12 }, { size: "length" }, { size: "document" }, undefined])
    it(`a scene render (${JSON.stringify(params ?? null)}) is refused, for good, naming the hull to link`, async () => {
      const u = `automerge:rend${JSON.stringify(params ?? null).length}1111111111111111111`.slice(0, 32);
      docs[u] = { ...docs[urls.render], params };
      const r = await acquireHull({ url: u, repo, getRegistry });
      expect(r).toMatchObject({ ok: false, transient: false, parent: urls.hull });
      expect(r.error).toMatch(/is a scene render.*not a hull: link the hull itself/);
      if (params?.size === "length") expect(r.error).toMatch(/stretched to/);
      else expect(r.error).not.toMatch(/stretched/);
    });

  it("a GLB file doc", async () => {
    const r = await acquireHull({ url: urls.file, repo });
    expect(r).toMatchObject({ ok: true, path: "file" });
  });

  it("a source doc, built by the most specific scene:source with its defaults", async () => {
    const sources = getRegistry("scene:source");
    let seen = null;
    sources.register({ id: "wild", supportedDatatypes: "*", load: async () => ({ build: async () => ({ glb: new Uint8Array(4) }) }) });
    sources.register({
      id: "camber-hull-surface",
      name: "Camber hull",
      supportedDatatypes: ["camber-hull"],
      params: [{ key: "size", default: "document" }],
      load: async () => ({
        build: async ({ params }) => {
          seen = params;
          return { glb: GLB };
        },
      }),
    });
    const r = await acquireHull({ url: urls.hull, repo, getRegistry });
    expect(r).toMatchObject({ ok: true, path: "source", providerId: "camber-hull-surface" });
    expect(seen).toEqual({ size: "document" });
    expect(matchProviders(sources.filter(() => true), { datatype: "camber-hull" }).map((p) => p.id)).toEqual(["camber-hull-surface", "wild"]);
  });

  const camberSource = (seen = {}) => ({
    id: "camber-hull-surface",
    name: "Camber hull",
    supportedDatatypes: ["camber-hull"],
    params: [{ key: "size", default: "document" }],
    load: async () => ({ build: async ({ params }) => ((seen.params = params), { glb: GLB }) }),
  });
  const upright = JSON.parse(readFileSync(here("../test/chartroom/upright-box.json"), "utf8"));
  const fakeChartroom = (table, calls = []) => ({
    id: "camber-hull-chartroom",
    name: "Camber",
    supportedDatatypes: ["camber-hull"],
    formats: ["hydrostatic-table/1", "marine-geometry/1"],
    version: 1,
    load: async () => ({
      fingerprint: (doc) => `fp:${doc.title}`,
      hydrostaticTable: async (doc, opts) => (calls.push(opts), table),
      marineGeometry: () => null,
    }),
  });

  it("a source doc with its package's chartroom:source: the provider's checked table rides on the mesh", async () => {
    getRegistry("scene:source").register(camberSource());
    const calls = [];
    getRegistry(CHARTROOM_SOURCE).register(fakeChartroom(upright, calls));
    const r = await acquireHull({ url: urls.hull, repo, getRegistry });
    expect(r).toMatchObject({ ok: true, path: "source", table: { source: "chartroom", providerId: "camber-hull-chartroom", fingerprint: "fp:Narrow transom" } });
    expect(r.mesh.table).toBe(upright);
    expect(calls).toHaveLength(1);
    expect(calls[0].heelDeg.at(-1)).toBe(180);
    expect(hullPathChip(r)).toBe("built by Camber hull (its default params, at its own size; statics from Camber)");
  });

  it("a chartroom:source whose table doesn't check out is passed over, said, and the mesh path stays", async () => {
    getRegistry("scene:source").register(camberSource());
    getRegistry(CHARTROOM_SOURCE).register(fakeChartroom({ ...upright, format: "not-a-table" }));
    const r = await acquireHull({ url: urls.hull, repo, getRegistry });
    expect(r).toMatchObject({ ok: true, path: "source", table: { source: null } });
    expect(r.table.note).toMatch(/Camber: its table doesn't check out: format is not/);
    expect(r.mesh.table).toBeNull();
  });

  it("a chartroom:source for another datatype, or a wildcard one, isn't asked", async () => {
    getRegistry("scene:source").register(camberSource());
    const calls = [];
    getRegistry(CHARTROOM_SOURCE).register({ ...fakeChartroom(upright, calls), id: "other", supportedDatatypes: ["other-hull"] });
    getRegistry(CHARTROOM_SOURCE).register({ ...fakeChartroom(upright, calls), id: "wild", supportedDatatypes: "*" });
    const r = await acquireHull({ url: urls.hull, repo, getRegistry });
    expect(r).toMatchObject({ ok: true, table: { source: null } });
    expect(r.table.note).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("refuses itself and another rig; says when nothing can build a doc", async () => {
    expect(await acquireHull({ url: urls.hull, repo, selfUrl: urls.hull })).toMatchObject({ ok: false, transient: false });
    expect(await acquireHull({ url: urls.rig, repo })).toMatchObject({ ok: false, transient: false });
    const r = await acquireHull({ url: urls.hull, repo, getRegistry });
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(r.error).toMatch(/no scene:source provider/);
  });

  it("reads the GLB's units and never extras.ship", async () => {
    const m = await meshFromGlb(GLB);
    expect(m.units.scale).toBe(1);
    expect(m.table).toBeNull(); // camber's wrapper doesn't publish a Chartroom table yet
    // the floated displacement is the mesh's, not extras.ship's 20 883 kg (a 64-section cut)
    const f = formOf("narrow-transom");
    console.log(`narrow-transom: mesh ${Math.round(f.float.massKg)} kg, camber 240-section ${Math.round(oracle["narrow-transom"].hydro.volM3 * RHO_SEA)} kg`);
  });
});
