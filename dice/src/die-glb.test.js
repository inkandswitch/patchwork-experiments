// A die's GLB: at real size, standing on y = 0, its triangles facing out,
// and saying what it is in extras.dice, for every preset.
import { describe, it, expect } from "vitest";
import { builtDie, dieGLB, strokeOutlines } from "./die-glb.js";
import { PRESETS, dieOf } from "./die.js";
import { parseGLB } from "./glb.js";
import { builtOf, faceUp, showing } from "./roll.js";
import { solid } from "./solids.js";
import Source from "./source.js";
import { plugins } from "./index.js";

/** A GLB's primitives: [{ mesh, positions, normals, indices, color }]. */
function primitives(glb) {
  const { json, bin } = parseGLB(glb);
  const read = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC3: 3 }[a.type];
    const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const buf = bin.buffer.slice(off, off + a.count * size * (a.componentType === 5126 || a.componentType === 5125 ? 4 : 2));
    return a.componentType === 5126 ? new Float32Array(buf) : a.componentType === 5125 ? new Uint32Array(buf) : new Uint16Array(buf);
  };
  return json.meshes.flatMap((m) => m.primitives.map((p) => ({ mesh: m.name, positions: read(p.attributes.POSITION), normals: read(p.attributes.NORMAL), indices: read(p.indices), color: json.materials[p.material].pbrMetallicRoughness.baseColorFactor })));
}

describe.each(Object.keys(PRESETS))("the GLB of the preset %s", (id) => {
  const doc = PRESETS[id].make();
  const { glb, bounds, built } = dieGLB(doc);
  const die = dieOf(doc);
  const prims = primitives(glb);
  const json = parseGLB(glb).json;

  it("is in metres, at the die's real size, standing on y = 0 over the origin", () => {
    expect(json.asset.extras.units).toBe("m");
    const proud = die.size * 0.0041;
    expect(bounds.min[1]).toBeGreaterThanOrEqual(-proud);
    expect(bounds.min[1]).toBeLessThanOrEqual(0);
    const across = die.shape === "coin" ? bounds.max[0] - bounds.min[0] : bounds.max[1] - bounds.min[1];
    expect(across).toBeGreaterThanOrEqual(die.size - 1e-9);
    expect(across).toBeLessThanOrEqual(die.size + 2 * proud + 1e-9);
    // the solid's own corners: exactly its size, exactly on y = 0
    const body = prims.filter((p) => p.mesh === "die");
    const ys = body.flatMap((p) => Array.from(p.positions).filter((_, i) => i % 3 === 1));
    expect(Math.min(...ys)).toBeCloseTo(0, 7);
    if (die.shape !== "coin") expect(Math.max(...ys)).toBeCloseTo(die.size, 7);
    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(0, 4);
  });

  it("every triangle faces the way its normals say: out of the solid", () => {
    for (const p of prims) {
      expect(p.indices.length % 3).toBe(0);
      for (let t = 0; t < p.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((x) => p.positions[p.indices[t + k] * 3 + x]));
        const n = [0, 1, 2].map((x) => p.normals[p.indices[t] * 3 + x]);
        const u = a.map((v, k) => b[k] - v), w = a.map((v, k) => c[k] - v);
        const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        expect(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]).toBeGreaterThan(0);
      }
    }
  });

  it("the solid is drawn whole: each side a fan, in the colours the die says", () => {
    const s = solid(die.shape);
    const body = prims.filter((p) => p.mesh === "die");
    expect(body.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(s.polys.reduce((n, p) => n + p.verts.length - 2, 0));
    expect(body).toHaveLength(new Set([die.body, ...die.faces.map((f) => f.color).filter(Boolean)]).size);
    const marked = die.faces.some((f) => f.marks.length);
    expect(prims.some((p) => p.mesh === "marks")).toBe(marked);
  });

  it("says what it is: every face's up and label, the solid's corners and middle, as the scene reads them back", () => {
    const said = json.scenes[0].extras.dice;
    expect(said).toEqual(built);
    expect(builtOf(said)).toBeTruthy();
    expect(said).toEqual(builtDie(die));
    expect(said.shape).toBe(die.shape);
    expect(said.turnOnly).toBe(die.turnOnly);
    expect(said.faces.map((f) => f.label)).toEqual(die.faces.map((f) => f.label));
    const s = solid(die.shape);
    said.faces.forEach((f, i) => {
      f.up.forEach((v, k) => expect(v).toBeCloseTo(s.outcomes[i].up[k], 8));
      expect(f.rest).toBeCloseTo(s.outcomes[i].rest * die.size, 8);
    });
    expect(said.centre).toEqual([0, said.faces[0].rest, 0]);
    // as it stands in the GLB it shows face 0, and each face shown reads back from what it said
    expect(faceUp([0, 0, 0], said)).toBe(0);
    said.faces.forEach((_, i) => expect(faceUp(showing(said, i, 1), said)).toBe(i));
  });
});

describe("the die's marks as triangles", () => {
  it("a stroke is a strip per step and a round joint at each point, all anticlockwise; a closed one joins up", () => {
    const area = (o) => o.reduce((s, a, k) => s + (a[0] * o[(k + 1) % o.length][1] - o[(k + 1) % o.length][0] * a[1]) / 2, 0);
    const open = strokeOutlines({ points: [[0, 0], [1, 0], [1, 1]], width: 0.1 });
    expect(open).toHaveLength(2 + 3);
    for (const o of open) expect(area(o)).toBeGreaterThan(0);
    expect(area(open[0])).toBeCloseTo(0.1, 12);
    const closed = strokeOutlines({ points: [[0, 0], [1, 0], [1, 1]], closed: true, width: 0.1 });
    expect(closed).toHaveLength(3 + 3);
    for (const o of closed) expect(area(o)).toBeGreaterThan(0);
    // a point repeated draws no strip
    expect(strokeOutlines({ points: [[0, 0], [0, 0]], width: 0.1 })).toHaveLength(2);
  });

  it("a face's own colour is that side's, and its own ink its marks'", () => {
    const doc = PRESETS.d6.make();
    doc.faces[0].color = "#ff0000";
    doc.faces[0].ink = "#00ff00";
    const prims = primitives(dieGLB(doc).glb);
    const red = prims.filter((p) => p.mesh === "die" && p.color[0] === 1 && p.color[1] === 0);
    expect(red).toHaveLength(1);
    // one side: a square, two triangles, facing up (face 0)
    expect(red[0].indices.length).toBe(6);
    expect(Array.from(red[0].normals.slice(0, 3)).map((v) => +v.toFixed(6) + 0)).toEqual([0, 1, 0]);
    const green = prims.filter((p) => p.mesh === "marks" && p.color[1] === 1 && p.color[0] === 0);
    expect(green).toHaveLength(1);
    const ys = Array.from(green[0].positions).filter((_, i) => i % 3 === 1);
    for (const y of ys) expect(y).toBeGreaterThan(0.016);
  });
});

describe("the scene:source", () => {
  const spec = plugins.find((p) => p.type === "scene:source");

  it("is this package's provider for die docs: cheap, versioned, no params", () => {
    expect(spec).toMatchObject({ id: "die", supportedDatatypes: ["die"], params: [], cost: "cheap", version: 1 });
  });

  it("builds a die doc to its GLB and bounds, and whatever else a doc holds to a d6", async () => {
    const impl = await spec.load();
    expect(impl).toBe(Source);
    const doc = PRESETS.d20.make();
    const r = await impl.build({ doc, params: {} });
    expect(r.kind).toBe("glb");
    expect(r.glb).toEqual(dieGLB(doc).glb);
    expect(r.meta.bounds).toEqual(dieGLB(doc).bounds);
    const odd = await impl.build({ doc: { title: "?" }, params: {} });
    expect(parseGLB(odd.glb).json.scenes[0].extras.dice.shape).toBe("d6");
  });

  it("is stale only when the die itself changes: a roll in its panel or a new title builds nothing", () => {
    const doc = PRESETS.d6.make();
    const fp = Source.fingerprint(doc);
    expect(Source.fingerprint({ ...doc, title: "x", rolls: [{ face: 2, how: "rolled", at: 5 }] })).toBe(fp);
    expect(Source.fingerprint({ ...doc, body: "#123456" })).not.toBe(fp);
  });
});
