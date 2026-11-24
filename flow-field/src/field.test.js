import { describe, it, expect } from "vitest";
import {
  compileField,
  velocityAt,
  speedAt,
  cpAt,
  potentialAt,
  headingVector,
  netFlux,
} from "./field.js";
import { RANKINE_SEED } from "./datatype.js";

const doc = (elements = {}, freestream = { speed: 2, headingDeg: 0 }) => ({ freestream, elements });
const V = (f, p) => velocityAt(f, p[0], p[1], p[2], [0, 0, 0]);

function divergence(f, p, h = 1e-4) {
  let div = 0;
  for (let k = 0; k < 3; k++) {
    const a = [...p];
    const b = [...p];
    a[k] += h;
    b[k] -= h;
    div += (V(f, a)[k] - V(f, b)[k]) / (2 * h);
  }
  return div;
}

function curl(f, p, h = 1e-4) {
  const d = (i, k) => {
    const a = [...p];
    const b = [...p];
    a[k] += h;
    b[k] -= h;
    return (V(f, a)[i] - V(f, b)[i]) / (2 * h);
  };
  return [d(2, 1) - d(1, 2), d(0, 2) - d(2, 0), d(1, 0) - d(0, 1)];
}

describe("uniform stream", () => {
  it("is U along the heading everywhere", () => {
    const f = compileField(doc({}, { speed: 3, headingDeg: 0 }));
    expect(V(f, [1, 2, 3])).toEqual([3, 0, 0]);
    const g = compileField(doc({}, { speed: 3, headingDeg: 90 }));
    const v = V(g, [-4, 7, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(3, 12);
    expect(v[2]).toBe(0);
  });

  it("heading is counter-clockwise from +x (east), toward which the stream flows", () => {
    const [x, y] = headingVector(45);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(Math.SQRT1_2);
  });

  it("has Cp = 0 everywhere", () => {
    const f = compileField(doc({}, { speed: 5, headingDeg: 12 }));
    expect(cpAt(f, 3, -2, 1)).toBeCloseTo(0, 12);
  });
});

describe("source and sink", () => {
  const m = 10;
  const src = compileField(doc({ s: { kind: "source", position: [1, 2, 3], strength: m } }, { speed: 0 }));
  const snk = compileField(doc({ s: { kind: "sink", position: [1, 2, 3], strength: m } }, { speed: 0 }));
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)],
  ];

  it("a source is radially symmetric with |V| = m / 4πr²", () => {
    const r = 1.7;
    for (const d of dirs) {
      const v = V(src, [1 + r * d[0], 2 + r * d[1], 3 + r * d[2]]);
      const s = Math.hypot(...v);
      expect(s).toBeCloseTo(m / (4 * Math.PI * r * r), 10);
      // points straight out
      for (let k = 0; k < 3; k++) expect(v[k] / s).toBeCloseTo(d[k], 10);
    }
  });

  it("a sink is the same field pointing in", () => {
    const p = [2.5, 1, 3.2];
    const a = V(src, p);
    const b = V(snk, p);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(-a[k], 12);
  });

  it("the flux through a sphere around a source is its strength", () => {
    // Monte-Carlo-free: integrate over a fine lat/long grid
    const r = 2;
    let flux = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const th = ((i + 0.5) / n) * Math.PI;
      for (let j = 0; j < 2 * n; j++) {
        const ph = ((j + 0.5) / (2 * n)) * 2 * Math.PI;
        const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        const v = V(src, [1 + r * d[0], 2 + r * d[1], 3 + r * d[2]]);
        const dA = r * r * Math.sin(th) * (Math.PI / n) * (Math.PI / n);
        flux += (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) * dA;
      }
    }
    expect(flux).toBeCloseTo(m, 2);
  });

  it("does not blow up exactly on the singularity", () => {
    expect(V(src, [1, 2, 3]).every(Number.isFinite)).toBe(true);
  });
});

describe("a mixed field", () => {
  const f = compileField(
    doc(
      {
        a: { kind: "source", position: [0, 0, 0], strength: 12 },
        b: { kind: "sink", position: [4, 1, -0.5], strength: 7 },
        c: { kind: "doublet", position: [-2, 3, 1], strength: 20 },
        d: { kind: "vortex-line", position: [2, -3, 0], strength: 9 },
      },
      { speed: 1.5, headingDeg: 30 },
    ),
  );
  const probes = [
    [1.3, 0.7, 0.2], [-3, -1, 2], [6, 4, -2], [2.2, 1.1, 0.9], [-1, 2, -1], [3, -1.4, 1.5],
  ];

  it("is divergence-free away from singularities", () => {
    for (const p of probes) expect(Math.abs(divergence(f, p))).toBeLessThan(1e-5);
  });

  it("is irrotational away from singularities", () => {
    for (const p of probes) for (const c of curl(f, p)) expect(Math.abs(c)).toBeLessThan(1e-5);
  });

  it("the point elements are the gradient of the potential", () => {
    // vortex lines are multivalued, so leave that one out
    const g = { ...f, elements: f.elements.filter((e) => e.kind !== "vortex-line") };
    const h = 1e-5;
    for (const p of probes) {
      const v = V(g, p);
      for (let k = 0; k < 3; k++) {
        const a = [...p];
        const b = [...p];
        a[k] += h;
        b[k] -= h;
        expect((potentialAt(g, ...a) - potentialAt(g, ...b)) / (2 * h)).toBeCloseTo(v[k], 5);
      }
    }
  });

  it("net flux counts sources minus sinks", () => {
    expect(netFlux(f)).toBe(5);
  });
});

describe("doublet", () => {
  it("in a stream it makes a sphere of radius (S / 2πU)^⅓", () => {
    const U = 2;
    const R = 1.5;
    const S = 2 * Math.PI * U * R ** 3;
    const f = compileField(doc({ d: { kind: "doublet", position: [0, 0, 0], strength: S } }, { speed: U, headingDeg: 60 }));
    for (let i = 0; i < 20; i++) {
      const th = Math.acos(1 - (2 * (i + 0.5)) / 20);
      const ph = i * 2.39996;
      const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      const v = V(f, n.map((c) => c * R));
      expect(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]).toBeCloseTo(0, 10);
    }
    // front stagnation point, and 1.5 U at the equator (classic sphere result)
    const d = headingVector(60);
    expect(speedAt(f, -R * d[0], -R * d[1], 0)).toBeCloseTo(0, 10);
    expect(speedAt(f, 0, 0, R)).toBeCloseTo(1.5 * U, 10);
    expect(cpAt(f, 0, 0, R)).toBeCloseTo(1 - 2.25, 10);
  });
});

describe("vortex line", () => {
  it("has circulation Γ around it and no vertical velocity", () => {
    const G = 6;
    const f = compileField(doc({ v: { kind: "vortex-line", position: [1, 1, 0], strength: G } }, { speed: 0 }));
    let circ = 0;
    const n = 400;
    const r = 0.8;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const v = V(f, [1 + r * Math.cos(a), 1 + r * Math.sin(a), 5]);
      expect(v[2]).toBe(0);
      circ += (-Math.sin(a) * v[0] + Math.cos(a) * v[1]) * r * ((2 * Math.PI) / n);
    }
    expect(circ).toBeCloseTo(G, 8);
  });
});

describe("compileField", () => {
  it("drops unknown kinds and non-finite strengths without throwing", () => {
    const f = compileField({
      freestream: { speed: "fast" },
      elements: {
        a: { kind: "tornado", position: [0, 0, 0], strength: 1 },
        b: { kind: "source", position: [0, 0, 0], strength: NaN },
        c: { kind: "source", position: [1, "x"], strength: 2 },
        d: null,
      },
    });
    expect(f.U).toBe(0);
    expect(f.elements).toHaveLength(1);
    expect(f.elements[0]).toMatchObject({ id: "c", x: 1, y: 0, z: 0 });
  });

  it("copes with an empty doc", () => {
    const f = compileField({});
    expect(V(f, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(f.domain.max[0]).toBeGreaterThan(f.domain.min[0]);
  });
});

describe("the Rankine seed", () => {
  const f = compileField(RANKINE_SEED);
  it("has stagnation points about 10 m apart around x ≈ 0 and x ≈ 10", () => {
    // on the axis, upstream of the source: u = U − m/4π (1/(a−x)² − 1/(b−x)²)
    const u = (x) => V(f, [x, 0, 0])[0];
    const root = (lo, hi) => {
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(u(mid)) === Math.sign(u(lo))) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const nose = root(-3, 0.9);
    const tail = root(9.4, 13);
    expect(nose).toBeGreaterThan(-0.3);
    expect(nose).toBeLessThan(0.3);
    expect(tail - nose).toBeGreaterThan(9.5);
    expect(tail - nose).toBeLessThan(10.5);
    expect(cpAt(f, nose, 0, 0)).toBeCloseTo(1, 6);
  });
});
