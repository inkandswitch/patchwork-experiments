import { describe, it, expect } from "vitest";
import { createOcean } from "./ocean.js";
import { createOceanSurface, detailWaves, foamThreshold, oceanGrid, snapOrigin, surfaceSlopeVariance, waveUniforms } from "./ocean-material.js";

// This package doesn't depend on three (the stage hands it one), so the
// surface is built here against just enough of three's shape to see what it
// asks for. What it looks like is the probe's business (probes/ocean-run.mjs).
function fakeThree() {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      Object.assign(this, { x, y, z });
      return this;
    }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      return this.set(this.x / l, this.y / l, this.z / l);
    }
  }
  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 0) {
      Object.assign(this, { x, y, z, w });
    }
    set(x, y, z, w) {
      Object.assign(this, { x, y, z, w });
      return this;
    }
  }
  class Color {
    constructor(v) {
      this.v = v;
    }
    set(v) {
      this.v = v;
      return this;
    }
    setRGB(r, g, b) {
      this.v = [r, g, b];
      return this;
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }
  class BufferGeometry {
    attributes = {};
    setAttribute(name, a) {
      this.attributes[name] = a;
    }
    setIndex(i) {
      this.index = i;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class ShaderMaterial {
    constructor(o) {
      Object.assign(this, o);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector3();
      this.userData = {};
    }
  }
  const clone = (u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v.value }]));
  return {
    Vector2,
    Vector3,
    Vector4,
    Color,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Mesh,
    UniformsLib: { fog: { fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogColor: { value: new Color("#fff") } } },
    UniformsUtils: { clone },
  };
}

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

describe("snapOrigin", () => {
  it("snaps x and z to the step, at sea level, from an array or a vector", () => {
    expect(snapOrigin([13.9, 40, -3.2], 8)).toEqual([16, 0, 0]);
    expect(snapOrigin({ x: -12.1, y: 2, z: 4.01 }, 8)).toEqual([-16, 0, 8]);
  });

  it("doesn't move until the camera has gone half a step: the grid stays put under small motions", () => {
    const a = snapOrigin([104, 2, 104], 8);
    for (const d of [-3.9, -1, 0, 1, 3.9]) expect(snapOrigin([104 + d, 2, 104 - d], 8)).toEqual(a);
    expect(snapOrigin([104 + 4.1, 2, 104], 8)).not.toEqual(a);
  });
});

describe("oceanGrid", () => {
  /** every edge, and how many triangles share it */
  function edges(g) {
    const m = new Map();
    for (let i = 0; i < g.indices.length; i += 3) {
      const t = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
    return m;
  }

  it("has the expected counts: a centre square, rings stitched with three triangles where they meet a finer one", () => {
    const m = 8;
    const g = oceanGrid({ cell: 1, size: m, rings: 2, skirt: 0 });
    // centre (m+1)² vertices, 2m² triangles; each ring adds (m+1)² − (m/2+1)² vertices and 1.5m² + 2m triangles
    expect(g.vertexCount).toBe((m + 1) ** 2 + 2 * ((m + 1) ** 2 - (m / 2 + 1) ** 2));
    expect(g.triangleCount).toBe(2 * m * m + 2 * (1.5 * m * m + 2 * m));
    expect(g.inner).toBe(4);
    expect(g.outer).toBe(16);
    // the skirt: 4m more vertices, 8m more triangles
    const s = oceanGrid({ cell: 1, size: m, rings: 2, skirt: 1000 });
    expect(s.vertexCount).toBe(g.vertexCount + 4 * m);
    expect(s.triangleCount).toBe(g.triangleCount + 8 * m);
    const far = Math.max(...Array.from(s.positions).map(Math.abs));
    expect(far).toBe(1000);
  });

  it("is watertight: no cracks or T-junctions, only the outer square is an open edge", () => {
    for (const skirt of [0, 500]) {
      const g = oceanGrid({ cell: 0.5, size: 16, rings: 3, skirt });
      const e = edges(g);
      const open = [...e.entries()].filter(([, n]) => n === 1);
      expect([...e.values()].every((n) => n === 1 || n === 2)).toBe(true);
      // the outer square: 4·size edges, all at the rim
      expect(open.length).toBe(4 * 16);
      const rim = skirt || g.outer;
      for (const [key] of open) {
        for (const i of key.split(",").map(Number)) {
          const x = g.positions[i * 3], z = g.positions[i * 3 + 2];
          expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(rim, 6);
        }
      }
    }
  });

  it("faces up everywhere, with no degenerate triangles, at sea level", () => {
    const g = oceanGrid({ cell: 0.5, size: 16, rings: 3, skirt: 500 });
    const p = g.positions;
    for (let i = 0; i < g.indices.length; i += 3) {
      const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
      const ux = p[b * 3] - p[a * 3], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3], vz = p[c * 3 + 2] - p[a * 3 + 2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0); // (u × v).y
    }
    for (let i = 1; i < p.length; i += 3) expect(p[i]).toBe(0);
  });

  it("reaches several kilometres with the defaults, in a modest number of triangles", () => {
    const g = oceanGrid();
    expect(g.outer).toBeGreaterThan(8000);
    expect(g.triangleCount).toBeLessThan(100000);
  });
});

describe("waveUniforms", () => {
  const sea = createOcean({ wind: { speed: 11, from: 70 }, seed: 8 });

  it("packs each wave as (k·dx, k·dz, A, Q·A)", () => {
    const u = waveUniforms(sea.components, [0, 0, 0], 0);
    expect(u.waves.length).toBe(4 * sea.components.length);
    sea.components.forEach((c, i) => {
      expect(u.waves[i * 4]).toBeCloseTo(c.k * c.dir[0], 6);
      expect(u.waves[i * 4 + 1]).toBeCloseTo(c.k * c.dir[1], 6);
      expect(u.waves[i * 4 + 2]).toBeCloseTo(c.amp, 6);
      expect(u.waves[i * 4 + 3]).toBeCloseTo(c.steep * c.amp, 6);
    });
  });

  it("puts the phase at the grid's origin, so the shader's sum in float32 near its origin is the sea's, however far out", () => {
    const origin = [52_000, 0, -31_000];
    const t = 7_200.25;
    const u = waveUniforms(sea.components, origin, t);
    for (const ph of u.phases) {
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(TAU + 1e-6);
    }
    // the vertex shader's sum, in float32 as the GPU would, at a vertex 37 m from the origin
    const f = Math.fround;
    const p = [f(37.5), f(-12.25)];
    let x = 0, y = 0, z = 0;
    sea.components.forEach((_, i) => {
      const [kx, kz, A, QA] = [u.waves[i * 4], u.waves[i * 4 + 1], u.waves[i * 4 + 2], u.waves[i * 4 + 3]];
      const k = f(Math.hypot(kx, kz));
      const th = f(f(kx * p[0]) + f(kz * p[1]) + u.phases[i]);
      x -= f(QA * (kx / k) * Math.sin(th));
      z -= f(QA * (kz / k) * Math.sin(th));
      y += f(A * Math.cos(th));
    });
    const want = sea.displaced(origin[0] + 37.5, origin[2] - 12.25, t, [0, 0, 0, 0]);
    expect(y).toBeCloseTo(want[1], 3);
    expect(origin[0] + 37.5 + x).toBeCloseTo(want[0], 3);
    expect(origin[2] - 12.25 + z).toBeCloseTo(want[2], 3);
  });

  it("writes into the arrays it's given", () => {
    const out = { waves: new Float32Array(4 * sea.components.length), phases: new Float32Array(sea.components.length) };
    expect(waveUniforms(sea.components, [0, 0, 0], 1, out)).toBe(out);
    expect(out.phases[0]).toBeCloseTo(wrap(sea.components[0].phase - sea.components[0].omega), 5);
  });
});

describe("detail and roughness", () => {
  it("the detail waves are shorter than the sea's, and with the sea's own and the roughness make up Cox and Munk's slope", () => {
    for (const speed of [0, 5, 12]) {
      const sea = createOcean({ wind: { speed, from: 0 }, seed: 1 });
      const { waves, rough } = detailWaves(sea, 24);
      expect(waves.length).toBe(24);
      const kMax = Math.max(0, ...sea.components.map((c) => c.k));
      for (const w of waves) {
        expect(w.k).toBeGreaterThan(kMax);
        expect(w.omega ** 2).toBeCloseTo(9.81 * w.k, 6);
      }
      const drawn = sea.components.reduce((s, c) => s + (c.k * c.amp) ** 2 / 2, 0);
      const detail = waves.reduce((s, w) => s + (w.slope * w.slope) / 2, 0);
      expect(drawn + detail + rough).toBeCloseTo(surfaceSlopeVariance(speed), 9);
      expect(rough).toBeGreaterThanOrEqual(0);
    }
    expect(surfaceSlopeVariance(12)).toBeGreaterThan(surfaceSlopeVariance(5));
  });
});

describe("foamThreshold", () => {
  it("is the Jacobian below which the sea's whitecap share of the surface lies", () => {
    const sea = createOcean({ wind: { speed: 12, from: 0 }, seed: 3 });
    const at = foamThreshold(sea);
    expect(at).toBeLessThan(1);
    expect(at).toBeGreaterThan(0);
    // fresh samples: about that share is below it
    let below = 0;
    const n = 20000;
    const out = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) if (sea.displaced(i * 7.31 + 3, i * 3.17 - 9, i * 0.913, out)[3] < at) below++;
    expect(below / n).toBeGreaterThan(sea.stats.whitecaps * 0.5);
    expect(below / n).toBeLessThan(sea.stats.whitecaps * 2);
  });

  it("is −Infinity (no foam) for a sea without whitecaps", () => {
    expect(foamThreshold(createOcean({ wind: { speed: 5, from: 0 }, seed: 1 }))).toBe(-Infinity);
    expect(foamThreshold(createOcean({ wind: { speed: 0, from: 0 }, seed: 1 }))).toBe(-Infinity);
  });
});

describe("createOceanSurface", () => {
  const THREE = fakeThree();
  const sea = createOcean({ wind: { speed: 12, from: 270 }, seed: 7 });

  it("is a mesh nothing picks, never culled, with fog on and the sea's waves as uniforms", () => {
    const s = createOceanSurface(THREE, sea);
    const mesh = s.object;
    expect(mesh.userData.noPick).toBe(true);
    expect(mesh.raycast()).toBeUndefined();
    expect(mesh.frustumCulled).toBe(false);
    const m = mesh.material;
    expect(m.fog).toBe(true);
    expect(m.defines.WAVES).toBe(sea.components.length);
    expect(m.uniforms.uWaves.value.length).toBe(sea.components.length);
    expect(m.uniforms.uPhase.value.length).toBe(sea.components.length);
    expect(m.uniforms.fogColor).toBeDefined();
    expect(m.uniforms.uFoamAt.value).toBeCloseTo(foamThreshold(sea), 9);
    // three's fog and output colour space, so the stage's atmosphere and renderer apply
    for (const chunk of ["<fog_pars_vertex>", "<fog_vertex>"]) expect(m.vertexShader).toContain(chunk);
    for (const chunk of ["<fog_pars_fragment>", "<fog_fragment>", "<colorspace_fragment>"]) expect(m.fragmentShader).toContain(chunk);
    expect(mesh.geometry.index.array.length / 3).toBe(oceanGrid().triangleCount);
  });

  it("update follows the camera in snapped steps and brings the phases to t", () => {
    const s = createOceanSurface(THREE, sea, { cell: 0.5, snapLevel: 4 });
    s.update(30, [101, 2, -45]);
    expect([s.object.position.x, s.object.position.z]).toEqual([104, -48]);
    const want = waveUniforms(sea.components, [104, 0, -48], 30);
    s.object.material.uniforms.uPhase.value.forEach((ph, i) => expect(ph).toBeCloseTo(want.phases[i], 5));
    const phases = [...s.object.material.uniforms.uPhase.value];
    s.update(30, { x: 102, y: 2, z: -46 });
    expect([s.object.position.x, s.object.position.z]).toEqual([104, -48]);
    expect(s.object.material.uniforms.uPhase.value).toEqual(phases);
  });

  it("takes the atmosphere's sun and sky; null puts the sun out", () => {
    const s = createOceanSurface(THREE, sea);
    const u = s.object.material.uniforms;
    s.update(0, [0, 0, 0], { direction: [0, 2, 0], color: "#ffeecc", intensity: 2 }, { top: "#336699", horizon: "#ccddee" });
    expect([u.uSunDir.value.x, u.uSunDir.value.y, u.uSunDir.value.z]).toEqual([0, 1, 0]);
    expect(u.uSunColor.value.v).toBe("#ffeecc");
    expect(u.uSunIntensity.value).toBe(2);
    expect(u.uSkyTop.value.v).toBe("#336699");
    expect(u.uSkyHorizon.value.v).toBe("#ccddee");
    s.update(0, [0, 0, 0], null);
    expect(u.uSunOn.value).toBe(0);
    s.update(0, [0, 0, 0]);
    expect(u.uSunOn.value).toBe(0);
  });

  it("setSea recompiles only when the number of waves changes; a calm still has one (still) wave", () => {
    const s = createOceanSurface(THREE, sea);
    const m = s.object.material;
    m.needsUpdate = false;
    s.setSea(createOcean({ wind: { speed: 7, from: 0 }, seed: 2 }));
    expect(m.needsUpdate).toBe(false);
    s.setSea(createOcean({ wind: { speed: 0, from: 0 }, seed: 2 }));
    expect(m.needsUpdate).toBe(true);
    expect(m.defines.WAVES).toBe(1);
    expect(m.uniforms.uWaves.value[0]).toMatchObject({ x: 0, y: 0, z: 0, w: 0 });
    s.update(5, [0, 0, 0]);
  });

  it("dispose frees the geometry and the material", () => {
    const s = createOceanSurface(THREE, sea);
    s.dispose();
    expect(s.object.geometry.disposed).toBe(true);
    expect(s.object.material.disposed).toBe(true);
  });
});
