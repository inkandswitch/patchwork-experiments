// The ground's grain: the shader edits, and dressing a tree of meshes and putting it back (every mesh).
import { describe, it, expect } from "vitest";
import { addGrain, dressGrain, ANCHORS, GRAIN_LOOK } from "./grain.js";
import { groundGrain, GRAINS, tiles, GRAIN } from "./build.js";
import { COVER } from "./cover.js";

const shader = () => ({ vertexShader: `void main() {\n${ANCHORS.vertex}\n}`, fragmentShader: `void main() {\n${ANCHORS.fragment}\n}` });

describe("the grain's shader edits", () => {
  it("declares its attribute and varyings, sets them after the projection, and scales the diffuse colour by both octaves faded by distance, once", () => {
    const s = shader();
    expect(addGrain(s)).toBe(true);
    expect(s.vertexShader.startsWith("attribute float _grain;")).toBe(true);
    expect(s.vertexShader.indexOf("vGrain = _grain;")).toBeGreaterThan(s.vertexShader.indexOf(ANCHORS.vertex));
    expect(s.fragmentShader.indexOf("diffuseColor.rgb *= 1.0 + grainAt * g;")).toBeGreaterThan(s.fragmentShader.indexOf(ANCHORS.fragment));
    for (const [m, a] of GRAIN_LOOK.octaves) expect(s.fragmentShader).toContain(`vGrainPos.xz / ${Number.isInteger(m) ? `${m}.0` : m}`) && expect(s.fragmentShader).toContain(`${a} * (2.0 * grainNoise`);
    expect(s.fragmentShader).toContain("smoothstep(150.0, 300.0, length(vViewPosition))");
    const again = { ...s };
    expect(addGrain(again)).toBe(false);
    expect(again).toEqual(s);
  });
  it("leaves a shader without the anchors alone", () => {
    const s = { vertexShader: "void main() {}", fragmentShader: `void main() {\n${ANCHORS.fragment}\n}` };
    expect(addGrain(s)).toBe(false);
    expect(s.vertexShader).toBe("void main() {}");
  });
});

describe("dressing the ground's materials", () => {
  const mat = (name) => ({ name, needsUpdate: false, onBeforeCompile(sh) { sh.own = name; }, customProgramCacheKey() { return name; } });
  const ground = mat("ground"), trees = mat("trees"), shared = mat("shared");
  const mesh = (m, grain) => ({ isMesh: true, material: m, geometry: { attributes: grain ? { _grain: {} } : {} } });
  const all = [mesh(ground, true), mesh(shared, true), mesh(shared, true), mesh(trees, false)];
  const root = { traverse: (fn) => all.forEach(fn) };
  it("dresses each material of a mesh with the grain once, chains its own onBeforeCompile, keys its program apart, and puts every one back", () => {
    const before = all.map((o) => [o.material.onBeforeCompile, o.material.customProgramCacheKey]);
    const d = dressGrain(root);
    expect(d.count).toBe(2);
    for (const m of [ground, shared]) {
      const s = shader();
      m.onBeforeCompile(s);
      expect(s.own).toBe(m.name);
      expect(s.vertexShader).toContain("vGrainPos");
      expect(m.customProgramCacheKey()).toBe(`${m.name}|terrain-grain`);
      expect(m.needsUpdate).toBe(true);
    }
    expect(trees.customProgramCacheKey()).toBe("trees");
    d.undo();
    all.forEach((o, q) => {
      expect(o.material.onBeforeCompile).toBe(before[q][0]);
      expect(o.material.customProgramCacheKey).toBe(before[q][1]);
    });
  });
});

describe("the ground's grain by vertex", () => {
  // a 5 × 5 grid 10 m apart; cover by column: none, rock, beach, wood, residential; the apron the middle node
  const n = 5, grid = { n, cell: 10, x0: 0, z0: 0 };
  const cover = new Uint8Array(n * n), apron = new Uint8Array(n * n);
  const kinds = [COVER.none, COVER.rock, COVER.beach, COVER.wood, COVER.residential];
  for (let k = 0; k < n * n; k++) cover[k] = kinds[k % n];
  apron[12] = 1;
  it("is none under the water, the apron's full with its puddles, the shore's full, then by cover (every node at four heights)", () => {
    for (const y of [-1, 0.5, 2.5, 10]) {
      const pos = new Float32Array(n * n * 3);
      for (let k = 0; k < n * n; k++) pos.set([(k % n) * 10, y, Math.floor(k / n) * 10], k * 3);
      const g = groundGrain(pos, grid, { cover, apron, apronAbove: 0.9, shoreTop: 3 });
      for (let k = 0; k < n * n; k++) {
        const want = y <= -0.3 ? GRAINS.water : apron[k] && y > 0.9 ? GRAINS.apron : y <= 3 ? GRAINS.shore : cover[k] === COVER.rock ? GRAINS.rock : cover[k] === COVER.beach ? GRAINS.beach : GRAINS.land;
        expect(g[k]).toBe(Math.fround(want));
      }
    }
  });
  it("travels with its vertices when the ground is cut into tiles (every vertex of every tile)", () => {
    const m = 40, V = m * m, pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), gr = new Float32Array(V);
    const tris = [];
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const v = j * m + i;
      pos.set([i, 0, j], v * 3);
      gr[v] = (v % 7) / 7;
      if (i < m - 1 && j < m - 1) tris.push(v, v + m, v + 1, v + 1, v + m, v + m + 1);
    }
    const parts = tiles(pos, nor, col, Uint32Array.from(tris), 500, gr);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      const a = p.attributes[GRAIN];
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(gr[p.positions[i * 3 + 2] * m + p.positions[i * 3]], 6);
    }
  });
});

import { PUDDLES, puddleAt, grainNoise, GRAIN_LOOK, addGrain } from "./grain.js";
describe("a worked yard's puddles (grain over 1)", () => {
  // the boatyard's apron box, every half metre (about 100 × 100 m round the courtyard)
  const pts = [];
  for (let z = -50; z < 50; z += 0.5) for (let x = -50; x < 50; x += 0.5) pts.push([x, z]);
  it("wets 15–22% of the ground (every half metre of a 100 m square)", () => {
    const wet = pts.reduce((a, [x, z]) => a + (puddleAt(x, z) > 0.5 ? 1 : 0), 0) / pts.length;
    expect(wet).toBeGreaterThanOrEqual(0.15);
    expect(wet).toBeLessThanOrEqual(0.22);
  });
  it("varies the yard's luminance by at least 8% (standard deviation over its mean) within 30 m of the eye, the grain's octaves and its puddles together", () => {
    const L = pts.filter(([x, z]) => Math.hypot(x, z) <= 30).map(([x, z]) => {
      const g = GRAIN_LOOK.octaves.reduce((a, [m, s], q) => a + s * (2 * grainNoise(x / m + q * 17, z / m + q * 17) - 1), 0);
      return (1 + PUDDLES.grain * g) * (1 - PUDDLES.darker * puddleAt(x, z));
    });
    const mean = L.reduce((a, b) => a + b, 0) / L.length;
    const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
    expect(sd / mean).toBeGreaterThanOrEqual(0.08);
  });
  it("gives the apron its puddles (grain 2) and nothing else over 1", () => {
    expect(GRAINS.apron).toBe(2);
    for (const [k, v] of Object.entries(GRAINS)) if (k !== "apron") expect(v).toBeLessThanOrEqual(1);
  });
  it("puts the puddles' darkening after the colour and their sheen after the roughness, in a standard material's shader", () => {
    const shader = { vertexShader: "void main(){\n#include <project_vertex>\n}", fragmentShader: "void main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n}" };
    expect(addGrain(shader)).toBe(true);
    const f = shader.fragmentShader;
    expect(f.indexOf("grainWet = clamp")).toBeGreaterThan(f.indexOf("#include <color_fragment>"));
    expect(f.indexOf("roughnessFactor = mix")).toBeGreaterThan(f.indexOf("#include <roughnessmap_fragment>"));
  });
});
