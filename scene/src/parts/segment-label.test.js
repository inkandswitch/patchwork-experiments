import { describe, it, expect } from "vitest";
import { placeBetween, placeOffSegment } from "./segment-label.js";

describe("a segment's label, off a short segment", () => {
  it("sits at the midpoint of a dimension that is long on screen", () => {
    expect(placeOffSegment({ x: 0, y: 100 }, { x: 300, y: 100 }, 90, 16)).toEqual({ x: 150, y: 100, leader: null });
    // 2.5 label widths is long enough; a close-up of a short part (2 widths) is not
    expect(placeOffSegment({ x: 0, y: 100 }, { x: 225, y: 100 }, 90, 16).leader).toBe(null);
    expect(placeOffSegment({ x: 0, y: 100 }, { x: 180, y: 100 }, 90, 16).leader).not.toBe(null);
  });
  it("moves off a short dimension, upward, clear of the line, with a leader to the midpoint", () => {
    // a 20 px horizontal cleat under a 90 px label
    const p = placeOffSegment({ x: 100, y: 200 }, { x: 120, y: 200 }, 90, 16);
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(200 - 14 - 8); // gap + half the label's height
    expect(p.leader).toEqual({ x0: 110, y0: 200, x1: p.x, y1: p.y });
    // the label's box no longer covers the dimension
    expect(p.y + 8).toBeLessThan(200);
    // a slanted one goes perpendicular, still upward on screen
    const q = placeOffSegment({ x: 100, y: 200 }, { x: 110, y: 190 }, 90, 16);
    expect(q.y).toBeLessThan(195);
    expect(q.x).toBeLessThan(105);
    // a vertical one goes to the right, clearing half the label's width
    const v = placeOffSegment({ x: 100, y: 200 }, { x: 100, y: 180 }, 90, 16);
    expect(v.y).toBeCloseTo(190);
    expect(v.x - 45).toBeGreaterThan(100);
  });
  it("copes with a zero-length dimension", () => {
    const p = placeOffSegment({ x: 50, y: 50 }, { x: 50, y: 50 }, 60, 16);
    expect(p.x).toBe(50);
    expect(p.y).toBeLessThan(50 - 8);
  });
});

describe("placeBetween", () => {
  // a projection that sees x ≥ 0 only, at 10 px a unit
  const project = (p) => (p[0] >= 0 ? { x: p[0] * 10, y: 100 - p[1] * 10 } : null);
  it("is hidden while the middle can't be seen, at the middle while an end can't be, else off the segment as placeOffSegment says", () => {
    expect(placeBetween([-4, 0, 0], [2, 0, 0])({ project, w: 40, h: 14 })).toBe(null);
    expect(placeBetween([-1, 0, 0], [3, 0, 0])({ project, w: 40, h: 14 })).toEqual({ x: 10, y: 100 });
    const p = placeOffSegment(project([1, 0, 0]), project([2, 0, 0]), 40, 14);
    expect(placeBetween([1, 0, 0], [2, 0, 0])({ project, w: 40, h: 14 })).toEqual({ x: p.x, y: p.y, leader: { x: 15, y: 100 } });
    expect(placeBetween([0, 0, 0], [20, 0, 0])({ project, w: 40, h: 14 })).toEqual({ x: 100, y: 100, leader: null });
  });
});
