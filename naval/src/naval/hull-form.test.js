// One statics engine per hull source (hull-form.js): a hull that brings its
// own Chartroom table is floated and read by it, figure by figure; the mesh
// gives only what a table has no field for. Every case here is finite and
// closed-form: a fake provider's box table (src/test/tables.js) whose
// numbers differ from the mesh's, so each figure shows which engine gave it;
// and a table built from the hull's own mesh, where the two engines must
// agree to round-off.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { floatHull, tableFloat, tableUpright, rigToTable, engineNote, MESH_ONLY } from "./hull-form.js";
import { buildTable, validateTable, rightingAt } from "./statics.js";
import { prepareMesh, rotationRows, uprightHydrostatics } from "./mesh-hydro.js";
import { toHullFrame } from "./hull-frame.js";
import { RHO_SEA } from "./units.js";
import { glbTriangles } from "../link/glb-read.js";
import { ownTableFor, staticsFor } from "../rig-build.js";
import { boxMesh } from "../test/meshes.js";
import { boxTable } from "../test/tables.js";

// The mesh: a box 10 × 3 × 2 m, its design waterline (z = 0) 1 m above its bottom, its middle at x = 0.
const MESH = boxMesh(10, 3, 2, { x0: -5, z0: -1 });
const MESH_V = 30;
// The fake provider's table: a box 10 × 3.2 × 2 m in its own frame (x from 0, keel at z = 5), referenced at a
// 0.9 m draft. Wider than the mesh and elsewhere, so ∇ (28.8 against 30), Aw (32 against 30), LCB (5 against
// 0) and BMt each tell the two engines apart.
const T = { L: 10, B: 3.2, D: 2, x0: 0, zKeel: 5 };
const REF = 5.9;
const table = (o = {}) => boxTable({ ...T, reference: REF, ...o });

describe("tableFloat: where the hull's own table floats it (the four cases, and what is refused)", () => {
  const mesh = { meshVolumeAtDesign: () => MESH_V, meshImmerse: () => 0.0667 };
  it("a reference state, at the design waterline: the reference plane, ∇ the table's there", () => {
    expect(tableFloat(table(), { volumeM3: null, ...mesh })).toEqual({ ok: true, trimDeg: 0, hT: REF, volumeM3: expect.closeTo(28.8, 12), meshH: 0, vertical: "reference", volumeFrom: "table" });
  });
  it("a reference state, a displacement: the table's plane for ∇; the mesh is cut that far from its design waterline", () => {
    const r = tableFloat(table(), { volumeM3: 32, ...mesh });
    expect(r).toMatchObject({ ok: true, vertical: "reference", volumeFrom: "given", volumeM3: 32 });
    expect(r.hT).toBeCloseTo(6, 12); // 32 m³ / (10 × 3.2) = 1 m draft
    expect(r.meshH).toBeCloseTo(0.1, 12); // 0.1 m deeper than the reference's 0.9 m
  });
  it("no reference state, at the design waterline: the mesh's z = 0 and its ∇; the table is entered at that ∇", () => {
    const r = tableFloat(table({ reference: null }), { volumeM3: null, ...mesh });
    expect(r).toMatchObject({ ok: true, vertical: "volume", volumeFrom: "mesh", volumeM3: MESH_V, meshH: 0 });
    expect(r.hT).toBeCloseTo(5 + 30 / 32, 12);
  });
  it("no reference state, a displacement: the table at ∇, the mesh immersed to ∇ by itself", () => {
    const r = tableFloat(table({ reference: null }), { volumeM3: 32, ...mesh });
    expect(r).toMatchObject({ ok: true, vertical: "volume", volumeFrom: "given", volumeM3: 32, meshH: 0.0667 });
    expect(r.hT).toBeCloseTo(6, 12);
  });
  it("a reference state that isn't upright is no upright reference: as none", () => {
    const t = table({ heels: [0, 10] });
    t.referenceState.heelDeg = 10;
    expect(tableFloat(t, { volumeM3: null, ...mesh })).toMatchObject({ ok: true, vertical: "volume", volumeFrom: "mesh" });
  });
  const refused = [
    ["a displacement the table doesn't reach", table(), 65, /outside the volumes/],
    ["a displacement on the table's full plateau (no waterplane to find)", table({ offsets: [5, 6, 7, 8] }), 64, /states no waterplane/],
    ["a reference waterplane with nothing under it", table({ reference: 5 }), null, /nothing below its reference waterplane/],
    ["a mesh that can't displace the volume (no reference to cut it by)", table({ reference: null }), 40, /mesh can't displace/],
    ["nothing under the mesh's design waterline (no reference)", table({ reference: null }), null, /nothing is below the design waterline/],
  ];
  for (const [name, t, V, why] of refused)
    it(`refuses ${name}, with the reason`, () => {
      const r = tableFloat(t, { volumeM3: V, meshVolumeAtDesign: () => (name.startsWith("nothing") ? 0 : MESH_V), meshImmerse: () => (name.startsWith("a mesh") ? null : 0) });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(why);
    });
});

describe("tableUpright: every figure the table carries is the table's; the rest stay the mesh's, and `from` says which", () => {
  const meshHydro = uprightHydrostatics(prepareMesh(MESH), 0);
  const draft = REF - T.zKeel; // 0.9
  const V = T.L * T.B * draft; // 28.8
  const WATERPLANES = ["full", "omitted", "null", "no-centroid", "no-yy", "no-xx"];
  const has = (wp, what) => !["omitted", "null"].includes(wp) && wp !== `no-${what}`;

  it("the mesh's own figures are the box's (so the differences below are the table's)", () => {
    expect(meshHydro).toMatchObject({ volumeM3: expect.closeTo(30, 9), lwl: expect.closeTo(10, 9), bwl: expect.closeTo(3, 9), tc: expect.closeTo(1, 9), awM2: expect.closeTo(30, 9), lcb: expect.closeTo(0, 9) });
    expect(meshHydro.transomWetM2).toBeCloseTo(3, 9);
  });

  // 6 waterplanes × wetted area or not × shared / aligned frame: all 24
  for (const wp of WATERPLANES)
    for (const wetted of [false, true])
      for (const frame of ["shared", "aligned"])
        it(`waterplane ${wp}, ${wetted ? "a" : "no"} wetted area, ${frame} frame`, () => {
          const t = table({ waterplane: wp, wetted, lcfShift: 0.5 });
          expect(validateTable(t).ok).toBe(true);
          const u = tableUpright(meshHydro, t, { hT: REF, trimDeg: 0, frame });
          expect(u.ok).toBe(true);
          const { hydro: h, dx } = u;
          const f = h.from;
          expect(h.engine).toBe("chartroom");
          // every figure has a source, from the vocabulary
          for (const k of Object.keys(f)) expect(["table", "mesh", "mixed"], k).toContain(f[k]);
          // what a table has no field for is the mesh's, untouched
          for (const k of MESH_ONLY) {
            expect(f[k], k).toBe("mesh");
            expect(h[k], k).toBe(meshHydro[k]);
          }
          // ∇ and B: always the table's
          expect(h.volumeM3).toBeCloseTo(V, 12);
          expect([f.volumeM3, f.vcb, f.kb, f.kRefZ, f.tcb]).toEqual(["table", "table", "table", "table", "table"]);
          expect(h.vcb).toBeCloseTo(-draft / 2, 12); // below the waterplane (z = 0)
          expect(h.kRefZ).toBeCloseTo(-draft, 12);
          expect(h.kb).toBeCloseTo(draft / 2, 12);
          // LCB: the table's x when the frames are shared; else the table is slid onto the mesh's LCB
          expect(dx).toBeCloseTo(frame === "shared" ? 0 : 5, 12);
          expect(f.lcb).toBe(frame === "shared" ? "table" : "mesh");
          expect(h.lcb).toBeCloseTo(frame === "shared" ? 5 : 0, 12);
          // the waterplane, part by part
          expect(f.awM2).toBe(has(wp, "area") ? "table" : "mesh");
          expect(h.awM2).toBeCloseTo(has(wp, "area") ? 32 : 30, 9);
          expect(f.lcf).toBe(has(wp, "centroid") ? "table" : "mesh");
          expect(h.lcf).toBeCloseTo(has(wp, "centroid") ? (frame === "shared" ? 5.5 : 0.5) : 0, 9);
          expect(f.bmt).toBe(has(wp, "yy") ? "table" : "mesh");
          expect(h.bmt).toBeCloseTo(has(wp, "yy") ? (10 * 3.2 ** 3) / 12 / V : (10 * 27) / 12 / 30, 9);
          expect(f.bml).toBe(has(wp, "xx") ? "table" : "mesh");
          expect(h.bml).toBeCloseTo(has(wp, "xx") ? (3.2 * 1000) / 12 / V : (3 * 1000) / 12 / 30, 9);
          expect(f.kmt).toBe(has(wp, "yy") ? "table" : "mixed");
          expect(h.kmt).toBeCloseTo(h.kb + h.bmt, 12);
          expect(h.kml).toBeCloseTo(h.kb + h.bml, 12);
          // wetted area: the table's when it states one, less the mesh's immersed transom for the canoe body
          expect(f.wsaM2).toBe(wetted ? "table" : "mesh");
          expect(f.wsaCanoeM2).toBe(wetted ? "mixed" : "mesh");
          const W = 2 * (10 + 3.2) * draft + 32;
          expect(h.wsaM2).toBeCloseTo(wetted ? W : meshHydro.wsaM2, 9);
          expect(h.wsaCanoeM2).toBeCloseTo(wetted ? W - 3 : meshHydro.wsaCanoeM2, 9);
          // coefficients: the table's ∇ and Aw over the mesh's lengths and sections
          expect([f.cb, f.cp, f.cpMid]).toEqual(["mixed", "mixed", "mixed"]);
          expect(f.cw).toBe(has(wp, "area") ? "mixed" : "mesh");
          expect(h.cb).toBeCloseTo(V / (10 * 3 * 1), 12);
          expect(h.cp).toBeCloseTo(V / (meshHydro.amaxM2 * 10), 12);
          expect(h.cp * h.cm).toBeCloseTo(h.cb, 12);
          expect(h.cw).toBeCloseTo(h.awM2 / 30, 12);
          // each gap is said, once
          const gaps = [!has(wp, "area"), !has(wp, "centroid"), !has(wp, "yy"), !has(wp, "xx"), !wetted].filter(Boolean).length;
          expect(h.tableGaps).toHaveLength(gaps);
          expect(engineNote(h, "Fake")).toMatch(/^Statics are Fake's hydrostatic table: ∇/);
        });

  it("a stated displacement: ∇ is given, not the table's; the mesh figures over it are mixed", () => {
    const u = tableUpright(meshHydro, table(), { hT: 6, trimDeg: 0, frame: "shared", volumeFrom: "given" });
    expect(u.hydro.from).toMatchObject({ volumeM3: "given", cb: "mixed", cp: "mixed" });
    expect(u.hydro.volumeM3).toBeCloseTo(32, 12);
  });
  it("no reference waterplane at the design waterline: ∇ is the mesh's, and so are Cb and Cp", () => {
    const u = tableUpright(meshHydro, table({ reference: null }), { hT: 5 + 30 / 32, trimDeg: 0, frame: "aligned", volumeFrom: "mesh" });
    expect(u.hydro.from).toMatchObject({ volumeM3: "mesh", cb: "mesh", cp: "mesh", awM2: "table", cw: "mixed" });
    expect(u.hydro.volumeM3).toBeCloseTo(30, 12);
  });
  it("outside the table, or dry: unavailable, with the reason", () => {
    expect(tableUpright(meshHydro, table(), { hT: 9, frame: "shared" })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the immersion range/) });
    expect(tableUpright(meshHydro, table(), { hT: 5, frame: "shared" })).toMatchObject({ ok: false, reason: expect.stringMatching(/no buoyancy/) });
    expect(tableUpright(meshHydro, table(), { hT: REF, trimDeg: 2, frame: "shared" })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the table's angles/) });
  });
});

describe("floatHull with the hull's own table", () => {
  const numeric = (h) => Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === "number"));

  it("at the design waterline the table is the engine: its ∇, its waterplane; the mesh's lengths", () => {
    const f = floatHull(MESH, { table: table(), tableFrame: "shared", tableName: "Fake" });
    expect(f.ok).toBe(true);
    expect(f.hydro.engine).toBe("chartroom");
    expect(f.float).toMatchObject({ from: "design-waterline", engine: "chartroom", h: 0 });
    expect(f.float.volumeM3).toBeCloseTo(28.8, 12);
    expect(f.float.massKg).toBeCloseTo(28.8 * RHO_SEA, 9);
    expect(f.hydro).toMatchObject({ lwl: expect.closeTo(10, 9), bwl: expect.closeTo(3, 9), tc: expect.closeTo(1, 9), awM2: expect.closeTo(32, 9) });
    expect(f.chartroom).toMatchObject({ frame: "shared", vertical: "reference", dx: 0, h: REF, trimDeg: 0, name: "Fake" });
    expect(f.notes.join(" ")).toMatch(/Statics are Fake's hydrostatic table/);
    expect(f.notes.join(" ")).toMatch(/states no wetted area/);
  });

  it("at a stated displacement the mesh is cut at the table's waterplane, not immersed by its own volume", () => {
    const f = floatHull(MESH, { massKg: 32 * RHO_SEA, table: table(), tableFrame: "shared" });
    expect(f.float).toMatchObject({ from: "given", engine: "chartroom" });
    expect(f.float.volumeM3).toBeCloseTo(32, 9);
    expect(f.float.h).toBeCloseTo(0.1, 9); // the table's box sinks 0.1 m for 3.2 m³; the mesh alone would sink 32/30 − 1 = 0.0667 m
    expect(f.hydro.tc).toBeCloseTo(1.1, 9);
    expect(f.hydro.from.volumeM3).toBe("given");
    expect(floatHull(MESH, { massKg: 32 * RHO_SEA }).float.h).toBeCloseTo(32 / 30 - 1, 6);
  });

  it("the map to the table's frame is the one the hull was floated by (rigToTable makes no second alignment)", () => {
    const t = table();
    const f = floatHull(MESH, { table: t, tableFrame: "shared" });
    expect(rigToTable(t, f)).toBe(f.chartroom);
    expect(f.chartroom.map([1, 0.5, -0.2])).toEqual([1, 0.5, expect.closeTo(REF - 0.2, 12)]);
    // slid onto the mesh's LCB when nothing says the frames are shared
    const g = floatHull(MESH, { table: t, tableFrame: "aligned" });
    expect(g.chartroom).toMatchObject({ frame: "aligned", dx: expect.closeTo(5, 12) });
    expect(g.chartroom.map([1, 0.5, -0.2])[0]).toBeCloseTo(6, 12);
    // another table than the one that floated her: lined up by LCB, as before
    const other = table();
    expect(rigToTable(other, f)).not.toBe(f.chartroom);
    expect(rigToTable(other, f).available).toBe(true);
  });

  const fallbacks = [
    ["doesn't check out", { ...table(), format: "nope" }, null, /doesn't check out/],
    ["doesn't cover the displacement", table(), 70 * RHO_SEA, /outside the volumes/],
    ["has nothing under its reference waterplane", table({ reference: 5 }), null, /nothing below its reference waterplane/],
  ];
  for (const [name, t, massKg, why] of fallbacks)
    it(`a table that ${name} isn't the engine: the mesh is, wholly, and a note says why`, () => {
      const plain = floatHull(MESH, { massKg: massKg && 40 * RHO_SEA });
      const f = floatHull(MESH, { massKg: massKg && 40 * RHO_SEA, table: massKg ? boxTable({ ...T, D: 1.2, reference: REF }) : t, tableFrame: "shared" });
      expect(f.ok).toBe(true);
      expect(f.hydro.engine).toBe("mesh");
      expect(f.chartroom).toBeNull();
      expect(numeric(f.hydro)).toEqual(numeric(plain.hydro));
      expect(Object.values(f.hydro.from).every((v) => v === "mesh")).toBe(true);
      expect(f.notes.join(" ")).toMatch(/hydrostatic table isn't used/);
      expect(f.notes.join(" ")).toMatch(why);
      // one engine: the table isn't used for GZ either
      const doc = { hull: { link: { url: "automerge:x" } } };
      const linked = { mesh: { table: t } };
      expect(ownTableFor(doc, linked, f)).toBeNull();
      expect(staticsFor(doc, linked, f).source).toBe("mesh");
    });

  it("the table that floated her is the one GZ is read from", () => {
    const t = table({ heels: [0, 10] });
    const f = floatHull(MESH, { table: t, tableFrame: "shared" });
    const doc = { hull: { link: { url: "automerge:x" } } };
    expect(ownTableFor(doc, { mesh: { table: t } }, f)).toBe(t);
    expect(ownTableFor(doc, { mesh: { table: table() } }, f)).toBeNull();
    expect(ownTableFor({ hull: { link: null } }, { mesh: { table: t } }, f)).toBeFalsy();
    expect(staticsFor(doc, { mesh: { table: t } }, f)).toMatchObject({ source: "chartroom", table: t });
  });
});

// The same hull through both engines. A table built from the hull's own mesh (statics.js buildTable, with the
// reference waterplane and the asked displacement as exact samples) must give, through tableUpright, the
// figures the mesh engine reads off that mesh: 2 trims × 2 frames × 2 floats, on a real camber hull.
describe("a table built from the hull's own mesh gives the mesh's own figures", () => {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const glb = new Uint8Array(readFileSync(here("../test/fixtures/camber/narrow-transom.glb")));
  const tri = toHullFrame(glbTriangles(glb).triangles, { bow: "+X", up: "+Y" }); // the design waterline at z = 0
  const MASS = 9000;
  const H_REF = 1.7; // the producer's z datum is this far above the design waterline
  const KEYS = ["volumeM3", "lcb", "tcb", "vcb", "awM2", "lcf", "bmt", "bml", "wsaM2", "wsaCanoeM2", "cb", "cp", "cw", "lwl", "bwl", "tc", "cm", "amaxM2", "halfEntranceDeg"];
  for (const trimDeg of [0, 3]) {
    // the producer's hull-fixed frame: p = Rᵀ·(r + [0, 0, H_REF]), so r = R·p − [0, 0, H_REF] (camber's placement)
    const R = rotationRows(0, trimDeg);
    const body = new Float64Array(tri.length);
    for (let i = 0; i < tri.length; i += 3) {
      const w = [tri[i], tri[i + 1], tri[i + 2] + H_REF];
      for (let j = 0; j < 3; j++) body[i + j] = R[0][j] * w[0] + R[1][j] * w[1] + R[2][j] * w[2];
    }
    const own = buildTable(body, { heels: [0, 20], trims: [trimDeg], steps: 6, volumes: [MASS / RHO_SEA], reference: { heelDeg: 0, trimDeg, waterplaneOffsetM: H_REF } });
    for (const frame of ["shared", "aligned"])
      for (const massKg of [null, MASS])
        it(`trim ${trimDeg}°, ${frame} frame, ${massKg ? "a stated displacement" : "the design waterline"}`, () => {
          expect(validateTable(own).ok).toBe(true);
          const a = floatHull(tri, { massKg });
          const b = floatHull(tri, { massKg, table: own, tableFrame: frame });
          expect(b.hydro.engine).toBe("chartroom");
          expect(b.chartroom.trimDeg).toBe(trimDeg);
          expect(b.float.h).toBeCloseTo(a.float.h, 6);
          for (const k of KEYS) expect(Math.abs(b.hydro[k] - a.hydro[k]), k).toBeLessThan(1e-6 * Math.max(1, Math.abs(a.hydro[k])));
          expect(b.chartroom.dx).toBeCloseTo(0, 6); // the same hull in the same x: nothing to slide
          // KB is above the table's K reference, in the world's vertical
          const K = rotationRows(0, trimDeg).map((row) => row[2] * own.frame.knReferenceM[2]);
          expect(b.hydro.kRefZ).toBeCloseTo(K[2] - b.chartroom.h, 9);
          expect(b.hydro.kb).toBeCloseTo(b.hydro.vcb - b.hydro.kRefZ, 12);
          if (trimDeg === 0) expect(b.hydro.kmt).toBeCloseTo(a.hydro.kmt, 6);
          // and GZ through the float's own map is the table's GZ about the same G
          const G = [b.hydro.lcb, 0, 0.3];
          const r = rightingAt(own, { volumeM3: b.float.volumeM3, G: b.chartroom.map(G) }, { heelDeg: 0, trimDeg });
          expect(r.available).toBe(true);
          expect(r.gz).toBeCloseTo(0, 6);
          expect(r.trimLever).toBeCloseTo(0, 6); // B is over G fore and aft: LCB is where the table says
        });
  }
});
