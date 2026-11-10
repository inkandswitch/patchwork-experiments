// The rig GLB (glb-rig.js) and the scene source (scene-build.js): the GLB
// parses, carries the contract and sailing's lumped plan, and, placed on its
// hull at the identity, its forestay meets the stemhead, its chainplates sit
// on the sheer and the keel's root on the hull's bottom (within 2 cm, read
// off the hull's own mesh, not the aid's side view).

import { describe, it, expect } from "vitest";
import { parseGLB } from "./glb.js";
import { readAccessor, glbTriangles } from "./link/glb-read.js";
import { frameToGlb, buildRigGlb } from "./glb-rig.js";
import { buildRig } from "./rig-build.js";
import { RigSource, rigJobFor } from "./scene-build.js";
import { rigFingerprint, rigDependencies } from "./fingerprint.js";
import { normalize, defaultDoc } from "./doc.js";
import { plugins } from "./index.js";
import { buildCase, camberBytes } from "./test/contract-cases.js";

const TOL = 0.02; // m

/** A node's triangle or line vertices in the GLB's coordinates (its translation applied). */
function nodeVerts(bytes, name) {
  const { json, bin } = parseGLB(bytes);
  const node = json.nodes.find((n) => n.name === name);
  if (!node || node.mesh == null) return null;
  const t = node.translation ?? [0, 0, 0];
  const out = [];
  for (const p of json.meshes[node.mesh].primitives) {
    const pos = readAccessor(json, bin, p.attributes.POSITION);
    for (let i = 0; i < pos.length; i += 3) out.push([pos[i] + t[0], pos[i + 1] + t[1], pos[i + 2] + t[2]]);
  }
  return out;
}

/** The hull's vertices (glTF) in a slice |x − x0| < w. */
const slice = (tris, x0, w = 0.15) => {
  const out = [];
  for (let i = 0; i < tris.length; i += 3) if (Math.abs(tris[i] - x0) < w) out.push([tris[i], tris[i + 1], tris[i + 2]]);
  return out;
};

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The rig GLB for a case, and its hull's triangles in the same (glTF) coordinates. */
function rigFor(id) {
  const c = buildCase(id);
  const synthetic = !c.doc.hull.link;
  const { glb } = buildRigGlb(c.contract, { hullTriangles: synthetic ? c.n.form.mesh.triangles : null, bottomAt: c.n.analysis.geo.bottomAt });
  const hull = synthetic ? Float64Array.from(nodeVerts(glb, "SyntheticHull").flat()) : glbTriangles(camberBytes("cuvature-kink-with-unmodified-pchip")).triangles;
  return { ...c, glb, hull, X: frameToGlb(c.contract.frame.glbToFrame) };
}

describe("the rig GLB", () => {
  for (const id of ["sloop-12m", "cuvature-first-guess"])
    it(`${id}: parses, names its nodes, and carries the contract and sailing's lumped plan`, () => {
      const { glb, contract, X } = rigFor(id);
      const { json } = parseGLB(glb);
      const names = json.nodes.map((n) => n.name);
      for (const want of ["Rig", "Mast", "Boom", "Spreaders", "Rigging", "Sail", "Jib", "Keel", "Rudder", "Stock"]) expect(names).toContain(want);
      expect(names.includes("SyntheticHull")).toBe(id === "sloop-12m");
      expect(json.asset.extras.units).toBe("m");
      const ex = json.scenes[0].extras;
      expect(ex.rig).toEqual(JSON.parse(JSON.stringify(contract)));
      // sailing's sailOf reads { tack: vec3, luff, foot, area > 0 } in the rig's own frame
      const plan = ex.sail.plan;
      expect(plan.tack).toEqual(X.point(contract.lumpedSail.tackM));
      for (const k of ["luff", "foot", "area"]) expect(plan[k]).toBeGreaterThan(0);
      // the main's node is at the gooseneck and the sail is all above it, so scaling its Y lowers it to the boom
      const sail = json.nodes.find((n) => n.name === "Sail");
      expect(sail.translation).toEqual(X.point(contract.sails[0].tackM));
      const verts = nodeVerts(glb, "Sail");
      expect(Math.min(...verts.map((v) => v[1] - sail.translation[1]))).toBeGreaterThan(-1e-5);
      console.log(`  ${id}: ${(glb.byteLength / 1024).toFixed(0)} kB, nodes ${names.join(", ")}`);
    });

  for (const id of ["sloop-12m", "cuvature-first-guess"])
    it(`${id}: at the identity on its hull, the forestay's tack is its doc's distance aft of the stemhead, the chainplates sit on the sheer, the keel's root on the bottom`, () => {
      const { glb, contract: c, hull, X, doc } = rigFor(id);
      const rows = [];
      // the stemhead on the hull's own mesh: its foremost vertices, the highest of them
      let maxX = -Infinity;
      for (let i = 0; i < hull.length; i += 3) maxX = Math.max(maxX, hull[i]);
      const bow = slice(hull, maxX, 0.03);
      const stem = bow.reduce((a, b) => (b[1] > a[1] ? b : a));
      const lines = nodeVerts(glb, "Rigging");
      const tack = X.point(c.rig.standing.find((s) => s.id === "forestay").fromM);
      expect(lines.some((v) => near(v, tack) < 1e-5)).toBe(true);
      // the tack: at the stemhead's height, the doc's forestayAftOfStem aft of it (0 on the stock sloop;
      // the first guess sets it where the lead is in its band). Both hulls' bows are +X in their glTF.
      const aft = doc.rig.forestayAftOfStem;
      expect(aft).toBeGreaterThanOrEqual(0);
      if (id === "sloop-12m") expect(aft).toBe(0);
      else expect(aft).toBeGreaterThan(1);
      rows.push([`forestay tack, ${aft.toFixed(2)} m aft of the stemhead`, near([tack[0] + aft, tack[1], tack[2]], stem)]);
      // chainplates: on the sheer (the highest vertex at that station), inside the hull's breadth there
      for (const cp of c.hardpoints.chainplates) {
        const p = X.point(cp.atM);
        expect(lines.some((v) => near(v, p) < 1e-5)).toBe(true);
        const s = slice(hull, p[0]);
        const sheerY = Math.max(...s.map((v) => v[1]));
        const half = Math.max(...s.map((v) => Math.abs(v[2])));
        rows.push([`chainplate ${cp.id} to the sheer`, Math.abs(p[1] - sheerY)]);
        expect(Math.abs(p[2])).toBeLessThan(half);
      }
      // the keel's root: at the canoe body's underside at its quarter chord
      const k = c.appendages.find((a) => a.id === "keel");
      const rootLE = X.point(k.cornersM.rootLE);
      const xq = rootLE[0] - k.rootChordM / 4;
      const below = slice(hull, xq, 0.1).filter((v) => Math.abs(v[2]) < 0.15);
      const bottomY = Math.min(...below.map((v) => v[1]));
      rows.push(["keel root to the hull's bottom", Math.abs(rootLE[1] - bottomY)]);
      // and its drawn root reaches up into the hull at the LE and TE (no gap shows)
      const keel = nodeVerts(glb, "Keel");
      const topOf = (x) => Math.max(...keel.filter((v) => Math.abs(v[0] - x) < 0.05).map((v) => v[1]));
      for (const x of [rootLE[0] - 0.02, rootLE[0] - k.rootChordM + 0.02]) {
        const hb = Math.min(...slice(hull, x, 0.1).filter((v) => Math.abs(v[2]) < 0.15).map((v) => v[1]));
        expect(topOf(x)).toBeGreaterThan(hb - TOL);
      }
      console.log(`\n${id}, rig at the identity on its hull (m):\n${rows.map(([k2, v]) => `  ${k2.padEnd(30)} ${v.toFixed(4)}  (≤ ${TOL})`).join("\n")}`);
      for (const [k2, v] of rows) expect(v, k2).toBeLessThan(TOL);
    });

  it("a cat has no stays, spreaders or jib; sails can be left out; the stock's tube reaches the deck", () => {
    const { contract: c, n } = buildCase("laser-ilca7");
    const { glb } = buildRigGlb(c, { sails: false });
    const names = parseGLB(glb).json.nodes.map((x) => x.name);
    expect(names).not.toContain("Rigging");
    expect(names).not.toContain("Spreaders");
    expect(names).not.toContain("Sail");
    expect(names).not.toContain("Jib");
    const X = frameToGlb(c.frame.glbToFrame);
    const deck = X.point(c.appendages.find((a) => a.id === "rudder").stock.deckM);
    const stock = nodeVerts(glb, "Stock");
    expect(Math.max(...stock.map((v) => v[1]))).toBeGreaterThan(deck[1]);
    expect(n.form.kind).toBe("synthetic");
  });
});

describe("the scene source", () => {
  it("registers as a scene:source for rig-design docs, with a version, params and a lazy load", () => {
    const p = plugins.find((x) => x.type === "scene:source");
    expect(p).toMatchObject({ id: "rig-design", supportedDatatypes: ["rig-design"], cost: "expensive", version: 1 });
    expect(p.params.map((x) => x.key)).toEqual(["sails", "hull"]);
    expect(structuredClone({ ...p, load: undefined }).id).toBe("rig-design");
  });

  it("fingerprint: changes with what the build reads, not with key order; dependencies are the linked hull", () => {
    const a = normalize(defaultDoc());
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    expect(rigFingerprint(reordered)).toBe(rigFingerprint(a));
    const b = structuredClone(a);
    b.rig.P += 0.1;
    expect(rigFingerprint(b)).not.toBe(rigFingerprint(a));
    const t = structuredClone(a);
    t.title = "Renamed";
    expect(rigFingerprint(t)).not.toBe(rigFingerprint(a)); // the title is the contract's name
    expect(rigDependencies(a)).toEqual([]);
    const l = structuredClone(a);
    l.hull.link = { url: "automerge:hull", frame: { bow: "+X", up: "+Y" } };
    expect(rigDependencies(l)).toEqual(["automerge:hull"]);
    const f = structuredClone(l);
    f.hull.link.frame = { bow: "-X", up: "+Y" };
    expect(rigFingerprint(f)).not.toBe(rigFingerprint(l));
  });

  it("builds a synthetic rig to a GLB with bounds; a hull not reachable here throws (the host keeps the last render and retries); one that is the same everywhere is an empty GLB that says why", async () => {
    const r = await RigSource.build({ doc: defaultDoc(), params: { sails: true, hull: true }, url: "automerge:rig" });
    expect(r.kind).toBe("glb");
    const { json } = parseGLB(r.glb);
    expect(json.scenes[0].extras.rig.format).toBe("patchwork-rig");
    expect(r.meta.bounds.max[1]).toBeGreaterThan(14); // the masthead, 14.4 m above the waterline
    const linked = normalize({ ...defaultDoc(), hull: { ...defaultDoc().hull, link: { url: "automerge:gone", frame: { bow: "+X", up: "+Y" } } } });
    // not synced to this peer yet: transient, so it throws rather than store an empty rig
    await expect(RigSource.build({ doc: linked, params: {}, url: "automerge:rig", repo: { find: async () => Promise.reject(new Error("unknown")) } })).rejects.toThrow(/linked hull can't be read/);
    // linked to another rig: the same on every peer, so an empty GLB that says why
    const rigDoc = { ...defaultDoc(), "@patchwork": { type: "rig-design" } };
    const bad = await RigSource.build({ doc: linked, params: {}, url: "automerge:rig", repo: { find: async () => ({ url: "automerge:gone", doc: () => rigDoc, heads: () => [], on() {}, off() {} }) } });
    expect(bad.kind).toBe("glb");
    expect(bad.meta.notes).toMatch(/can't be the hull of another rig/);
    expect(parseGLB(bad.glb).json.meshes ?? []).toEqual([]);
  });

  it("a linked GLB file: the job carries its mesh and says where it came from; the build is the contract's", async () => {
    const urls = { file: "automerge:g1b1111111111111111111111", rig: "automerge:r1g1111111111111111111111" };
    const fileDoc = { "@patchwork": { type: "file" }, name: "cuvature.glb", extension: "glb", content: camberBytes("cuvature-kink-with-unmodified-pchip") };
    const repo = { find: async (u) => (u === urls.file ? { url: u, doc: () => fileDoc, heads: () => ["abc"], on() {}, off() {} } : Promise.reject(new Error("unknown"))) };
    const { doc } = buildCase("cuvature-first-guess");
    const d = structuredClone(doc);
    d.hull.link.url = urls.file;
    const j = await rigJobFor({ doc: d, url: urls.rig, repo, params: { sails: true }, handle: { heads: () => ["r1"] } });
    expect(j.job.type).toBe("rig");
    expect(j.job.source).toMatchObject({ rigDoc: urls.rig, rigHeads: ["r1"], hull: { path: "file", heads: ["abc"] } });
    const r = buildRig(j.job);
    expect(r.ok, r.why).toBe(true);
    expect(r.contract.source.hull).toMatchObject({ kind: "linked", url: urls.file, path: "file", heads: ["abc"] });
    expect(r.contract.predicted.points).toEqual(buildCase("cuvature-first-guess").contract.predicted.points);
  });
});
