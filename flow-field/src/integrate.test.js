import { describe, it, expect } from "vitest";
import { compileField, emission } from "./field.js";
import { traceStreamline, rakeSeeds, isInsideBody, passedStagnation } from "./integrate.js";
import { RANKINE_SEED } from "./datatype.js";
import { presetFlow } from "./presets.js";

const rankine = compileField(RANKINE_SEED);

/**
 * Stokes stream function for point sources/sinks on the x axis in a stream
 * along +x: ψ = ½ U ρ² − Σ (mᵢ / 4π) cos θᵢ. It is constant along a
 * streamline, 0 on the body surface, negative inside, positive outside.
 */
function stokesPsi(f, [x, y, z]) {
  const rho2 = y * y + z * z;
  let psi = 0.5 * f.U * rho2;
  for (const e of f.elements) {
    const X = x - e.x;
    psi -= (emission(e) / (4 * Math.PI)) * (X / Math.sqrt(X * X + rho2));
  }
  return psi;
}

/** Half-breadth of the Rankine body at x = 5, where ψ = 0 (by bisection). */
function halfBreadth(f, x = 5) {
  let lo = 0.01;
  let hi = 5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (stokesPsi(f, [x, mid, 0]) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("traceStreamline", () => {
  it("follows a uniform stream in a straight line and stops on the boundary", () => {
    const f = compileField({
      freestream: { speed: 3, headingDeg: 0 },
      elements: {},
      domain: { min: [0, -1, -1], max: [10, 1, 1] },
    });
    const tr = traceStreamline(f, [0.05, 0.3, -0.2], { step: 0.25 });
    expect(tr.end).toBe("domain");
    const last = tr.points.at(-1);
    expect(last[0]).toBeCloseTo(10, 9);
    for (const p of tr.points) {
      expect(p[1]).toBeCloseTo(0.3, 12);
      expect(p[2]).toBeCloseTo(-0.2, 12);
    }
    expect(tr.speeds.every((s) => Math.abs(s - 3) < 1e-12)).toBe(true);
    expect(tr.cps.every((c) => Math.abs(c) < 1e-12)).toBe(true);
  });

  it("steps are the requested arc length", () => {
    const tr = traceStreamline(rankine, [-5.9, 0.8, -0.3], { step: 0.1, maxSteps: 50 });
    for (let i = 1; i < tr.points.length; i++) {
      const [a, b] = [tr.points[i - 1], tr.points[i]];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(0.1, 3);
    }
  });

  it("runs backwards with direction −1", () => {
    const f = compileField({ freestream: { speed: 1, headingDeg: 90 }, elements: {} });
    const tr = traceStreamline(f, [0, 0, 0], { step: 0.5, maxSteps: 4, direction: -1 });
    expect(tr.points.at(-1)[1]).toBeCloseTo(-2, 9);
  });

  it("starting outside the domain returns nothing", () => {
    expect(traceStreamline(rankine, [100, 0, 0]).end).toBe("outside");
  });

  it("stops at the stagnation point on the dividing streamline", () => {
    const tr = traceStreamline(rankine, [-5.9, 0, 0], { step: 0.05, maxSteps: 2000 });
    expect(tr.end).toBe("stagnation");
    const nose = tr.points.at(-1);
    expect(nose[0]).toBeGreaterThan(-0.3);
    expect(nose[0]).toBeLessThan(0.3);
    expect(tr.cps.at(-1)).toBeGreaterThan(0.99);
  });

  it("ends at a sink when it starts in the body", () => {
    const tr = traceStreamline(rankine, [3, 0.4, 0], { step: 0.05, maxSteps: 2000 });
    expect(tr.end).toBe("singularity");
    expect(rankine.elements[tr.endElement].kind).toBe("sink");
  });
});

describe("streamlines around the Rankine body", () => {
  const b = halfBreadth(rankine);

  it("the body is about 2.8 m across at mid-length", () => {
    // Uπb² = m a / √(a² + b²) with a = 4.3
    expect(b).toBeGreaterThan(1.3);
    expect(b).toBeLessThan(1.45);
    const U = rankine.U;
    const m = rankine.elements[0].s;
    expect(U * Math.PI * b * b).toBeCloseTo((m * 4.3) / Math.sqrt(4.3 * 4.3 + b * b), 6);
  });

  for (const [y0, z0] of [
    [0.3, 0],
    [0.6, -0.4],
    [0, -0.5],
    [1.5, -1.2],
  ]) {
    it(`a streamline seeded at y=${y0}, z=${z0} keeps its stream function and stays off the body`, () => {
      const tr = traceStreamline(rankine, [-5.99, y0, z0], { step: 0.1, maxSteps: 1000 });
      expect(tr.end).toBe("domain");
      const psi0 = stokesPsi(rankine, tr.points[0]);
      expect(psi0).toBeGreaterThan(0);
      for (const p of tr.points) {
        const psi = stokesPsi(rankine, p);
        expect(Math.abs(psi - psi0)).toBeLessThan(0.02 * psi0 + 1e-3);
        expect(psi).toBeGreaterThan(0);
      }
      // passing mid-body, it is outside the body's half-breadth
      const mid = tr.points.reduce((a, p) => (Math.abs(p[0] - 5) < Math.abs(a[0] - 5) ? p : a));
      expect(Math.hypot(mid[1], mid[2])).toBeGreaterThan(b);
    });
  }
});

describe("isInsideBody", () => {
  it("tells body fluid from stream fluid", () => {
    expect(isInsideBody(rankine, [5, 0, 0])).toBe(true);
    expect(isInsideBody(rankine, [5, 1.2, 0])).toBe(true);
    expect(isInsideBody(rankine, [5, 0, -1.2])).toBe(true);
    expect(isInsideBody(rankine, [9.2, 0.1, 0])).toBe(true); // right by the sink
    expect(isInsideBody(rankine, [9.6, 0.05, 0], { step: 0.3 })).toBe(true); // behind it
    expect(isInsideBody(rankine, [9.6, 0, 0], { step: 0.3 })).toBe(true); // behind it, on the axis
    expect(isInsideBody(rankine, [-0.4, 0, 0], { step: 0.3 })).toBe(false); // ahead of the nose, on the axis
    expect(isInsideBody(rankine, [5, 1.6, 0])).toBe(false);
    expect(isInsideBody(rankine, [5, 0, -1.6])).toBe(false);
    expect(isInsideBody(rankine, [-2, 0, 0])).toBe(false);
    expect(isInsideBody(rankine, [12, 0, 0])).toBe(false);
  });

  it("the wake behind a bow-heavy body is not body, right up to its axis", () => {
    // A hull-shaped body (two sources forward, one strong sink aft, stream
    // towards −x). Just off the wake axis the upstream trace rides the dividing
    // streamline round the body and cuts into the bow source at the far end;
    // that used to mask a stripe down the whole wake.
    const zW = 0.666;
    const hull = compileField({
      freestream: { speed: 2.5, headingDeg: 180 },
      domain: { min: [-2.5, -2.6, -1.8], max: [8, 2.6, 0.7] },
      elements: {
        bow: { kind: "source", position: [4.38, 0, zW], strength: 1.78 },
        fwd: { kind: "source", position: [3.09, 0, zW], strength: 6.3 },
        stern: { kind: "sink", position: [0.6, 0, zW], strength: 8.08 },
      },
    });
    for (const x of [-2, -1, -0.5]) for (const y of [0.001, 0.02, 0.05]) expect(isInsideBody(hull, [x, y, 0.62]), `${x},${y}`).toBe(false);
    for (const p of [[0.3, 0.3, 0.62], [1.5, 0.3, 0.62], [2.5, 0.7, 0.62], [3.5, 0.5, 0.62], [4, 0.2, 0.62], [0.4, 0.02, 0.62]])
      expect(isInsideBody(hull, p), String(p)).toBe(true);
    expect(isInsideBody(hull, [2, 1.1, 0.62])).toBe(false);
  });

  it("passedStagnation needs fast, slow, then fast again", () => {
    expect(passedStagnation([1, 0.9, 0.3, 0.9, 1.2], 1)).toBe(true);
    expect(passedStagnation([0.1, 0.3, 0.8, 2, 9], 1)).toBe(false); // starts by a stagnation point
    expect(passedStagnation([1, 0.8, 0.4, 0.2], 1)).toBe(false); // ends at one
    expect(passedStagnation([1, 0.3, 1], 0)).toBe(false); // no stream, no reference
  });

  it("the inside of a doublet's sphere is body", () => {
    const f = compileField({
      freestream: { speed: 1, headingDeg: 0 },
      elements: { d: { kind: "doublet", position: [0, 0, 0], strength: 2 * Math.PI } },
    });
    expect(isInsideBody(f, [0, 0.5, 0], { step: 0.05 })).toBe(true);
    expect(isInsideBody(f, [0, 1.3, 0], { step: 0.05 })).toBe(false);
  });

  it("a vortex line through a body doesn't punch holes in it", () => {
    const sphere = compileField({ ...RANKINE_SEED, ...presetFlow("spinning") });
    for (const p of [[5.2, 0.1, -0.4], [5.4, 0, -0.4], [4.6, 0.3, -0.4], [5.1, 0, -1], [5.05, 0.02, 0]])
      expect(isInsideBody(sphere, p)).toBe(true);
    expect(isInsideBody(sphere, [5, 1.6, -0.4])).toBe(false);
    // the doublet wins over the vortex when both are in capture range, whatever the id order
    const swapped = compileField({
      freestream: { speed: 2, headingDeg: 0 },
      elements: {
        a: { kind: "vortex-line", position: [5, 0, 0], strength: -14 },
        z: { kind: "doublet", position: [5, 0, 0], strength: 2 * Math.PI * 2 * 1.4 ** 3 },
      },
    });
    expect(isInsideBody(swapped, [5.1, 0, 0])).toBe(true);
  });

  it("a point right beside a source is inside its body, however coarse the step", () => {
    // Tracing upstream from 1 cm off a source with a 5 cm step used to jump
    // over the source, flip the tangent and stop as a "stagnation point",
    // which punched a hole in the slice mask at every element.
    const f = compileField({
      freestream: { speed: 2.5, headingDeg: 180 },
      domain: { min: [-2.5, -2.6, -1.8], max: [8, 2.6, 0.7] },
      elements: {
        a: { kind: "source", position: [3.612, 0, 0.666], strength: 5.9 },
        b: { kind: "source", position: [0.96, 0, 0.666], strength: 5.18 },
        c: { kind: "sink", position: [0.186, 0, 0.666], strength: 11.08 },
      },
    });
    for (const [x, y, z] of [[0.95, 0.001, 0.666], [3.6, 0.001, 0.666], [0.96, 0, 0.666], [0.95, 0.001, 0.62]]) {
      expect(isInsideBody(f, [x, y, z], { step: 0.05, maxSteps: 900 })).toBe(true);
    }
    // and a trace that starts there heading into the source ends on it at once
    const back = traceStreamline(f, [0.95, 0.001, 0.666], { step: 0.05, direction: -1 });
    expect(back.end).toBe("singularity");
    expect(f.elements[back.endElement].x).toBeCloseTo(0.96);
    // but one heading OUT of it still leaves
    const fwd = traceStreamline(f, [0.95, 0.001, 0.666], { step: 0.05 });
    expect(fwd.points.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(fwd.points[1][0] - 0.96)).toBeGreaterThan(Math.abs(fwd.points[0][0] - 0.96));
  });

  it("a vortex line out in the stream is not a body", () => {
    const f = compileField({
      freestream: { speed: 2, headingDeg: 0 },
      elements: {
        v: { kind: "vortex-line", position: [5, 0, 0], strength: 8 },
        s: { kind: "source", position: [-3, 4, 0], strength: 0.5 },
      },
    });
    for (const p of [[5.1, 0, 0], [5.3, 0.2, -1], [4.8, -0.1, 0.5]]) expect(isInsideBody(f, p)).toBe(false);
  });
});

describe("rakeSeeds", () => {
  it("spreads count × rows seeds across the upstream face", () => {
    const seeds = rakeSeeds(rankine, { count: 12, rows: 3, height: 0, rowSpacing: 0.6 });
    expect(seeds).toHaveLength(36);
    for (const s of seeds) expect(s[0]).toBeCloseTo(-6, 4);
    expect(new Set(seeds.map((s) => s[2].toFixed(3)))).toEqual(new Set(["0.000", "-0.600", "-1.200"]));
    const ys = seeds.filter((s) => s[2] === 0).map((s) => s[1]);
    expect(Math.min(...ys)).toBeCloseTo(-5.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(5.5, 6);
  });

  it("puts every seed inside the domain, upstream, for any heading", () => {
    for (const h of [0, 37, 90, 145, 180, 270, 321]) {
      const f = compileField({ ...RANKINE_SEED, freestream: { speed: 2, headingDeg: h } });
      const seeds = rakeSeeds(f, { count: 20 });
      expect(seeds.length).toBeGreaterThan(10);
      const { min, max } = f.domain;
      for (const s of seeds) {
        for (let k = 0; k < 3; k++) {
          expect(s[k]).toBeGreaterThanOrEqual(min[k]);
          expect(s[k]).toBeLessThanOrEqual(max[k]);
        }
        // a step against the stream leaves the box: the seed is on the upstream face
        const back = [s[0] - 0.01 * f.dx, s[1] - 0.01 * f.dy];
        const out = back[0] < min[0] || back[0] > max[0] || back[1] < min[1] || back[1] > max[1];
        expect(out).toBe(true);
      }
    }
  });

  it("skips rows outside the domain", () => {
    expect(rakeSeeds(rankine, { count: 5, rows: 3, height: 3.5, rowSpacing: -1 })).toHaveLength(5);
  });
});
