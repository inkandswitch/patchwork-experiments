// The cup, the table and the pool as GLBs: real size, and every triangle
// facing the way its normals say (they're drawn one-sided, so a triangle
// wound the wrong way would be a hole you could see under the cup through).

import { CUP_HEIGHT, CUP_MOUTH } from "./cup.js";
import { POOL_RADIUS, TABLE_RADIUS, TABLE_TOP, cupGLB, poolGLB, shade, tableGLB } from "./cup-glb.js";
import { parseGLB } from "./glb.js";

/** An accessor's numbers, from the GLB's binary chunk. */
function read({ json, bin }, index) {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Type(bin.buffer.slice(start, start + a.count * size * Type.BYTES_PER_ELEMENT));
}
function triangles(glb) {
  const parsed = parseGLB(glb);
  const out = [];
  for (const mesh of parsed.json.meshes ?? []) {
    for (const p of mesh.primitives) {
      const P = read(parsed, p.attributes.POSITION), N = read(parsed, p.attributes.NORMAL), I = read(parsed, p.indices);
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        const v = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
        const n = (i) => [N[3 * i], N[3 * i + 1], N[3 * i + 2]];
        out.push({ v: [v(a), v(b), v(c)], n: [n(a), n(b), n(c)] });
      }
    }
  }
  return out;
}
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("the cup, the table and the pool", () => {
  for (const [name, made] of [["cup", cupGLB("#884422")], ["table", tableGLB()], ["pool", poolGLB()]]) {
    it(`${name}: every triangle is wound the way its normals face`, () => {
      const tris = triangles(made.glb);
      expect(tris.length).toBeGreaterThan(50);
      let wrong = 0;
      for (const { v, n } of tris) {
        const g = cross(sub(v[1], v[0]), sub(v[2], v[0]));
        if (Math.hypot(...g) < 1e-14) continue; // a disc's centre: no area
        const avg = [0, 1, 2].map((i) => n[0][i] + n[1][i] + n[2][i]);
        if (dot(g, avg) <= 0) wrong++;
      }
      expect(wrong).toBe(0);
    });
  }
  it("are their real sizes", () => {
    const cup = cupGLB().bounds;
    expect(cup.min[1]).toBe(0);
    expect(cup.max[1]).toBeCloseTo(CUP_HEIGHT, 6);
    expect(cup.max[0]).toBeGreaterThanOrEqual(CUP_MOUTH);
    expect(cup.max[0]).toBeLessThan(CUP_MOUTH + 0.002);
    const table = tableGLB().bounds;
    expect(table.max[1]).toBeCloseTo(TABLE_TOP + 0.004, 6);
    expect(table.max[0]).toBeCloseTo(TABLE_RADIUS, 6);
    expect(table.min[1]).toBe(0);
    const pool = poolGLB().bounds;
    expect(pool.max[0]).toBeCloseTo(POOL_RADIUS, 6);
    expect(pool.min[1]).toBe(0);
  });
  it("shade darkens a colour", () => {
    expect(shade("#806040", 0.5)).toBe("#403020");
  });
});
