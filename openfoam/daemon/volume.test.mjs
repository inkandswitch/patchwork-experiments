import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { volumeFiles, keepVolume } from "./volume.mjs";
import { parseFoam, readVolume, volumeBytes, VOLUME_TYPE } from "../src/volume.js";
import { serverWatch, isRef, INLINE_BYTES } from "../src/segments.js";

// OpenFOAM binary files, as it writes them
const header = (cls, object, extra = "") =>
  `FoamFile\n{\n    version     2.0;\n    format      binary;\n    arch        "LSB;label=32;scalar=64";\n    class       ${cls};\n    location    "x";\n    object      ${object};\n}\n// * * //\n\n${extra}`;
const list = (typed) => Buffer.concat([Buffer.from(`${typed.length / (typed.k ?? 1)}\n(`), Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), Buffer.from(")\n")]);
const withK = (a, k) => Object.assign(a, { k });
const file = (head, ...parts) => Buffer.concat([Buffer.from(head), ...parts, Buffer.from("\n\n// ***** //\n")]);
const points = (n) => file(header("vectorField", "points"), list(withK(Float64Array.from({ length: n * 3 }, (_, i) => i / 10), 3)));
const labels = (object, n) => file(header("labelList", object), list(Int32Array.from({ length: n }, (_, i) => i % 7)));
const faces = () => file(header("faceCompactList", "faces"), list(Int32Array.from([0, 4, 8])), Buffer.from("\n\n"), list(Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7])));
const scalarField = (object, n, seed) =>
  file(header("volScalarField", object, "dimensions      [0 2 -2 0 0 0 0];\n\ninternalField   nonuniform List<scalar> \n"), list(Float64Array.from({ length: n }, (_, i) => seed + i)), Buffer.from(";\n\nboundaryField\n{\n}\n"));
const vectorField = (object, n) => file(header("volVectorField", object, "internalField   nonuniform List<vector> \n"), list(withK(Float64Array.from({ length: n * 3 }, (_, i) => -i), 3)), Buffer.from(";\n"));
const uniformField = (object) => file(header("volScalarField", object, "internalField   uniform 0.5;\n"));

describe("parseFoam", () => {
  it("reads points, labels, compact faces and fields as typed arrays", () => {
    const p = parseFoam(points(4));
    expect(p.components).toBe(3);
    expect([...p.values.slice(0, 4)]).toEqual([0, 0.1, 0.2, 0.3]);
    expect([...parseFoam(labels("owner", 9)).values]).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1]);
    const f = parseFoam(faces());
    expect([...f.offsets]).toEqual([0, 4, 8]);
    expect([...f.labels]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const s = parseFoam(scalarField("p", 5, 10));
    expect([s.components, [...s.values]]).toEqual([1, [10, 11, 12, 13, 14]]);
    const u = parseFoam(vectorField("U", 2));
    expect([u.components, [...u.values]]).toEqual([3, [-0, -1, -2, -3, -4, -5]]);
    expect(parseFoam(uniformField("k")).uniform).toEqual([0.5]);
  });
  it("refuses a list whose count doesn't match its bytes", () => {
    const b = points(4);
    const bad = Buffer.from(b.toString("latin1").replace("\n4\n(", "\n5\n("), "latin1");
    expect(() => parseFoam(bad)).toThrow();
  });
});

/** The memRepo of src/segments.test.js, with a server that has everything. */
function memRepo() {
  const docs = new Map();
  const listeners = new Set();
  let n = 0;
  return {
    docs,
    async create2(v) {
      const id = `d${++n}`;
      const doc = structuredClone(v);
      const h = { url: `automerge:${id}`, documentId: id, doc: () => doc, heads: () => [`${id}-h`] };
      docs.set(h.url, h);
      queueMicrotask(() => listeners.forEach((fn) => fn({ documentId: id, heads: h.heads() })));
      return h;
    },
    async find(url) {
      const h = docs.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
    on: (ev, fn) => listeners.add(fn),
    off: (ev, fn) => listeners.delete(fn),
    resyncSubduction() {},
  };
}

describe("keepVolume / readVolume", () => {
  let dir;
  const big = Math.ceil((INLINE_BYTES * 1.5) / 8); // a p big enough to go in segments
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "volume-"));
    for (const [i, piece] of ["processor0", "processor1"].entries()) {
      const m = join(dir, piece, "constant", "polyMesh");
      mkdirSync(m, { recursive: true });
      writeFileSync(join(m, "points"), points(4 + i));
      writeFileSync(join(m, "faces"), faces());
      writeFileSync(join(m, "owner"), labels("owner", 3));
      writeFileSync(join(m, "neighbour"), labels("neighbour", 1));
      writeFileSync(join(m, "boundary"), "boundary");
      writeFileSync(join(m, "cellLevel"), "snappy's, not kept");
      for (const t of ["0", "100", "250"]) mkdirSync(join(dir, piece, t), { recursive: true });
      writeFileSync(join(dir, piece, "250", "p"), scalarField("p", big, i * 1000));
      writeFileSync(join(dir, piece, "250", "U"), vectorField("U", 3));
      writeFileSync(join(dir, piece, "100", "p"), scalarField("p", 2, 0));
      mkdirSync(join(dir, piece, "250", "uniform"));
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the last time, every piece, and the files by meaning", () => {
    const v = volumeFiles(dir);
    expect(v.time).toBe("250");
    expect(v.pieces).toEqual(["processor0", "processor1"]);
    expect(Object.keys(v.mesh)).toEqual(["points", "faces", "owner", "neighbour", "boundary"]);
    expect(Object.keys(v.fields)).toEqual(["U", "p"]);
  });

  it("keeps it, confirmed, and reads back exactly what was asked for", async () => {
    const repo = memRepo();
    const ticks = [];
    const kept = await keepVolume({ repo, dir, runUrl: "automerge:run", title: "t", watch: serverWatch(repo), progress: (p) => ticks.push(p), cells: 7 });
    expect(kept.missing).toEqual([]);
    expect(kept.confirmed).toBe(true);
    expect(kept.files).toBe(2 * (5 + 2));
    expect(ticks.at(-1)).toEqual({ done: kept.bytes, of: kept.bytes });
    const doc = (await repo.find(kept.url)).doc();
    expect(doc["@patchwork"].type).toBe(VOLUME_TYPE);
    expect(isRef(doc.fields.p[0]) && isRef(doc.fields.p[1])).toBe(true); // big: segments
    expect(isRef(doc.mesh.owner[0])).toBe(false); // small: inline

    expect(volumeBytes(doc, { mesh: false, fields: ["p"], pieces: [1] })).toBe(doc.fields.p[1].size);
    const r = await readVolume(repo, doc, { mesh: ["points"], fields: ["p"], pieces: [1], find: (rp, u) => rp.find(u) });
    expect(r.pieces).toEqual(["processor0", "processor1"]);
    expect(r.mesh.points[0]).toBeUndefined();
    expect(parseFoam(r.mesh.points[1]).values.length).toBe(5 * 3);
    const p = parseFoam(r.fields.p[1]);
    expect(p.values.length).toBe(big);
    expect(p.values[0]).toBe(1000);
    expect(r.fields.U).toBeUndefined();
  });

  it("says what the server never acknowledged", async () => {
    const repo = memRepo();
    const silent = { wait: async (hs) => ({ ok: false, missing: hs.map((h) => h.url) }) };
    const kept = await keepVolume({ repo, dir, runUrl: "automerge:run", title: "t", watch: silent, timeoutMs: 10 });
    expect(kept.confirmed).toBe(false);
    expect(kept.missing).toEqual(expect.arrayContaining(["p (processor0)", "p (processor1)", "the index"]));
  });
});
