import { describe, it, expect } from "vitest";
import {
  rot, isBoxType, localToWorld, worldToLocal, pointInFrame,
  itemBounds, cloneItem, linksNeedingItems, itemPresent, shouldUnlinkDoc,
  edgePoint, edgeMidpoint, arrowGeometry, anchorWorld, worldAnchor, portPoint,
} from "./model.js";

describe("isBoxType", () => {
  it("treats folders and sketches (both datatype ids) as boxes, nothing else", () => {
    expect(isBoxType("folder")).toBe(true);
    expect(isBoxType("newspace")).toBe(true); // the legacy datatype id
    expect(isBoxType("sketch")).toBe(true); // the CURRENT datatype id — a placed Sketch is a frame sub-space
    expect(isBoxType("essay")).toBe(false);
    expect(isBoxType("")).toBe(false);
    expect(isBoxType(undefined)).toBe(false);
  });
});

describe("coordinate transforms", () => {
  it("are the identity with no frame", () => {
    expect(localToWorld(null, 5, 7)).toEqual([5, 7]);
    expect(worldToLocal(null, 5, 7)).toEqual([5, 7]);
  });

  it("local<->world round-trips for an unrotated frame (a pure translation)", () => {
    const frame = { x: 100, y: 50, w: 200, h: 120, rotation: 0 };
    const [wx, wy] = localToWorld(frame, 10, 20);
    expect([wx, wy]).toEqual([110, 70]);
    const [lx, ly] = worldToLocal(frame, wx, wy);
    expect(lx).toBeCloseTo(10);
    expect(ly).toBeCloseTo(20);
  });

  it("local<->world round-trips for a rotated frame", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 37 };
    const [wx, wy] = localToWorld(frame, 30, 80);
    const [lx, ly] = worldToLocal(frame, wx, wy);
    expect(lx).toBeCloseTo(30, 6);
    expect(ly).toBeCloseTo(80, 6);
  });

  it("rotates a vector", () => {
    const [x, y] = rot(1, 0, Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });

  it("pointInFrame respects the rotated bounds", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    expect(pointInFrame(frame, 50, 50)).toBe(true);
    expect(pointInFrame(frame, 150, 50)).toBe(false);
    expect(pointInFrame(frame, -1, 50)).toBe(false);
  });
});

describe("itemBounds", () => {
  it("returns x/y/w/h for doc and frame items", () => {
    expect(itemBounds({ kind: "doc", x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(itemBounds({ kind: "frame", x: 5, y: 6, w: 7, h: 8 })).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });
});

describe("cloneItem", () => {
  it("deep-copies a stroke's points and drops parent", () => {
    const o = { id: "a", kind: "stroke", points: [[1, 2, 0.5], [3, 4, 0.5]], parent: "frame1" };
    const c = cloneItem(o);
    expect(c.parent).toBeUndefined();
    expect(c.points).toEqual(o.points);
    c.points[0][0] = 999;
    expect(o.points[0][0]).toBe(1); // original untouched
  });

  it("shallow-copies a doc item without a url collision", () => {
    const o = { id: "d", kind: "doc", url: "automerge:x", x: 0, y: 0, w: 10, h: 10 };
    expect(cloneItem(o)).toEqual({ id: "d", kind: "doc", url: "automerge:x", x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("linksNeedingItems (docs -> items reconcile)", () => {
  const docs = [{ url: "a", type: "essay" }, { url: "b", type: "folder" }];

  it("returns links that have no shape yet", () => {
    const items = [{ kind: "doc", url: "a" }];
    expect(linksNeedingItems(docs, items).map((l) => l.url)).toEqual(["b"]);
  });

  it("returns nothing when every link already has a shape", () => {
    const items = [{ kind: "doc", url: "a" }, { kind: "frame", url: "b" }];
    expect(linksNeedingItems(docs, items)).toEqual([]);
  });

  it("never recreates a tombstoned (just-deleted) url", () => {
    const items = []; // both shapes gone
    const tombstoned = (u) => u === "a";
    // 'a' is tombstoned so must NOT come back; 'b' still needs a shape
    expect(linksNeedingItems(docs, items, tombstoned).map((l) => l.url)).toEqual(["b"]);
  });

  it("ignores non-doc/frame items when checking presence", () => {
    const items = [{ kind: "stroke", url: undefined }, { kind: "shape" }];
    // a stroke without a url must not satisfy any link
    expect(linksNeedingItems(docs, items).map((l) => l.url)).toEqual(["a", "b"]);
  });
});

describe("itemPresent (transfer dst-add guard)", () => {
  it("dedupes by id, NOT by url", () => {
    // the regression: a url-less stroke must not collide with another url-less item
    const items = [{ id: "s1", kind: "stroke" }, { id: "r1", kind: "shape" }];
    expect(itemPresent(items, "s2")).toBe(false); // a different stroke can be added
    expect(itemPresent(items, "s1")).toBe(true); // the same id is already present
  });
});

describe("edgePoint / arrowGeometry (arrow bindings)", () => {
  const box = { x: 0, y: 0, w: 100, h: 100 }; // centre (50,50)

  it("edgePoint exits the box toward the target", () => {
    expect(edgePoint(box, 200, 50)).toEqual([100, 50]); // straight right → right edge
    expect(edgePoint(box, 50, -50)).toEqual([50, 0]);    // straight up → top edge
  });

  it("anchorWorld places a normalized anchor on the shape (unrotated)", () => {
    const item = { kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };
    expect(anchorWorld(item, { x: 0.5, y: 0.5 })).toEqual([50, 50]); // centre
    expect(anchorWorld(item, { x: 1, y: 0 })).toEqual([100, 0]); // top-right corner
  });

  it("anchorWorld honours rotation, and worldAnchor inverts it", () => {
    const item = { kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100, rotation: 90 };
    const [wx, wy] = anchorWorld(item, { x: 1, y: 0.5 }); // right-edge midpoint, rotated 90°
    expect(wx).toBeCloseTo(50, 5);
    expect(wy).toBeCloseTo(100, 5);
    const a = worldAnchor(item, wx, wy);
    expect(a.x).toBeCloseTo(1, 5);
    expect(a.y).toBeCloseTo(0.5, 5);
  });

  it("an anchored arrow tracks the shape's anchor point", () => {
    const box = { id: "b", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };
    const arrow = { kind: "shape", type: "arrow", x: 0, y: 0, w: 0, h: 0, toId: "b", toAnchor: { x: 0.5, y: 0 } };
    const g = arrowGeometry(arrow, [box, arrow]);
    expect([g.x + g.w, g.y + g.h]).toEqual([50, 0]); // top edge midpoint
  });

  it("edgeMidpoint snaps to the middle of the facing edge, outside the box", () => {
    expect(edgeMidpoint(box, 500, 60, 7)).toEqual([107, 50]); // mostly-right → right edge mid + gap
    expect(edgeMidpoint(box, 50, -500, 7)).toEqual([50, -7]); // straight up → top edge mid + gap
  });

  it("falls back to stored coords when nothing is bound", () => {
    const arrow = { kind: "shape", type: "arrow", x: 5, y: 6, w: 10, h: 12 };
    expect(arrowGeometry(arrow, [])).toEqual({ x: 5, y: 6, w: 10, h: 12 });
  });

  it("connects two bound shapes at facing edge midpoints (with a gap)", () => {
    const from = { id: "a", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };   // centre 50,50
    const to = { id: "b", kind: "shape", type: "rectangle", x: 200, y: 0, w: 100, h: 100 };    // centre 250,50
    const arrow = { kind: "shape", type: "arrow", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" };
    const g = arrowGeometry(arrow, [from, to, arrow]);
    expect(g.x).toBeCloseTo(107); // right edge midpoint of `from` + 7px gap
    expect(g.x + g.w).toBeCloseTo(193); // left edge midpoint of `to` - 7px gap
    expect(g.y).toBeCloseTo(50); // both midpoints are vertically centred
  });

  it("binds just one end, keeping the free end put", () => {
    const from = { id: "a", kind: "shape", type: "rectangle", x: 0, y: 0, w: 100, h: 100 };
    const arrow = { kind: "shape", type: "arrow", x: 50, y: 50, w: 250, h: 0, fromId: "a" };
    const g = arrowGeometry(arrow, [from, arrow]);
    expect(g.x).toBeCloseTo(107);        // start snapped to right edge midpoint + gap
    expect(g.x + g.w).toBeCloseTo(300);  // free end unchanged
  });
});

describe("shouldUnlinkDoc (alt-drag shared-doc deletion)", () => {
  it("unlinks when deleting the only shape for a url", () => {
    const items = [{ id: "a", kind: "doc", url: "u1" }];
    expect(shouldUnlinkDoc(items, "u1", ["a"])).toBe(true);
  });

  it("keeps the link when another copy still references the url", () => {
    // two shapes (alt-drag copy) point at one doc; deleting one must NOT unlink
    const items = [{ id: "a", kind: "doc", url: "u1" }, { id: "b", kind: "doc", url: "u1" }];
    expect(shouldUnlinkDoc(items, "u1", ["a"])).toBe(false);
  });

  it("unlinks when deleting the last remaining copies together", () => {
    const items = [{ id: "a", kind: "doc", url: "u1" }, { id: "b", kind: "doc", url: "u1" }];
    expect(shouldUnlinkDoc(items, "u1", ["a", "b"])).toBe(true);
    expect(shouldUnlinkDoc(items, "u1", new Set(["a", "b"]))).toBe(true); // accepts a Set too
  });

  it("treats a frame copy as a reference to the same url", () => {
    const items = [{ id: "a", kind: "doc", url: "u1" }, { id: "b", kind: "frame", url: "u1" }];
    expect(shouldUnlinkDoc(items, "u1", ["a"])).toBe(false);
  });

  it("ignores strokes/shapes that happen to carry no url", () => {
    const items = [{ id: "a", kind: "doc", url: "u1" }, { id: "s", kind: "stroke" }];
    expect(shouldUnlinkDoc(items, "u1", ["a"])).toBe(true);
  });
});

describe("portPoint (wire endpoints from bounds, not the DOM)", () => {
  const b = { x: 100, y: 100, w: 200, h: 100 }; // centre y = 150

  it("a single inlet sits at the left-edge mid; a single outlet at the right-edge mid", () => {
    expect(portPoint(b, "in", 0, 1)).toEqual({ x: 100, y: 150 });
    expect(portPoint(b, "out", 0, 1)).toEqual({ x: 300, y: 150 });
  });

  it("two ports straddle the centre by the CSS pitch (20px between centres)", () => {
    const a = portPoint(b, "in", 0, 2);
    const c = portPoint(b, "in", 1, 2);
    expect(a.x).toBe(100); expect(c.x).toBe(100);
    expect(a.y).toBe(140); expect(c.y).toBe(160); // ±10 around 150
  });

  it("the gap caps at 20 even for a tall box (ports cluster near centre, never spill)", () => {
    const tall = { x: 0, y: 0, w: 10, h: 1000 };
    const lo = portPoint(tall, "in", 0, 2), hi = portPoint(tall, "in", 1, 2);
    expect(hi.y - lo.y).toBe(20); // not 1000/3
  });

  it("defaults to a single centred port", () => {
    expect(portPoint(b, "in")).toEqual({ x: 100, y: 150 });
  });
});
