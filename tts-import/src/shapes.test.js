import { describe, it, expect } from "vitest";
import { bake, box, ellipseOutline, hexOutline, lathe, polyhedron, rectOutline, roundedOutline, slab } from "./shapes.js";

const tri = (p, i) => [0, 1, 2].map((k) => [...p.positions.slice(p.indices[i + k] * 3, p.indices[i + k] * 3 + 3)]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Every triangle of a convex shape around the origin faces away from it. */
function allOutward(parts) {
  for (const p of parts)
    for (let i = 0; i < p.indices.length; i += 3) {
      const [a, b, c] = tri(p, i);
      const n = cross(sub(b, a), sub(c, a));
      const centre = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
      if (Math.hypot(...n) > 1e-12 && dot(n, centre) <= 0) return false;
    }
  return true;
}

describe("shapes", () => {
  it("wind every triangle outward, before and after the mirror of baking", () => {
    const shapes = [
      slab(rectOutline(1.1, 1.55), 0.02),
      slab(roundedOutline(2, 1, 0.2), 0.2),
      slab(ellipseOutline(1, 1), 0.1, { smoothSides: true }),
      slab(hexOutline(1, 0.866), 0.1),
      box(1, 1, 1),
      polyhedron(20, 0.75),
      polyhedron(12, 0.75),
      polyhedron(8, 0.75),
      polyhedron(4, 0.75),
      polyhedron(10, 0.75),
    ];
    for (const parts of shapes) {
      expect(allOutward(parts)).toBe(true);
      expect(allOutward(bake(parts, [2, 1, 0.5], 0.0254))).toBe(true);
    }
  });

  it("put a top image's top-left corner at -z, +x (TTS frame), and the back's at -z, -x", () => {
    const [top, bottom] = slab(rectOutline(1, 2), 0.1);
    const at = (p, u, v) => {
      for (let i = 0; i < p.uvs.length / 2; i++) if (Math.abs(p.uvs[i * 2] - u) < 1e-9 && Math.abs(p.uvs[i * 2 + 1] - v) < 1e-9) return [...p.positions.slice(i * 3, i * 3 + 3)];
      return null;
    };
    expect(at(top, 0, 0)).toEqual([1, 0.05, -2]);
    expect(at(top, 1, 1)).toEqual([-1, 0.05, 2]);
    expect(at(bottom, 0, 0)).toEqual([-1, -0.05, -2]);
    // baked into the scene (z mirrored): the image's top edge is at +z
    const [btop] = bake([top], [1, 1, 1], 1);
    const i = [...Array(btop.uvs.length / 2).keys()].find((k) => btop.uvs[k * 2] === 0 && btop.uvs[k * 2 + 1] === 0);
    expect([...btop.positions.slice(i * 3, i * 3 + 3)].map((v) => +v.toFixed(6))).toEqual([1, 0.05, 2]);
  });

  it("bake scales, mirrors z, turns normals and re-winds", () => {
    const [p] = box(2, 2, 2);
    const [b] = bake([p], [1, 2, 3], 0.5);
    let maxZ = -Infinity;
    for (let i = 2; i < b.positions.length; i += 3) maxZ = Math.max(maxZ, b.positions[i]);
    expect(maxZ).toBeCloseTo(1.5);
    for (let i = 0; i < b.normals.length; i += 3) expect(Math.hypot(b.normals[i], b.normals[i + 1], b.normals[i + 2])).toBeCloseTo(1);
    expect(b.indices[1]).toBe(p.indices[2]);
    expect(b.indices[2]).toBe(p.indices[1]);
  });

  it("lathes and hexes have the expected extents", () => {
    const [l] = lathe([[0, 0], [1, 0], [0.5, 2], [0, 2]], { segments: 8 });
    const ys = l.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBe(2);
    expect(hexOutline(1, 0.866).length).toBe(6);
  });
});
