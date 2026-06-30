import { describe, it, expect } from "vitest";
import {
  freehandTuning,
  freehandPath,
  shapePaths,
  seedFromId,
  roughRectPath,
  roughEllipsePath,
  roughArrowHead,
  roughLinkPath,
  roughLink,
  roughArrow,
  roughChevron,
  shapeBounds,
  strokeBounds,
  distToSegment,
} from "./draw.js";

const isPathArray = (arr) => {
  expect(Array.isArray(arr)).toBe(true);
  expect(arr.length).toBeGreaterThan(0);
  for (const p of arr) {
    expect(typeof p.d).toBe("string");
    expect(p.d.length).toBeGreaterThan(0);
    expect(typeof p.strokeWidth).toBe("number");
  }
};

describe("seedFromId", () => {
  it("is deterministic for the same id", () => {
    expect(seedFromId("hello")).toBe(seedFromId("hello"));
    expect(seedFromId("a-long-item-id-123")).toBe(seedFromId("a-long-item-id-123"));
  });

  it("produces different seeds for different ids (usually)", () => {
    expect(seedFromId("abc")).not.toBe(seedFromId("xyz"));
  });

  it("always returns a positive integer", () => {
    for (const id of ["", "a", "zzzzzzzzzzzz", "🙂id", "0", "----"]) {
      const s = seedFromId(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
    }
  });

  it("never returns 0 (empty id falls back to 1)", () => {
    expect(seedFromId("")).toBe(1);
  });
});

describe("freehandTuning", () => {
  it("turns thinning off at the thinnest size", () => {
    const t = freehandTuning(2);
    expect(t.thinning).toBe(0);
    expect(t.smoothing).toBe(0.5);
    expect(t.streamline).toBe(0.5);
  });

  it("ramps thinning toward 0.75 at the fattest size and clamps", () => {
    expect(freehandTuning(18).thinning).toBeCloseTo(0.75, 6);
    // beyond the top of the range it stays clamped, not larger
    expect(freehandTuning(100).thinning).toBeCloseTo(0.75, 6);
  });

  it("clamps below the thinnest size to 0", () => {
    expect(freehandTuning(0).thinning).toBe(0);
    expect(freehandTuning(-5).thinning).toBe(0);
  });

  it("defaults size to 5", () => {
    expect(freehandTuning()).toEqual(freehandTuning(5));
  });
});

describe("freehandPath", () => {
  it("returns a non-empty SVG path for a list of points", () => {
    const points = [
      [0, 0, 0.5],
      [10, 5, 0.5],
      [20, 0, 0.5],
      [30, 8, 0.5],
    ];
    const d = freehandPath(points, 6);
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
    expect(d.startsWith("M")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("returns an empty string for no points", () => {
    expect(freehandPath([], 5)).toBe("");
  });

  it("honours a thinning override (highlighter-style flat line)", () => {
    const points = [
      [0, 0, 0.7],
      [10, 0, 0.7],
      [20, 0, 0.7],
    ];
    const d = freehandPath(points, 8, { thinning: 0 });
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
  });

  it("works with a single point", () => {
    const d = freehandPath([[5, 5, 0.5]], 5);
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
  });
});

describe("roughRectPath", () => {
  it("returns path objects with non-empty d strings", () => {
    isPathArray(roughRectPath(120, 80, seedFromId("rect")));
  });

  it("clamps tiny dimensions without throwing", () => {
    isPathArray(roughRectPath(0, 0, 1));
    isPathArray(roughRectPath(2, 1, 7));
  });

  it("is deterministic for the same seed", () => {
    const a = roughRectPath(100, 60, 42);
    const b = roughRectPath(100, 60, 42);
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
  });
});

describe("roughEllipsePath", () => {
  it("returns path objects with non-empty d strings", () => {
    isPathArray(roughEllipsePath(120, 80, seedFromId("ell")));
  });

  it("clamps tiny dimensions", () => {
    isPathArray(roughEllipsePath(0, 0, 3));
  });

  it("is deterministic for the same seed", () => {
    const a = roughEllipsePath(90, 90, 9);
    const b = roughEllipsePath(90, 90, 9);
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
  });
});

describe("roughArrowHead", () => {
  it("returns filled triangle paths with d, fill and strokeWidth", () => {
    const paths = roughArrowHead(5);
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(typeof p.d).toBe("string");
      expect(p.d.length).toBeGreaterThan(0);
      expect(typeof p.fill).toBe("string");
      expect(typeof p.strokeWidth).toBe("number");
    }
  });

  it("respects a custom size", () => {
    isPathArray(roughArrowHead(1, 30));
  });

  it("falls back to seed 1 for a falsy seed", () => {
    const a = roughArrowHead(0);
    const b = roughArrowHead(1);
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
  });
});

describe("roughLinkPath", () => {
  it("returns a sketchy cubic between two points", () => {
    isPathArray(roughLinkPath(0, 0, 200, 100, 3));
  });

  it("is deterministic for the same args", () => {
    const a = roughLinkPath(0, 0, 150, 50, 2);
    const b = roughLinkPath(0, 0, 150, 50, 2);
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
  });
});

describe("roughLink (memoised relative wire)", () => {
  it("returns path objects with non-empty d strings", () => {
    isPathArray(roughLink(100, 40, 1));
  });

  it("returns the SAME cached array for identical rounded args", () => {
    const a = roughLink(123.2, 45.4, 7);
    const b = roughLink(123.1, 45.3, 7); // rounds to the same key
    expect(a).toBe(b);
  });

  it("defaults seed to 1", () => {
    expect(roughLink(50, 50)).toBe(roughLink(50, 50, 1));
  });
});

describe("roughArrow (memoised arrowhead)", () => {
  it("returns the same cached array for the same seed/size", () => {
    const a = roughArrow(4, 13);
    const b = roughArrow(4, 13);
    expect(a).toBe(b);
    isPathArray(a);
  });

  it("differs by size key", () => {
    expect(roughArrow(4, 13)).not.toBe(roughArrow(4, 20));
  });
});

describe("roughChevron (open arrowhead)", () => {
  it("returns the same cached array for the same seed/size", () => {
    const a = roughChevron(2, 8);
    const b = roughChevron(2, 8);
    expect(a).toBe(b);
    isPathArray(a);
  });

  it("differs by size key", () => {
    expect(roughChevron(2, 8)).not.toBe(roughChevron(2, 12));
  });
});

describe("shapePaths", () => {
  const base = (over) => ({
    id: "s1",
    x: 10,
    y: 20,
    w: 100,
    h: 60,
    color: "#112233",
    fill: "none",
    strokeWidth: 2,
    seed: seedFromId("s1"),
    ...over,
  });

  it("handles a rectangle", () => {
    isPathArray(shapePaths(base({ type: "rectangle" })));
  });

  it("handles a square-cornered rectangle", () => {
    isPathArray(shapePaths(base({ type: "rectangle", corner: "square" })));
  });

  it("handles a rounded-rect (squircle) rectangle", () => {
    isPathArray(shapePaths(base({ type: "rectangle", corner: "squircle" })));
  });

  it("handles an ellipse", () => {
    isPathArray(shapePaths(base({ type: "ellipse" })));
  });

  it("handles a straight line", () => {
    isPathArray(shapePaths(base({ type: "line" })));
  });

  it("handles a curved line (with control point)", () => {
    isPathArray(shapePaths(base({ type: "line", cx: 50, cy: 100 })));
  });

  it("handles an arrow (default end arrowhead)", () => {
    const paths = shapePaths(base({ type: "arrow" }));
    isPathArray(paths);
    // shaft + two arrowhead barbs → at least 3 path infos
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it("handles a double-ended arrow", () => {
    const paths = shapePaths(base({ type: "arrow", startArrow: true, endArrow: true }));
    isPathArray(paths);
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });

  it("handles a curved arrow", () => {
    isPathArray(shapePaths(base({ type: "arrow", cx: 60, cy: 120 })));
  });

  it("returns an empty array for an unknown type", () => {
    expect(shapePaths(base({ type: "wat" }))).toEqual([]);
  });

  it("includes a fill path when fill is set", () => {
    const paths = shapePaths(base({ type: "rectangle", fill: "#ff2284", fillStyle: "solid" }));
    isPathArray(paths);
    expect(paths.some((p) => p.fill && p.fill !== "none")).toBe(true);
  });

  it("applies a dash to the outline when strokeStyle is dashed", () => {
    const paths = shapePaths(base({ type: "rectangle", corner: "square", strokeStyle: "dashed" }));
    expect(paths.some((p) => typeof p.dash === "string" && p.dash.includes(","))).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const a = shapePaths(base({ type: "rectangle" }));
    const b = shapePaths(base({ type: "rectangle" }));
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
  });
});

describe("shapeBounds", () => {
  it("normalises negative width/height", () => {
    const b = shapeBounds({ x: 100, y: 100, w: -40, h: -20 });
    expect(b).toEqual({ x: 60, y: 80, w: 40, h: 20 });
  });

  it("leaves positive dimensions as-is", () => {
    expect(shapeBounds({ x: 5, y: 5, w: 30, h: 10 })).toEqual({ x: 5, y: 5, w: 30, h: 10 });
  });
});

describe("strokeBounds", () => {
  it("wraps the points with size/2 padding", () => {
    const b = strokeBounds({ points: [[0, 0], [10, 20]], size: 4 });
    expect(b.x).toBe(-2);
    expect(b.y).toBe(-2);
    expect(b.w).toBe(14); // 10 + 2*2
    expect(b.h).toBe(24); // 20 + 2*2
  });
});

describe("distToSegment", () => {
  it("is 0 on the segment", () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it("measures perpendicular distance to the segment body", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 6);
  });

  it("clamps to the nearest endpoint past the end", () => {
    expect(distToSegment(20, 0, 0, 0, 10, 0)).toBeCloseTo(10, 6);
  });

  it("handles a degenerate (zero-length) segment as distance to the point", () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });
});
