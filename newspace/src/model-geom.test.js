import { describe, it, expect } from "vitest";
import {
  rad, rot, isBoxType, localToWorld, worldToLocal, pointInFrame,
  itemBounds, cloneItem, arrowGeometry, linkItemId, portPoint,
} from "./model.js";

// These exercise the pure geometry/helpers in model.js. Cases here are chosen to
// NOT overlap model.test.js / model-extra.test.js (which already cover the basic
// identity transforms, single-end arrow bindings, the simple stroke/doc clone,
// and the 1/2/tall portPoint cases).

describe("rad", () => {
  it("converts degrees to radians", () => {
    expect(rad(180)).toBeCloseTo(Math.PI);
    expect(rad(0)).toBe(0);
    expect(rad(90)).toBeCloseTo(Math.PI / 2);
    expect(rad(-90)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("rot", () => {
  it("leaves the origin fixed for any angle", () => {
    const [x, y] = rot(0, 0, 1.234);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });
  it("is the identity at angle 0", () => {
    expect(rot(3, 4, 0)).toEqual([3, 4]);
  });
  it("rotates by -90° (clockwise in screen coords)", () => {
    const [x, y] = rot(0, 1, -Math.PI / 2);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
  });
  it("preserves vector length", () => {
    const [x, y] = rot(3, 4, 0.7);
    expect(Math.hypot(x, y)).toBeCloseTo(5);
  });
});

describe("isBoxType", () => {
  it("rejects null and other managed-doc-ish strings", () => {
    expect(isBoxType(null)).toBe(false);
    expect(isBoxType("sketch")).toBe(false);
    expect(isBoxType("doc")).toBe(false);
  });
});

describe("localToWorld / worldToLocal", () => {
  it("treats a missing rotation property as 0 (pure translation)", () => {
    const frame = { x: 10, y: 20, w: 100, h: 60 }; // no rotation key
    expect(localToWorld(frame, 5, 5)).toEqual([15, 25]);
    const [lx, ly] = worldToLocal(frame, 15, 25);
    expect(lx).toBeCloseTo(5);
    expect(ly).toBeCloseTo(5);
  });

  it("a 90° frame is NOT a pure translation — local axes are swapped", () => {
    // centre is (50,50); rotate +90° about it
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 90 };
    // local (0,0) (top-left) maps to the unrotated top-left rotated +90° about centre
    const [wx, wy] = localToWorld(frame, 0, 0);
    expect(wx).toBeCloseTo(100); // (-50,-50) rotated +90° -> (50,-50); +centre -> (100, 0)
    expect(wy).toBeCloseTo(0);
  });

  it("round-trips for several local points in a rotated frame", () => {
    const frame = { x: 17, y: -33, w: 140, h: 90, rotation: 123 };
    for (const [px, py] of [[0, 0], [140, 90], [70, 45], [10, 80]]) {
      const [wx, wy] = localToWorld(frame, px, py);
      const [lx, ly] = worldToLocal(frame, wx, wy);
      expect(lx).toBeCloseTo(px, 6);
      expect(ly).toBeCloseTo(py, 6);
    }
  });

  it("the frame centre is invariant under rotation", () => {
    const frame = { x: 0, y: 0, w: 80, h: 40, rotation: 47 };
    const [wx, wy] = localToWorld(frame, 40, 20); // local centre
    expect(wx).toBeCloseTo(40);
    expect(wy).toBeCloseTo(20);
  });
});

describe("pointInFrame", () => {
  it("includes the corners and edges (inclusive bounds)", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    expect(pointInFrame(frame, 0, 0)).toBe(true);     // top-left corner
    expect(pointInFrame(frame, 100, 100)).toBe(true); // bottom-right corner
    expect(pointInFrame(frame, 100, 0)).toBe(true);   // top-right corner
  });

  it("respects rotation — a point in the unrotated box can fall OUTSIDE once rotated", () => {
    const frame = { x: 0, y: 0, w: 100, h: 20, rotation: 90 };
    // (90,10) sits inside the unrotated thin box, but after a 90° turn the box is
    // tall+narrow about centre (50,10), so that world point is outside it.
    expect(pointInFrame(frame, 90, 10)).toBe(false);
    // ...while a point along the rotated long axis IS inside
    expect(pointInFrame(frame, 50, 50)).toBe(true);
  });
});

describe("itemBounds", () => {
  it("normalises a shape with negative width/height", () => {
    const s = { kind: "shape", type: "rectangle", x: 100, y: 100, w: -40, h: -30 };
    expect(itemBounds(s)).toEqual({ x: 60, y: 70, w: 40, h: 30 });
  });

  it("pads a stroke's bounds by half its size", () => {
    const s = { kind: "stroke", size: 10, points: [[0, 0, 0.5], [20, 40, 0.5]] };
    // min (0,0) max (20,40), pad = size/2 = 5
    expect(itemBounds(s)).toEqual({ x: -5, y: -5, w: 30, h: 50 });
  });

  it("computes a sketch's bounds as the padded bounding box of its nodes", () => {
    const sk = { kind: "sketch", strokeWidth: 2, nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 50 }] };
    // pad = max(8, strokeWidth + 6) = 8
    expect(itemBounds(sk)).toEqual({ x: -8, y: -8, w: 116, h: 66 });
  });

  it("gives a node-less sketch a minimal 1x1 box at its x/y", () => {
    expect(itemBounds({ kind: "sketch", x: 12, y: 34, nodes: [] })).toEqual({ x: 12, y: 34, w: 1, h: 1 });
  });
});

describe("cloneItem — sketch deep-clone", () => {
  it("deep-copies sketch nodes and bars (mutating the clone never touches the original)", () => {
    const o = {
      id: "sk", kind: "sketch", parent: "f1",
      nodes: [{ id: "n1", x: 0, y: 0, fixed: false }, { id: "n2", x: 10, y: 10 }],
      bars: [{ id: "b1", a: "n1", b: "n2", len: 14 }],
    };
    const c = cloneItem(o);
    expect(c.parent).toBeUndefined();
    expect(c.nodes).toEqual(o.nodes);
    expect(c.bars).toEqual(o.bars);
    expect(c.nodes).not.toBe(o.nodes);
    expect(c.nodes[0]).not.toBe(o.nodes[0]);
    expect(c.bars[0]).not.toBe(o.bars[0]);
    c.nodes[0].x = 999;
    c.bars[0].len = 0;
    expect(o.nodes[0].x).toBe(0);     // original node untouched
    expect(o.bars[0].len).toBe(14);   // original bar untouched
  });

  it("tolerates a sketch missing its nodes/bars arrays (defaults to empty)", () => {
    const c = cloneItem({ id: "sk", kind: "sketch" });
    expect(c.nodes).toEqual([]);
    expect(c.bars).toEqual([]);
  });

  it("does not add nodes/bars to a non-sketch item", () => {
    const c = cloneItem({ id: "x", kind: "shape", type: "rectangle", x: 0, y: 0, w: 1, h: 1 });
    expect("nodes" in c).toBe(false);
    expect("bars" in c).toBe(false);
  });
});

describe("arrowGeometry — legacy (anchor-less) bindings", () => {
  it("with both ends bound and no anchors, snaps to the facing edge midpoints toward each centre", () => {
    // boxes stacked vertically; from above, to below
    const from = { id: "a", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };   // centre 50,50
    const to = { id: "b", kind: "shape", type: "rectangle", x: 0, y: 300, w: 100, h: 100 };    // centre 50,350
    const arrow = { kind: "shape", type: "arrow", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" };
    const g = arrowGeometry(arrow, [from, to, arrow]);
    expect(g.x).toBeCloseTo(50);          // from: vertical run -> bottom edge mid x = 50
    expect(g.y).toBeCloseTo(107);         // from bottom edge (100) + 7 gap
    expect(g.x + g.w).toBeCloseTo(50);    // to: top edge mid x = 50
    expect(g.y + g.h).toBeCloseTo(293);   // to top edge (300) - 7 gap
  });

  it("mixes an anchored end with a legacy (facing-edge) end", () => {
    const from = { id: "a", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };  // centre 50,50
    const to = { id: "b", kind: "shape", type: "rectangle", x: 300, y: 0, w: 100, h: 100 };  // centre 350,50
    // from is anchored at its centre; to is legacy → faces the (anchored) from end
    const arrow = { kind: "shape", type: "arrow", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b", fromAnchor: { x: 0.5, y: 0.5 } };
    const g = arrowGeometry(arrow, [from, to, arrow]);
    expect(g.x).toBeCloseTo(50);        // anchored start = from centre
    expect(g.y).toBeCloseTo(50);
    expect(g.x + g.w).toBeCloseTo(293); // to faces left toward from centre: left edge (300) - 7 gap
    expect(g.y + g.h).toBeCloseTo(50);
  });

  it("ignores a fromId/toId that resolves to no item, keeping the stored coords", () => {
    const arrow = { kind: "shape", type: "arrow", x: 2, y: 3, w: 8, h: 9, fromId: "missing", toId: "gone" };
    expect(arrowGeometry(arrow, [])).toEqual({ x: 2, y: 3, w: 8, h: 9 });
  });
});

describe("linkItemId", () => {
  it("round-trips: the id is exactly the url with the li- prefix", () => {
    const url = "automerge:3EoRD6Adef8TitsP2SX3peY5bWxq";
    expect(linkItemId(url)).toBe("li-" + url);
  });
});

describe("portPoint — distribution", () => {
  const b = { x: 100, y: 100, w: 200, h: 100 }; // centre y = 150

  it("three ports place the middle one on centre and the others symmetric about it", () => {
    const lo = portPoint(b, "in", 0, 3);
    const mid = portPoint(b, "in", 1, 3);
    const hi = portPoint(b, "in", 2, 3);
    expect(mid.y).toBeCloseTo(150);                 // middle on centre
    expect(mid.y - lo.y).toBeCloseTo(hi.y - mid.y); // even spacing
    expect(lo.y + hi.y).toBeCloseTo(2 * 150);       // symmetric around centre
    // gap = min(h/(n+1), 20) = min(100/4, 20) = 20
    expect(hi.y - lo.y).toBeCloseTo(40);
  });

  it("distributes outlets on the right edge the same way as inlets on the left", () => {
    const inA = portPoint(b, "in", 0, 2), inB = portPoint(b, "in", 1, 2);
    const outA = portPoint(b, "out", 0, 2), outB = portPoint(b, "out", 1, 2);
    expect(inA.x).toBe(100); expect(outA.x).toBe(300);
    expect(outA.y).toBe(inA.y); // same vertical distribution, only x differs
    expect(outB.y).toBe(inB.y);
  });

  it("treats a count of 0 like a single centred port (n is floored at 1)", () => {
    expect(portPoint(b, "in", 0, 0)).toEqual({ x: 100, y: 150 });
  });

  it("uses the short box's own pitch when h/(n+1) is under the 20px cap", () => {
    const shortBox = { x: 0, y: 0, w: 10, h: 30 }; // h/(n+1) = 30/3 = 10 < 20
    const lo = portPoint(shortBox, "in", 0, 2), hi = portPoint(shortBox, "in", 1, 2);
    expect(hi.y - lo.y).toBeCloseTo(10); // not capped at 20
  });
});

// ── draw delegation: annotation parenting in/out of a spatial box ─────────────
import { ownsSpace, annotateItemIntoBox, projectItemFromBox, surfaceWithinBox } from "./model.js";
import { bindMapInstance } from "./box-transform.js";

// a fake Leaflet (no Leaflet in vitest): Mercator-ish px-per-degree with the Y INVERSION
const fakeMap = (zoom = 13, center = { lat: 51.5, lng: -0.09 }, size = { w: 400, h: 300 }) => {
  const scale = (256 * Math.pow(2, zoom)) / 360;
  return {
    latLngToContainerPoint: ([lat, lng]) => ({ x: size.w / 2 + (lng - center.lng) * scale, y: size.h / 2 - (lat - center.lat) * scale }),
    containerPointToLatLng: ([x, y]) => ({ lng: center.lng + (x - size.w / 2) / scale, lat: center.lat - (y - size.h / 2) / scale }),
  };
};
const mapBox = { id: "geo1", kind: "editor", editorId: "map", x: 100, y: 50, w: 400, h: 300 };

describe("ownsSpace — which items are draw-claim boundaries", () => {
  it("frames and maps own a space; strokes/shapes/docs/other editors don't", () => {
    expect(ownsSpace({ kind: "frame" })).toBe(true);
    expect(ownsSpace({ kind: "editor", editorId: "map" })).toBe(true);
    expect(ownsSpace({ kind: "editor", editorId: "minimap" })).toBe(false);
    expect(ownsSpace({ kind: "stroke" })).toBe(false);
    expect(ownsSpace({ kind: "doc" })).toBe(false);
    expect(ownsSpace(null)).toBe(false);
  });
});

describe("annotateItemIntoBox — a mark drawn over a spatial box gets parent + LOCAL coords", () => {
  it("a stroke over a MAP stores geo points ({x:lng, y:lat} slots), parent set, origin 0", () => {
    bindMapInstance("geo1", fakeMap(13));
    const item = { kind: "stroke", points: [[300, 200, 0.5], [340, 260, 0.7]], x: 0, y: 0, color: "line", size: 4 };
    annotateItemIntoBox(item, mapBox);
    expect(item.parent).toBe("geo1");
    expect(item.x).toBe(0); expect(item.y).toBe(0);
    // convention: point[0] = lng (x slot), point[1] = lat (y slot); pressure travels
    const [lng, lat, pr] = item.points[0];
    expect(pr).toBe(0.5);
    expect(Math.abs(lng)).toBeLessThan(180); expect(Math.abs(lat)).toBeLessThan(90);
    // the second point is LOWER on screen → SMALLER latitude (y-inversion honoured)
    expect(item.points[1][1]).toBeLessThan(lat);
    bindMapInstance("geo1", null);
  });
  it("a shape over a MAP converts both corners (h goes negative: lat shrinks downward)", () => {
    bindMapInstance("geo1", fakeMap(5));
    const item = { kind: "shape", type: "rectangle", x: 250, y: 120, w: 80, h: 60, color: "line" };
    annotateItemIntoBox(item, mapBox);
    expect(item.parent).toBe("geo1");
    expect(item.w).toBeGreaterThan(0);  // lng grows rightward
    expect(item.h).toBeLessThan(0);     // lat shrinks downward
    bindMapInstance("geo1", null);
  });
  it("a shape over a rotated FRAME converts its centre and folds the frame's turn into rotation", () => {
    const frame = { id: "f1", kind: "frame", url: "automerge:f1", x: 40, y: 40, w: 200, h: 150, rotation: 30 };
    const item = { kind: "shape", type: "rectangle", x: 100, y: 80, w: 60, h: 40, rotation: 10 };
    annotateItemIntoBox(item, frame);
    expect(item.parent).toBe("f1");
    expect(item.rotation).toBe(-20); // 10 - 30
    expect(item.w).toBe(60); expect(item.h).toBe(40); // a turning box keeps w/h
  });
});

describe("projectItemFromBox — render/drag-OUT projection is the exact inverse", () => {
  it("stroke round-trips world → geo → world at several zooms (the drag-out conversion)", () => {
    const world = [[300, 200, 0.5], [340, 260, 0.7], [123.25, 77.5, 1]];
    for (const zoom of [1, 5, 13]) {
      bindMapInstance("geo1", fakeMap(zoom));
      const item = { kind: "stroke", points: world.map((p) => p.slice()), x: 0, y: 0 };
      annotateItemIntoBox(item, mapBox);
      const back = projectItemFromBox(item, mapBox);
      expect(back.parent).toBe("geo1"); // projection is a COPY; parent clears on the real drag-out write
      back.points.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(world[i][0], 6);
        expect(p[1]).toBeCloseTo(world[i][1], 6);
        expect(p[2]).toBe(world[i][2]);
      });
    }
    bindMapInstance("geo1", null);
  });
  it("shape round-trips through a map, and through a rotated frame (rotation restored)", () => {
    bindMapInstance("geo1", fakeMap(9));
    const shape = { kind: "shape", type: "ellipse", x: 180, y: 90, w: 120, h: 90, rotation: 0 };
    const geo = annotateItemIntoBox({ ...shape }, mapBox);
    const back = projectItemFromBox(geo, mapBox);
    expect(back.x).toBeCloseTo(shape.x, 6); expect(back.y).toBeCloseTo(shape.y, 6);
    expect(back.w).toBeCloseTo(shape.w, 6); expect(back.h).toBeCloseTo(shape.h, 6);
    bindMapInstance("geo1", null);
    const frame = { id: "f2", kind: "frame", x: 10, y: 20, w: 300, h: 200, rotation: 45 };
    const inFrame = annotateItemIntoBox({ ...shape, rotation: 5 }, frame);
    const out = projectItemFromBox(inFrame, frame);
    expect(out.rotation).toBeCloseTo(5, 9);
    expect(out.x).toBeCloseTo(shape.x, 6); expect(out.y).toBeCloseTo(shape.y, 6);
  });
  it("without a live map binding the reproject kind is identity — projection never throws", () => {
    const item = { kind: "stroke", points: [[1, 2, 0.5]], x: 0, y: 0, parent: "geoGone" };
    const back = projectItemFromBox(item, { ...mapBox, id: "geoGone" });
    expect(back.points[0][0]).toBeCloseTo(101); // origin-only (identity own-transform)
    expect(back.points[0][1]).toBeCloseTo(52);
  });
});

describe("surfaceWithinBox — entering re-roots the claim over the whole subtree", () => {
  const itemsOf = (url) => ({
    "automerge:A": [{ kind: "frame", url: "automerge:B" }, { kind: "doc", url: "automerge:D" }],
    "automerge:B": [{ kind: "frame", url: "automerge:C" }],
  })[url] || null;
  const A = { kind: "frame", url: "automerge:A" };
  it("matches the box itself, and surfaces nested inside it", () => {
    expect(surfaceWithinBox(A, "automerge:A", itemsOf)).toBe(true);
    expect(surfaceWithinBox(A, "automerge:B", itemsOf)).toBe(true);  // one level in
    expect(surfaceWithinBox(A, "automerge:C", itemsOf)).toBe(true);  // two levels in
    expect(surfaceWithinBox(A, "automerge:elsewhere", itemsOf)).toBe(false);
    expect(surfaceWithinBox(A, "root", itemsOf)).toBe(false);
  });
  it("non-frame boxes (a map) never contain surfaces; missing loaders are safe", () => {
    expect(surfaceWithinBox({ kind: "editor", editorId: "map", id: "m" }, "anything", itemsOf)).toBe(false);
    expect(surfaceWithinBox(A, "automerge:B", null)).toBe(false);
    expect(surfaceWithinBox(null, "x", itemsOf)).toBe(false);
  });
});
