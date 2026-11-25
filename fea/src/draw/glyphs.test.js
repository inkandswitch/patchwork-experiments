import { setupGlyphs, arrow, pin, placeOf } from "./glyphs.js";
import { readPart } from "../part/faces.js";
import { box, plateWithHole, cylinder } from "../test/shapes.js";
import { normalizeSetup, newLoad } from "../setup.js";

const part = readPart(box(0.2, 0.1, 0.05));
const L = part.diagonal;
const faceFacing = (n) => part.faces.find((f) => n.every((v, k) => Math.abs(f.normal[k] - v) < 1e-9));
const segments = (a) => {
  const out = [];
  for (let i = 0; i < a.length; i += 6) out.push([[a[i], a[i + 1], a[i + 2]], [a[i + 3], a[i + 4], a[i + 5]]]);
  return out;
};
const near = (p, q, digits = 6) => p.forEach((v, k) => expect(v).toBeCloseTo(q[k], digits));
/** The arrows in a list of segments: each a shaft (tail → tip) and four barbs from the tip. */
const arrowsOf = (a) => {
  const s = segments(a);
  expect(s.length % 5).toBe(0);
  return Array.from({ length: s.length / 5 }, (_, i) => ({ tail: s[i * 5][0], tip: s[i * 5][1], barbs: s.slice(i * 5 + 1, i * 5 + 5) }));
};

describe("arrow and pin", () => {
  it("an arrow is a shaft from tail to tip and four barbs back from the tip", () => {
    const out = [];
    arrow(out, [1, 2, 3], [0, 0, -1], 2);
    const [a] = arrowsOf(out);
    expect(a.tail).toEqual([1, 2, 5]);
    expect(a.tip).toEqual([1, 2, 3]);
    for (const [from, to] of a.barbs) {
      expect(from).toEqual([1, 2, 3]);
      // back up the shaft a little, and out to the side
      expect(to[2]).toBeCloseTo(3 + 2 * 0.28, 12);
      expect(Math.hypot(to[0] - 1, to[1] - 2)).toBeCloseTo(2 * 0.11, 12);
    }
  });

  it("an arrow along y (where 'across' must use another helper axis) is still square", () => {
    const out = [];
    arrow(out, [0, 0, 0], [0, 1, 0], 1);
    for (const [, to] of arrowsOf(out)[0].barbs) expect(Math.hypot(to[0], to[2])).toBeCloseTo(0.11, 12);
  });

  it("a pin is 8 segments standing off its face; a sliding one 12", () => {
    const fixed = [], slide = [];
    pin(fixed, [0, 0, 0], [1, 0, 0], 1);
    pin(slide, [0, 0, 0], [1, 0, 0], 1, true);
    expect(segments(fixed).length).toBe(8);
    expect(segments(slide).length).toBe(12);
    // its foot is a square at `size` out along the normal; its point is on the face
    for (const [p, q] of segments(fixed)) for (const v of [p, q]) expect(v[0] === 0 || Math.abs(v[0] - 1) < 1e-12).toBe(true);
    for (const [p, q] of segments(slide).slice(8)) for (const v of [p, q]) expect(v[0]).toBeCloseTo(1.3, 12);
  });
});

describe("placeOf", () => {
  it("the area-weighted centre and mean direction of faces", () => {
    const a = faceFacing([1, 0, 0]), b = faceFacing([0, 1, 0]);
    const p = placeOf(part, [a.id, b.id]);
    expect(p.area).toBeCloseTo(a.area + b.area, 15);
    near(p.at, a.centroid.map((v, k) => (v * a.area + b.centroid[k] * b.area) / (a.area + b.area)), 12);
    const n = [a.area, b.area, 0].map((v) => v / Math.hypot(a.area, b.area));
    near(p.normal, n, 12);
    expect(placeOf(part, [])).toBeNull();
    expect(placeOf(part, [99])).toBeNull();
  });
});

describe("setupGlyphs", () => {
  it("one pin a supported face: 8 segments, or 12 for a slide; each pin's point on its face's centre", () => {
    const wall = faceFacing([-1, 0, 0]), floor = faceFacing([0, -1, 0]), back = faceFacing([0, 0, -1]);
    const g = setupGlyphs(part, normalizeSetup({
      supports: { a: { name: "Wall", kind: "fixed", faces: [wall.id, back.id] }, b: { name: "Floor", kind: "slide", faces: [floor.id] } },
    }));
    const s = segments(g.supports);
    expect(s.length).toBe(8 + 8 + 12);
    // a pin's first segment runs from its point on the face out to its foot
    near(s[0][0], wall.centroid, 6);
    near(s[8][0], back.centroid, 6);
    near(s[16][0], floor.centroid, 6);
    expect(s[0][1][0]).toBeLessThan(wall.centroid[0]); // standing out of the face, along −x
    expect(g.loads.length).toBe(0);
    expect(g.items).toEqual([
      { what: "support", id: "a", name: "Wall", at: placeOf(part, [wall.id, back.id]).at },
      { what: "support", id: "b", name: "Floor", at: floor.centroid },
    ]);
  });

  it("a force: one arrow, its tip at its faces' centre, pointing along its direction", () => {
    const end = faceFacing([1, 0, 0]);
    const g = setupGlyphs(part, normalizeSetup({ loads: { f: { name: "Pull", kind: "force", faces: [end.id], magnitude: { value: 1, unit: "kN" }, direction: [3, -4, 0] } } }));
    const [a] = arrowsOf(g.loads);
    expect(arrowsOf(g.loads).length).toBe(1);
    near(a.tip, end.centroid, 6);
    const d = a.tip.map((v, k) => v - a.tail[k]);
    expect(Math.hypot(...d)).toBeCloseTo(L * 0.18, 6);
    near(d.map((v) => v / Math.hypot(...d)), [0.6, -0.8, 0], 6);
    expect(g.items).toEqual([{ what: "load", id: "f", name: "Pull", at: end.centroid }]);
  });

  it("a force on two faces: one arrow, at their centre taken together", () => {
    const a = faceFacing([1, 0, 0]), b = faceFacing([0, 1, 0]);
    const g = setupGlyphs(part, normalizeSetup({ loads: { f: { name: "F", kind: "force", faces: [a.id, b.id], magnitude: { value: 1, unit: "N" }, direction: [0, -1, 0] } } }));
    expect(arrowsOf(g.loads).length).toBe(1);
    near(arrowsOf(g.loads)[0].tip, placeOf(part, [a.id, b.id]).at, 6);
  });

  it("a pressure: an arrow a face, pushing into it; a negative one pulls out", () => {
    const top = faceFacing([0, 1, 0]), end = faceFacing([1, 0, 0]);
    const push = setupGlyphs(part, normalizeSetup({ loads: { p: { name: "P", kind: "pressure", faces: [top.id, end.id], pressure: { value: 2, unit: "MPa" } } } }));
    const arrows = arrowsOf(push.loads);
    expect(arrows.length).toBe(2);
    arrows.forEach((a, i) => {
      const f = [top, end][i];
      near(a.tip, f.centroid, 6);
      const d = a.tip.map((v, k) => v - a.tail[k]);
      // pointing against the face's outward normal: into the part
      near(d.map((v) => v / Math.hypot(...d)), f.normal.map((v) => -v), 6);
    });
    const pull = setupGlyphs(part, normalizeSetup({ loads: { p: { name: "P", kind: "pressure", faces: [top.id], pressure: { value: -2, unit: "MPa" } } } }));
    const [a] = arrowsOf(pull.loads);
    near(a.tail, top.centroid, 6);
    expect(a.tip[1]).toBeGreaterThan(top.centroid[1]);
  });

  it("gravity: an arrow along its direction through the middle of the part's box", () => {
    const g = setupGlyphs(part, normalizeSetup({ loads: { g: { ...newLoad("gravity"), direction: [1, -1, 0] } } }));
    const [a] = arrowsOf(g.loads);
    const centre = [0, 1, 2].map((k) => (part.box.min[k] + part.box.max[k]) / 2);
    near(a.tip.map((v, k) => (v + a.tail[k]) / 2), centre, 7);
    const d = a.tip.map((v, k) => v - a.tail[k]);
    near(d.map((v) => v / Math.hypot(...d)), [Math.SQRT1_2, -Math.SQRT1_2, 0], 6);
    expect(g.items).toEqual([{ what: "load", id: "g", name: "Gravity", at: centre }]);
  });

  it("faces the part doesn't have draw nothing, and are listed nowhere", () => {
    const g = setupGlyphs(part, normalizeSetup({
      supports: { a: { name: "A", kind: "fixed", faces: [42] } },
      loads: { f: { name: "F", kind: "force", faces: [42], magnitude: { value: 1, unit: "N" }, direction: [0, -1, 0] } },
    }));
    expect([g.supports.length, g.loads.length, g.items.length]).toEqual([0, 0, 0]);
  });

  // a face that closes round on itself (a hole's wall) has no one direction: its mark stands on a point of the face
  it("a pressure on a hole's wall draws an arrow", () => {
    const plate = readPart(plateWithHole(0.1, 0.06, 0.005, 0.01, 32));
    const hole = plate.faces.find((f) => f.radius);
    const g = setupGlyphs(plate, normalizeSetup({ loads: { p: { name: "Bore", kind: "pressure", faces: [hole.id], pressure: { value: 1, unit: "MPa" } } } }));
    expect(g.items.length).toBe(1);
    expect(g.loads.length).toBeGreaterThan(0);
  });

  // a tube's middle is on its axis, inside the part: its pin stands on the wall, pointing out
  it("a pin on a tube's wall stands on the wall", () => {
    const r = 0.01, c = readPart(cylinder(r, 0.05, 32));
    const side = c.faces.find((f) => !f.flat);
    const g = setupGlyphs(c, normalizeSetup({ supports: { a: { name: "Shaft", kind: "fixed", faces: [side.id] } } }));
    const [point] = segments(g.supports)[0];
    expect(Math.hypot(point[0], point[1])).toBeCloseTo(r, 3);
  });

  it("Float32 segments, six numbers each", () => {
    const g = setupGlyphs(part, normalizeSetup({ supports: { a: { name: "A", kind: "fixed", faces: [0] } }, loads: { g: newLoad("gravity") } }));
    expect(g.supports).toBeInstanceOf(Float32Array);
    expect(g.loads).toBeInstanceOf(Float32Array);
    expect(g.loads.length % 6).toBe(0);
  });
});
