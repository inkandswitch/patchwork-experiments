import { describe, it, expect } from "vitest";
import { compileFlow } from "./flow.js";
import { bodyHugSeeds, traceThrough, traceStreamline, widenAcross } from "./integrate.js";
import { withBodyModel } from "./body.js";
import { computeStreamlines, buildStreamlines } from "./build-streamlines.js";
import { computeSlice } from "./build-slice.js";
import { sampleHeatmap, dilateInto } from "./view2d.js";
import { sliceGrid } from "./geometry.js";

// a 5 m waterline with a 1.6 m transom at x = 0 and a stem at x = 5, CCW
const hb = (x) => 0.8 * (1 - (x / 5) ** 2) + 0.3 * Math.sin((Math.PI * x) / 5) * (1 - x / 5);
const hull = (n = 40) => {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([(5 * i) / n, -hb((5 * i) / n)]);
  pts.push([5, 0]);
  for (let i = n - 1; i >= 0; i--) pts.push([(5 * i) / n, hb((5 * i) / n)]);
  return pts;
};
const section = { frame: "floating", units: "m", plane: { kind: "waterline", z: 0 }, loops: [{ points: hull(), closed: true }] };
const flowDoc = (model = "waterplane-2d") => ({
  freestream: { speed: 2, headingDeg: 180 },
  elements: {},
  domain: { min: [-2.5, -3, -1], max: [7.5, 3, 0.5] },
  seeds: { count: 15 },
  body: { url: "automerge:hull", plane: { kind: "waterline" }, model, panels: 120 },
});
const maxHalf = Math.max(...hull().map((p) => Math.abs(p[1])));
/** distance from a point to the waterline polygon's edges */
const distToHull = (x, y) => {
  const P = hull();
  let best = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [ax, ay] = P[i];
    const [bx, by] = P[(i + 1) % P.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
};

describe("streamlines that hug a linked body", () => {
  it("seeds just outside the widest points across the stream, at growing offsets", () => {
    const f = compileFlow(flowDoc(), section);
    const seeds = bodyHugSeeds(f, { count: 3, height: 0, first: 0.03 });
    expect(seeds).toHaveLength(6);
    // the stream heads −x, so "across" is ±y; offsets 0.03, 0.09, 0.27 on each side
    for (const side of [1, -1]) {
      const ys = seeds.filter((s) => s.side === side).map((s) => s.seed[1]);
      expect(new Set(ys.map(Math.sign)).size).toBe(1);
      expect(ys.map((y) => +(Math.abs(y) - maxHalf).toFixed(6))).toEqual([0.03, 0.09, 0.27]);
    }
    for (const s of seeds) expect(f.body.contains(...s.seed)).toBe(false);
  });

  it("has nothing to hug without a body", () => {
    const doc = { ...flowDoc(), body: null };
    expect(bodyHugSeeds(compileFlow(doc, null), { count: 3 })).toEqual([]);
    expect(bodyHugSeeds(compileFlow(flowDoc(), section), { count: 0 })).toEqual([]);
  });

  it("traces through the seed both ways, in the flow's direction, and passes the body at the offset", () => {
    const f = compileFlow(flowDoc(), section);
    const [h] = bodyHugSeeds(f, { count: 1, height: 0, first: 0.03 });
    const tr = traceThrough(f, h.seed, { step: 0.02, maxSteps: 4000, planar: true });
    // starts upstream (x max: the stream heads −x) and ends downstream
    expect(tr.points[0][0]).toBeGreaterThan(7.4);
    expect(tr.points.at(-1)[0]).toBeLessThan(-2.4);
    expect(tr.points.length).toBe(tr.speeds.length);
    // it never gets inside, and along the hull it stays close: within 3 cm at the widest point, under 25 cm over the middle 80%
    let closest = Infinity;
    for (const [x, y] of tr.points) {
      expect(f.body.contains(x, y, 0)).toBe(false);
      if (x > 0.5 && x < 4.5) {
        const d = distToHull(x, y);
        closest = Math.min(closest, d);
        expect(d).toBeLessThan(0.25);
      }
    }
    expect(closest).toBeGreaterThan(0.02);
    expect(closest).toBeLessThan(0.031);
  });

  it("widens the domain across the stream only", () => {
    const f = compileFlow(flowDoc(), section);
    const w = widenAcross(f, 0.25);
    [-2.5, -4.5, -1].forEach((v, i) => expect(w.min[i]).toBeCloseTo(v, 9));
    [7.5, 4.5, 0.5].forEach((v, i) => expect(w.max[i]).toBeCloseTo(v, 9));
  });

  it("the 3D build adds them, notes them, and the rake's outer lines no longer stop at the side", () => {
    const doc = flowDoc();
    const plain = computeStreamlines(doc, { hugLines: 0, seedCount: 15, rakeRows: 1, step: 0.05, maxSteps: 800, tubes: false }, { section });
    const hugged = computeStreamlines(doc, { hugLines: 2, seedCount: 15, rakeRows: 1, step: 0.05, maxSteps: 800, tubes: false }, { section });
    expect(hugged.lines.length).toBe(plain.lines.length + 4);
    expect(hugged.lines.filter((l) => l.hug).length).toBe(4);
    // every rake line reaches the downstream face (x = −2.5), none ends on a side
    for (const l of plain.lines) expect(l.points.at(-1)[0]).toBeLessThan(-2.49);
    const { meta } = buildStreamlines(doc, { hugLines: 2, seedCount: 15, rakeRows: 1, tubes: true, tubeRadius: 0.02 }, { section });
    expect(meta.notes).toMatch(/and 4 passing the body 40 mm, 120 mm off/);
  });
});

describe("a provider param picks the body model", () => {
  it("overrides the doc's model without touching the doc", () => {
    const doc = Object.freeze({ ...flowDoc("waterplane-2d"), body: Object.freeze(flowDoc().body) });
    const d = withBodyModel(doc, "slender-body-3d");
    expect(d.body.model).toBe("slender-body-3d");
    expect(doc.body.model).toBe("waterplane-2d");
    expect(withBodyModel(doc, "doc")).toBe(doc);
    expect(withBodyModel({ ...doc, body: null }, "slender-body-3d").body).toBeNull();
  });

  it("builds slender-body streamlines from a waterplane doc, and says so", () => {
    const { meta } = buildStreamlines(flowDoc("waterplane-2d"), { bodyModel: "slender-body-3d", seedCount: 9, rakeRows: 1 }, { section });
    expect(meta.notes).toMatch(/body: Slender body \(3D\), \d+ line-source segments/);
    const { field } = computeStreamlines(flowDoc("waterplane-2d"), { bodyModel: "slender-body-3d", seedCount: 3, rakeRows: 1 }, { section });
    expect(field.body.model).toBe("slender-body-3d");
    const { field: asDoc } = computeStreamlines(flowDoc("waterplane-2d"), { seedCount: 3, rakeRows: 1 }, { section });
    expect(asDoc.body.model).toBe("waterplane-2d");
  });

  it("the slice takes it too", () => {
    const { field } = computeSlice(flowDoc("waterplane-2d"), { bodyModel: "slender-body-3d", resolution: 20 }, { section });
    expect(field.body.model).toBe("slender-body-3d");
  });
});

describe("the slice's outline samples", () => {
  it("samples a crossing part of the way back toward the stream end with edgeSample", () => {
    const domain = { min: [0, 0, 0], max: [2, 1, 0] };
    const seen = [];
    const sample = (x, y) => (seen.push([x, y]), { values: { v: x }, masked: false });
    // mask everything right of x = 1.5, crossing at t = 0.5 of the cell edge 1 → 2
    const mask = (nx, ny, xAt) => {
      const m = new Uint8Array((nx + 1) * (ny + 1));
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) m[j * (nx + 1) + i] = xAt(i) > 1.5 ? 1 : 0;
      return m;
    };
    const g = sliceGrid(domain, 0, 2, ["v"], sample, { mask, edge: () => 0.5, edgeSample: 0.5 });
    const crossings = g.positions.length / 3 - g.gridVertices;
    expect(crossings).toBeGreaterThan(0);
    for (let v = g.gridVertices; v < g.positions.length / 3; v++) {
      expect(g.positions[v * 3]).toBeCloseTo(1.5); // placed on the outline
      expect(g.fields.v[v]).toBeCloseTo(1.25); // sampled halfway back to x = 1
    }
  });

  it("keeps the panel body's corner spikes off the slice's outline", () => {
    const { grid, field } = computeSlice(flowDoc(), { resolution: 80, mask: true }, { section });
    const used = new Set(grid.indices);
    let gridLo = Infinity, gridHi = -Infinity, lo = Infinity, hi = -Infinity;
    for (let v = 0; v < grid.gridVertices; v++) if (used.has(v)) { gridLo = Math.min(gridLo, grid.fields.cp[v]); gridHi = Math.max(gridHi, grid.fields.cp[v]); }
    for (let v = grid.gridVertices; v < grid.positions.length / 3; v++) { lo = Math.min(lo, grid.fields.cp[v]); hi = Math.max(hi, grid.fields.cp[v]); }
    // the outline's vertices add nothing more extreme than the grid next to them
    // (sampled right on it, the transom corners read Cp −20 and worse)
    expect(lo).toBeGreaterThanOrEqual(gridLo);
    expect(hi).toBeLessThanOrEqual(gridHi);
    expect(field.body.model).toBe("waterplane-2d");
  });
});

describe("the editor's heatmap with an exact body", () => {
  it("leaves the body out of the cell mask and fills its cells from outside", () => {
    const f = compileFlow(flowDoc(), section);
    const exact = sampleHeatmap(f, 0, 60, 36, { mask: true, maskEvery: 2, exactBody: true });
    const masked = sampleHeatmap(f, 0, 60, 36, { mask: true, maskEvery: 2 });
    const bodyCells = exact.bodyCells.reduce((a, b) => a + b, 0);
    expect(bodyCells).toBeGreaterThan(20);
    expect(exact.inside.reduce((a, b) => a + b, 0)).toBe(0); // nothing else to mask
    expect(masked.inside.reduce((a, b) => a + b, 0)).toBe(bodyCells); // the old mask: the same cells
    // body cells carry outside values (dilated inward): within the outside range
    let lo = Infinity, hi = -Infinity;
    exact.cp.forEach((c, i) => { if (!exact.bodyCells[i]) { lo = Math.min(lo, c); hi = Math.max(hi, c); } });
    exact.cp.forEach((c, i) => { if (exact.bodyCells[i]) { expect(c).toBeGreaterThanOrEqual(lo - 1e-6); expect(c).toBeLessThanOrEqual(hi + 1e-6); } });
  });

  it("dilateInto fills holes ring by ring from their neighbours", () => {
    const v = Float32Array.from([1, 1, 1, 1, 9, 1, 1, 1, 1]);
    dilateInto(v, Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3);
    expect(v[4]).toBe(1);
    const w = Float32Array.from([2, 0, 0, 0]);
    dilateInto(w, Uint8Array.from([0, 1, 1, 1]), 4, 1);
    expect([...w]).toEqual([2, 2, 2, 2]);
  });
});

describe("tracing in a widened domain", () => {
  it("lets a line pushed sideways reach the downstream face", () => {
    const f = compileFlow(flowDoc(), section);
    const seed = [7.49, 2.95, 0];
    const narrow = traceStreamline(f, seed, { step: 0.05, maxSteps: 800, planar: true });
    const wide = traceStreamline(f, seed, { step: 0.05, maxSteps: 800, planar: true, domain: widenAcross(f) });
    expect(narrow.points.at(-1)[1]).toBeCloseTo(3); // stopped on the side
    expect(wide.points.at(-1)[0]).toBeCloseTo(-2.5); // went all the way
  });
});

describe("a linked body's cut, for the editor to fill exactly", () => {
  it("waterplane: the waterline itself, at every height", () => {
    const f = compileFlow(flowDoc(), section);
    const cut = f.body.outlineAt(0.4);
    expect(cut).toHaveLength(1);
    expect(cut).toBe(f.body.outlineAt(-0.3));
    expect(cut[0].length).toBe(f.body.loops[0].length);
  });
  it("slender body: matches contains() at the stations, and narrows off the plane", () => {
    const f = compileFlow(flowDoc("slender-body-3d"), section);
    for (const z of [0, 0.3]) {
      const [loop] = f.body.outlineAt(z);
      const n = loop.length / 2;
      let widest = 0;
      for (let i = 1; i < n - 1; i++) {
        const [x, ylo] = loop[i];
        const yhi = loop[loop.length - 1 - i][1];
        expect(loop[loop.length - 1 - i][0]).toBe(x);
        if (yhi - ylo < 1e-3) continue;
        widest = Math.max(widest, yhi - ylo);
        const mid = (ylo + yhi) / 2;
        expect(f.body.contains(x, mid, z)).toBe(true);
        expect(f.body.contains(x, ylo + 1e-4, z)).toBe(true);
        expect(f.body.contains(x, ylo - 1e-3, z)).toBe(false);
        expect(f.body.contains(x, yhi + 1e-3, z)).toBe(false);
      }
      if (z === 0) expect(widest).toBeGreaterThan(1.5);
      else expect(widest).toBeLessThan(1.6);
    }
    // it runs past the transom: the dead-water closure is part of the body
    const xs = f.body.outlineAt(0)[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(-0.5);
  });
  it("an empty body has no cut", () => {
    const f = compileFlow(flowDoc(), { ...section, loops: [] });
    expect(f.body.outlineAt(0)).toEqual([]);
  });
});

describe("slender-body streamlines at the waterline", () => {
  it("stay level when seeded just off the section plane, instead of climbing over the double body", () => {
    const params = { bodyModel: "slender-body-3d", seedCount: 15, rakeRows: 1, seedHeight: 0.03, step: 0.05, maxSteps: 800, tubeRadius: 0.018, hugLines: 3 };
    const { lines } = computeStreamlines(flowDoc("waterplane-2d"), params, { section });
    expect(lines.length).toBeGreaterThan(15);
    for (const l of lines) for (const q of l.points) expect(q[2]).toBeCloseTo(0.03, 9);
    // and a row well below it is still 3D (it goes under and round the body)
    const deep = computeStreamlines(flowDoc("waterplane-2d"), { ...params, seedHeight: -0.4, hugLines: 0 }, { section });
    const zs = deep.lines.flatMap((l) => l.points.map((q) => q[2]));
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.01);
  });
});
