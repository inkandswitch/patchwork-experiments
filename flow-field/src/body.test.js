import { describe, it, expect } from "vitest";
import {
  normalizeBodySpec,
  normalizeLoops,
  signedArea,
  pointInLoops,
  resampleLoop,
  makePanels,
  solvePanels,
  surfaceVelocities,
  compileBody,
  slenderProfile,
  snapshotElements,
  BODY_SPEED_CAP,
  outerLoops,
  allocate,
  MAX_PANELS,
} from "./body.js";
import { compileField, velocityAt } from "./field.js";
import { compileFlow } from "./flow.js";
import { traceStreamline, isInsideBody } from "./integrate.js";

const circle = (n, R = 1, cx = 0, cy = 0) =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [cx + R * Math.cos(t), cy + R * Math.sin(t)];
  });
const ellipse = (n, a, b) =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [a * Math.cos(t), b * Math.sin(t)];
  });
/**
 * A 10 m hull waterline, counter-clockwise: a transom 1.6 m wide at x = 0 and
 * a fine stem at x = 10 (half-angle about 9 degrees).
 */
const halfBreadth = (x) => 0.8 * (1 - (x / 10) ** 2) + 0.5 * Math.sin((Math.PI * x) / 10) * (1 - x / 10);
const transomHull = (n = 60) => {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([(10 * i) / n, -halfBreadth((10 * i) / n)]); // starboard, stern to bow
  pts.push([10, 0]);
  for (let i = n - 1; i >= 0; i--) pts.push([(10 * i) / n, halfBreadth((10 * i) / n)]); // port, bow to stern
  return pts;
};

const stream = (U, headingDeg = 0) => compileField({ freestream: { speed: U, headingDeg }, elements: {} });
const extOf = (base) => (x, y) => {
  const V = velocityAt(base, x, y, 0, [0, 0, 0]);
  return [V[0], V[1]];
};

describe("doc.body", () => {
  it("normalises the link, and anything unusable is no link", () => {
    expect(normalizeBodySpec(null)).toBeNull();
    expect(normalizeBodySpec({})).toBeNull();
    expect(normalizeBodySpec({ url: "automerge:abc" })).toEqual({
      url: "automerge:abc",
      plane: { kind: "waterline" },
      model: "waterplane-2d",
      panels: 120,
    });
    expect(normalizeBodySpec({ url: "automerge:abc", plane: { kind: "z", z: -0.4 }, model: "slender-body-3d", panels: 9999 })).toEqual({
      url: "automerge:abc",
      plane: { kind: "z", z: -0.4 },
      model: "slender-body-3d",
      panels: 400,
    });
  });
});

describe("loops", () => {
  it("orients counter-clockwise, drops repeats and degenerate loops, and tests points even–odd", () => {
    const cw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const [sq] = normalizeLoops([{ points: cw, closed: true }, { points: [[0, 0], [1, 1], [2, 2]], closed: true }]);
    expect(sq).toHaveLength(4);
    expect(signedArea(sq)).toBeCloseTo(1);
    expect(pointInLoops([sq], 0.5, 0.5)).toBe(true);
    expect(pointInLoops([sq], 1.5, 0.5)).toBe(false);
    const hole = normalizeLoops([circle(40, 0.2, 0.5, 0.5)])[0];
    expect(pointInLoops([sq, hole], 0.5, 0.5)).toBe(false);
    expect(pointInLoops([sq, hole], 0.1, 0.1)).toBe(true);
  });

  it("resamples to about n points, keeping corners and the stern exactly, bunched at the ends", () => {
    const [hull] = normalizeLoops([transomHull()]);
    const r = resampleLoop(hull, 120);
    expect(r.length).toBeGreaterThan(110);
    expect(r.length).toBeLessThan(130);
    const has = (x, y) => r.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-12);
    expect(has(0, 0.8)).toBe(true); // transom corners kept
    expect(has(0, -0.8)).toBe(true);
    expect(has(10, 0)).toBe(true); // the stem
    // cosine spacing: the panels next to the stem are much shorter than amidships
    const lens = r.map((p, i) => Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1]));
    const bowIdx = r.findIndex((p) => Math.hypot(p[0] - 10, p[1]) < 1e-12);
    expect(lens[bowIdx]).toBeLessThan(0.25 * Math.max(...lens));
  });
});

describe("Hess–Smith source panels", () => {
  for (const spacing of ["uniform", "cosine"]) {
    it(`reproduce potential flow past a cylinder (${spacing} spacing): u_t = 2U sin θ, Cp = 1 − 4 sin²θ`, () => {
      const U = 2;
      const base = stream(U);
      const pts = resampleLoop(circle(720), 120, { spacing });
      const P = makePanels([pts]);
      const ext = extOf(base);
      const sigma = solvePanels(P, ext);
      const { vt, vn } = surfaceVelocities(P, sigma, ext);
      let worstV = 0;
      let worstCp = 0;
      let net = 0;
      for (let i = 0; i < P.n; i++) {
        const th = Math.atan2(P.cy[i], P.cx[i]);
        const exact = 2 * U * Math.abs(Math.sin(th));
        worstV = Math.max(worstV, Math.abs(Math.abs(vt[i]) - exact));
        const cp = 1 - (vt[i] / U) ** 2;
        worstCp = Math.max(worstCp, Math.abs(cp - (1 - 4 * Math.sin(th) ** 2)));
        expect(Math.abs(vn[i])).toBeLessThan(1e-9); // impermeable at every control point
        net += sigma[i] * P.len[i];
      }
      expect(worstV / (2 * U)).toBeLessThan(0.02); // within 2% of the peak surface speed
      expect(worstCp).toBeLessThan(0.08); // Cp spans −3…1
      expect(Math.abs(net)).toBeLessThan(1e-9); // a closed body adds no net fluid
    });
  }

  it("matches the analytic field off the surface too, and is deterministic", () => {
    const U = 1.5;
    const doc = { freestream: { speed: U, headingDeg: 0 }, elements: {}, body: { url: "automerge:x" } };
    const section = { frame: "floating", units: "m", plane: { kind: "waterline", z: 0 }, loops: [{ points: circle(360), closed: true }] };
    const f = compileFlow(doc, section);
    for (const [x, y] of [[2, 0], [0, 1.5], [-1.2, 1.2], [3, -2]]) {
      const r2 = x * x + y * y;
      // cylinder: u = U (1 − (x² − y²)/r⁴), v = −2U xy / r⁴  (R = 1)
      const u = U * (1 - (x * x - y * y) / (r2 * r2));
      const v = (-2 * U * x * y) / (r2 * r2);
      const V = velocityAt(f, x, y, 0.7, [0, 0, 0]); // 2D: the same at any height
      expect(Math.hypot(V[0] - u, V[1] - v)).toBeLessThan(0.01 * U);
      expect(V[2]).toBe(0);
    }
    const g = compileBody(section, normalizeBodySpec(doc.body), compileField(doc));
    const h = compileBody(section, normalizeBodySpec(doc.body), compileField(doc));
    expect(Array.from(g.sigma)).toEqual(Array.from(h.sigma));
    expect(f.body.contains(0.5, 0.5, 0)).toBe(true);
    expect(f.body.contains(0.8, 0.8, 0)).toBe(false);
  });

  it("puts a transom's sharp corners in without a blow-up: every sample finite, the body's own speed capped", () => {
    const U = 2;
    const section = { plane: { kind: "waterline", z: 0 }, loops: [{ points: transomHull(), closed: true }] };
    const doc = { freestream: { speed: U, headingDeg: 180 }, elements: {}, body: { url: "automerge:x" } };
    const f = compileFlow(doc, section);
    // zero net source to discretisation error (exact only on smooth symmetric bodies)
    let gross = 0;
    for (let j = 0; j < f.body.panels.n; j++) gross += Math.abs(f.body.sigma[j]) * f.body.panels.len[j];
    expect(Math.abs(f.body.info.netSource)).toBeLessThan(0.01 * gross);
    const V = [0, 0, 0];
    // right on the corners, on the panels' ends, and on a grid through them
    const pts = [[0, 0.8], [0, -0.8], [10, 0], [0, 0], ...f.body.panelLoops[0]];
    for (let i = -20; i <= 120; i++) for (let j = -20; j <= 20; j++) pts.push([i * 0.1, j * 0.05]);
    let max = 0;
    for (const [x, y] of pts) {
      velocityAt(f, x, y, 0, V);
      expect(V.every(Number.isFinite)).toBe(true);
      max = Math.max(max, Math.hypot(V[0], V[1]));
    }
    expect(max).toBeLessThanOrEqual((BODY_SPEED_CAP + 1) * U + 1e-9);
    // the stream still goes round: a streamline just off the centreline stays out of the hull
    const tr = traceStreamline({ ...f, domain: { min: [-5, -4, -1], max: [15, 4, 1] } }, [14.9, 0.3, 0], { step: 0.05, maxSteps: 2000, planar: true });
    expect(tr.end).not.toBe("body");
    for (const p of tr.points) expect(f.body.contains(p[0], p[1], 0)).toBe(false);
    // masking is exact point-in-polygon
    expect(isInsideBody(f, [5, 0, 0])).toBe(true);
    expect(isInsideBody(f, [5, 1.2, 0])).toBe(false);
  });

  it("superposes the user's elements and still keeps the body impermeable", () => {
    const U = 2;
    const doc = {
      freestream: { speed: U, headingDeg: 0 },
      elements: { v: { kind: "vortex-line", position: [0, 3, 0], strength: 5 } },
      body: { url: "automerge:x" },
    };
    const section = { plane: { z: 0 }, loops: [{ points: circle(360), closed: true }] };
    const f = compileFlow(doc, section);
    const P = f.body.panels;
    const ext = extOf(compileField(doc));
    const { vn } = surfaceVelocities(P, f.body.sigma, ext);
    for (const x of vn) expect(Math.abs(x)).toBeLessThan(1e-9);
  });
});

describe("slender body", () => {
  const a = 5;
  const b = 0.5;
  const U = 2;
  const doc = { freestream: { speed: U, headingDeg: 180 }, elements: {}, body: { url: "automerge:x", model: "slender-body-3d", panels: 120 } };
  const section = { plane: { kind: "waterline", z: 0 }, loops: [{ points: ellipse(400, a, b), closed: true }] };

  it("turns an elliptical waterline into a closed spheroid: q = U dS/dx, no net flux, sane surface flow", () => {
    const f = compileFlow(doc, section);
    const body = f.body;
    expect(body.model).toBe("slender-body-3d");
    expect(Math.abs(body.info.netSource)).toBeLessThan(1e-9);
    // pointed ends: no closure
    expect(body.info.closures[0]).toEqual({ aft: null, fore: null });
    // forward half (x > 0, upstream since the stream heads toward −x) emits, aft half absorbs
    const seg = body.segments[0];
    for (let k = 0; k < seg.n; k++) {
      const xm = (seg.a[k] + seg.b[k]) / 2;
      if (xm > 0.3) expect(seg.q[k]).toBeGreaterThan(0);
      if (xm < -0.3) expect(seg.q[k]).toBeLessThan(0);
    }
    // on the spheroid's surface: nearly tangent, speed a little over U
    // (exact for b/a = 0.1: 1.021 U at the shoulder)
    const V = [0, 0, 0];
    let maxS = 0;
    for (const xr of [-0.7, -0.4, 0, 0.4, 0.7]) {
      const x = xr * a;
      const r = b * Math.sqrt(1 - xr * xr);
      const dr = (-b * xr) / (a * Math.sqrt(1 - xr * xr)); // dr/dx
      for (const phi of [0, Math.PI / 3, Math.PI / 2]) {
        const y = r * Math.cos(phi);
        const z = -r * Math.sin(phi);
        velocityAt(f, x, y, z, V);
        const ur = (V[1] * Math.cos(phi) - V[2] * Math.sin(phi));
        const un = (ur - dr * V[0]) / Math.hypot(1, dr);
        expect(Math.abs(un)).toBeLessThan(0.05 * U);
        maxS = Math.max(maxS, Math.hypot(...V));
      }
    }
    expect(maxS).toBeGreaterThan(U);
    expect(maxS).toBeLessThan(1.1 * U);
    // axisymmetric about the waterline axis, and masked as such
    expect(body.contains(0, 0, -0.45)).toBe(true);
    expect(body.contains(0, 0.34, -0.34)).toBe(true);
    expect(body.contains(0, 0.4, -0.4)).toBe(false);
    expect(body.contains(4.9, 0.2, 0)).toBe(false);
  });

  it("closes a transom with a dead-water region downstream, and still adds no net fluid", () => {
    const hull = { plane: { z: 0 }, loops: [{ points: transomHull(), closed: true }] };
    const f = compileFlow({ ...doc, body: { ...doc.body } }, hull);
    const [cl] = f.body.info.closures;
    expect(cl.fore).toBeNull();
    expect(cl.aft).toMatchObject({ deadWater: true });
    expect(cl.aft.length).toBeCloseTo(3 * 0.8, 1);
    expect(Math.abs(f.body.info.netSource)).toBeLessThan(1e-9);
    expect(f.body.contains(-1, 0, 0)).toBe(true); // in the dead water behind the transom
    expect(f.body.contains(-2.6, 0, 0)).toBe(false);
    // reversing the stream puts the transom upstream: only a short cap
    const back = slenderProfile(normalizeLoops(hull.loops)[0], 60, +1);
    expect(back.closures.aft.deadWater).toBe(false);
    expect(back.closures.aft.length).toBeCloseTo(0.4, 1);
  });

  it("is deterministic, and snapshots into point elements that carry the same flux", () => {
    const base = compileField(doc);
    const spec = normalizeBodySpec(doc.body);
    const b1 = compileBody(section, spec, base);
    const b2 = compileBody(section, spec, base);
    expect(Array.from(b1.segments[0].q)).toEqual(Array.from(b2.segments[0].q));
    const els = snapshotElements(b1, { max: 24 });
    const list = Object.values(els);
    expect(list.length).toBeGreaterThan(4);
    expect(list.length).toBeLessThanOrEqual(26);
    let emitted = 0;
    let absorbed = 0;
    for (const e of list) {
      expect(["source", "sink"]).toContain(e.kind);
      expect(e.strength).toBeGreaterThan(0);
      if (e.kind === "source") emitted += e.strength;
      else absorbed += e.strength;
    }
    expect(Math.abs(emitted - absorbed)).toBeLessThan(1e-2 * emitted);
    // far away, the elements and the line sources give the same flow
    const withEls = compileField({ ...doc, elements: els });
    const f = compileFlow(doc, section);
    const V1 = velocityAt(withEls, 2, 2, -1, [0, 0, 0]);
    const V2 = velocityAt(f, 2, 2, -1, [0, 0, 0]);
    expect(Math.hypot(V1[0] - V2[0], V1[1] - V2[1], V1[2] - V2[2])).toBeLessThan(0.02 * U);
  });
});

describe("compileFlow", () => {
  it("is exactly the old field for a doc with no body, or no section yet", () => {
    const doc = { freestream: { speed: 2, headingDeg: 0 }, elements: { s: { kind: "source", position: [0, 0, 0], strength: 3 } } };
    expect(compileFlow(doc)).toEqual(compileField(doc));
    expect(compileFlow({ ...doc, body: { url: "automerge:x" } }, null).body).toBeUndefined();
    expect(compileFlow({ ...doc, body: null }, { loops: [] }).body).toBeUndefined();
  });
});

const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const waterplane = (panels = 120, extra = {}) => ({ url: "automerge:h", model: "waterplane-2d", panels, ...extra });

describe("panel budget", () => {
  it("allocates shares that sum exactly, each at least the minimum", () => {
    expect(allocate([1, 1, 2], 12, 1)).toEqual([3, 3, 6]);
    const a = allocate([5, 0.1, 0.1, 3], 40, 6);
    expect(a.reduce((x, y) => x + y, 0)).toBe(40);
    expect(Math.min(...a)).toBe(6);
  });

  it("resamples to exactly n points, even for a loop with far more corners than n", () => {
    const [hull] = normalizeLoops([transomHull()]);
    expect(resampleLoop(hull, 120)).toHaveLength(120);
    // a 150-tooth gear: 600 corners
    const gear = [];
    for (let k = 0; k < 150; k++) {
      const t = (2 * Math.PI * k) / 150;
      const dt = (2 * Math.PI) / 600;
      for (const [r, o] of [[1, 0], [1.1, 0], [1.1, 2], [1, 2]]) gear.push([r * Math.cos(t + o * dt), r * Math.sin(t + o * dt)]);
    }
    const [g] = normalizeLoops([gear]);
    expect(resampleLoop(g, 120)).toHaveLength(120);
    const body = compileBody({ plane: { z: 0 }, loops: [gear] }, normalizeBodySpec(waterplane()), stream(1));
    expect(body.info.panels).toBe(120);
  });

  it("never solves more than the budget: many small loops share it, the smallest dropped with a note", () => {
    const loops = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) loops.push(box(i, j, i + 0.3 + 0.001 * i, j + 0.3));
    const t = performance.now();
    const body = compileBody({ plane: { z: 0 }, loops }, normalizeBodySpec(waterplane(MAX_PANELS)), stream(1));
    expect(performance.now() - t).toBeLessThan(3000);
    expect(body.info.panels).toBeLessThanOrEqual(MAX_PANELS);
    expect(body.info.warnings.join()).toMatch(/smallest loops dropped/);
    const slender = compileBody({ plane: { z: 0 }, loops }, normalizeBodySpec({ ...waterplane(120), model: "slender-body-3d" }), stream(1, 180));
    expect(slender.info.loops).toBeLessThanOrEqual(8);
  });
});

describe("awkward sections", () => {
  it("merges loops that share an edge instead of going singular, and matches the merged box", () => {
    const spec = normalizeBodySpec(waterplane(120));
    const base = stream(1);
    const two = compileBody({ plane: { z: 0 }, loops: [box(0, 0, 1, 1), box(1, 0, 2, 1)] }, spec, base);
    const one = compileBody({ plane: { z: 0 }, loops: [box(0, 0, 2, 1)] }, spec, base);
    expect(two.failed).toBeUndefined();
    expect(two.info.warnings.join()).toMatch(/touching loops merged/);
    let smax = 0;
    for (const s of two.sigma) smax = Math.max(smax, Math.abs(s));
    expect(smax).toBeLessThan(20);
    expect(two.contains(1, 0.5)).toBe(true); // the seam is inside the union
    const A = [0, 0, 0];
    const B = [0, 0, 0];
    for (const [x, y] of [[-0.3, 0.5], [1, 1.2], [2.4, 0.2], [1, -0.4]]) {
      A[0] = A[1] = A[2] = 0;
      B[0] = B[1] = B[2] = 0;
      two.add(x, y, 0, A);
      one.add(x, y, 0, B);
      expect(Math.hypot(A[0] - B[0], A[1] - B[1])).toBeLessThan(0.1);
    }
  });

  it("gives up on a section with no outline left (coincident loops), and the flow carries on without it", () => {
    const doc = { freestream: { speed: 1, headingDeg: 0 }, elements: {}, body: waterplane() };
    const f = compileFlow(doc, { plane: { z: 0 }, loops: [box(0, 0, 1, 1), box(0, 0, 1, 1).reverse()] });
    // the two are the same area: one is not a hole of the other, and every panel lies on the other
    expect(f.body.failed).toMatch(/no outline/);
    expect(velocityAt(f, 0.5, 2, 0, [0, 0, 0])).toEqual([1, 0, 0]);
  });

  it("drops holes: a shelled hull flows like the solid one, and its cockpit is masked", () => {
    const outer = ellipse(200, 2, 0.5);
    const inner = ellipse(200, 1.9, 0.45);
    expect(outerLoops(normalizeLoops([outer, inner])).holes).toBe(1);
    const base = stream(1, 180);
    for (const model of ["waterplane-2d", "slender-body-3d"]) {
      const spec = normalizeBodySpec({ url: "x", model });
      const shell = compileBody({ plane: { z: 0 }, loops: [outer, inner] }, spec, base);
      const solid = compileBody({ plane: { z: 0 }, loops: [outer] }, spec, base);
      expect(shell.info.warnings.join()).toMatch(/1 inner loop/);
      expect(shell.contains(0, 0, 0)).toBe(true);
      const A = [0, 0, 0];
      const B = [0, 0, 0];
      shell.add(0, 0.7, 0, A);
      solid.add(0, 0.7, 0, B);
      expect(A).toEqual(B);
    }
  });

  it("keeps a waterplane body impermeable at every height when the doc's point elements are superposed", () => {
    const doc = {
      freestream: { speed: 2, headingDeg: 180 },
      elements: { s: { kind: "source", position: [12, 0, 0], strength: 4 }, k: { kind: "sink", position: [-2, 0, 0], strength: 4 } },
      body: waterplane(120),
    };
    const f = compileFlow(doc, { plane: { z: 0 }, loops: [transomHull()] });
    expect(f.body.info.perHeight).toBe(true);
    const P = f.body.panels;
    const V = [0, 0, 0];
    for (const z of [0, -0.6, -1.2]) {
      let worst = 0;
      for (let i = 0; i < P.n; i++) {
        if (P.cx[i] < 1) continue;
        const x = P.cx[i] + 1e-4 * P.nx[i];
        const y = P.cy[i] + 1e-4 * P.ny[i];
        velocityAt(f, x, y, z, V);
        worst = Math.max(worst, Math.abs(V[0] * P.nx[i] + V[1] * P.ny[i]));
      }
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("masks a slender body at its dividing stream surface, a little inside the nominal breadth", () => {
    const base = stream(2, 180);
    const spec = normalizeBodySpec({ url: "x", model: "slender-body-3d" });
    const ratio = (a, b) => {
      const body = compileBody({ plane: { z: 0 }, loops: [ellipse(400, a, b)] }, spec, base);
      const p = body.profiles[0];
      const mid = p.xs.reduce((bi, x, i) => (Math.abs(x) < Math.abs(p.xs[bi]) ? i : bi), 0);
      return p.surface[mid] / p.rs[mid];
    };
    const slim = ratio(5, 0.5);
    const stubby = ratio(2, 0.8);
    expect(slim).toBeGreaterThan(0.97);
    expect(slim).toBeLessThan(1);
    expect(stubby).toBeLessThan(slim);
    expect(stubby).toBeGreaterThan(0.85);
    // hugging streamlines now pass the hull instead of stopping at its nominal outline
    const doc = { freestream: { speed: 2, headingDeg: 180 }, elements: {}, domain: { min: [-8, -4, -3], max: [14, 4, 3] }, body: { url: "x", model: "slender-body-3d" } };
    const f = compileFlow(doc, { plane: { z: 0 }, loops: [transomHull()] });
    let body = 0;
    const ends = [];
    for (let k = 1; k <= 12; k++) {
      const y = 0.03 * k;
      const tr = traceStreamline(f, [13.9, y, 0], { step: 0.1, maxSteps: 2000 });
      ends.push(tr.end);
      if (tr.end === "body") body++;
    }
    expect(body, ends.join()).toBe(0);
  });
});
