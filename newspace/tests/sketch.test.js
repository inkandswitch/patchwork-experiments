import { describe, it, expect } from "vitest";
import { relax, sketchBounds, nodeCopies, barCopies, mergeNodes, unsnapNode, splitBarAt, weldCrossings } from "../src/sketch.js";
import { addBar } from "../src/constraint.js";

// a deterministic id generator for tests
function counter() { let i = 0; return () => `id${i++}`; }
const brush = { color: "line", size: 2 };
const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

describe("relax", () => {
  it("restores a bar to its rest length, holding fixed/pinned ends", () => {
    const nodes = [{ id: "a", x: 0, y: 0, fixed: true }, { id: "b", x: 130, y: 0, fixed: false }];
    const bars = [{ a: "a", b: "b", len: 100 }];
    relax(nodes, bars, new Set(), 80);
    expect(nodes[0].x).toBe(0); // fixed end stays
    expect(len(nodes[0], nodes[1])).toBeCloseTo(100, 3);
  });

  it("a bar–pivot–bar arm with a fixed centre swings RIGIDLY (scissors)", () => {
    // straight arm h(-50,0) — m(0,0) fixed — t(50,0). DRAG h along a quarter
    // circle to (0,-50) the way a pointer does — incrementally — and the far
    // tip t should swing rigidly to the opposite side, (0,+50).
    const nodes = [{ id: "h", x: -50, y: 0 }, { id: "m", x: 0, y: 0, fixed: true }, { id: "t", x: 50, y: 0 }];
    const bars = [{ a: "h", b: "m", len: 50 }, { a: "m", b: "t", len: 50 }];
    const steps = 30;
    for (let s = 1; s <= steps; s++) {
      const ang = Math.PI + (s / steps) * (Math.PI / 2); // 180° → 270°
      nodes[0].x = 50 * Math.cos(ang); nodes[0].y = 50 * Math.sin(ang); // pointer pins h
      relax(nodes, bars, new Set(["h"]), 60);
    }
    expect(nodes[1].x).toBe(0); expect(nodes[1].y).toBe(0); // pivot held
    expect(nodes[2].x).toBeCloseTo(0, 1);
    expect(nodes[2].y).toBeCloseTo(50, 1); // opposite the dragged tip
  });

  it("does NOT straighten a fixed triangle corner (stays a triangle)", () => {
    // right triangle; fix the right-angle corner m. neighbours h,t are joined
    // (h–t bar) so it must NOT flatten.
    const nodes = [{ id: "h", x: 60, y: 0 }, { id: "m", x: 0, y: 0, fixed: true }, { id: "t", x: 0, y: 80 }];
    const bars = [{ a: "h", b: "m", len: 60 }, { a: "m", b: "t", len: 80 }, { a: "h", b: "t", len: 100 }];
    relax(nodes, bars, new Set(), 100);
    expect(nodes[0].x).toBeCloseTo(60, 1); expect(nodes[0].y).toBeCloseTo(0, 1);
    expect(nodes[2].x).toBeCloseTo(0, 1); expect(nodes[2].y).toBeCloseTo(80, 1);
  });

  it("articulates a two-bar linkage about a fixed pivot when a node is pinned", () => {
    // pivot p fixed; bar p-q rigid (len 100). drag q far away, pinned → length holds
    const nodes = [{ id: "p", x: 0, y: 0, fixed: true }, { id: "q", x: 100, y: 0 }];
    const bars = [{ a: "p", b: "q", len: 100 }];
    nodes[1].x = 300; nodes[1].y = 300; // "dragged"
    relax(nodes, bars, new Set(["q"]), 80);
    expect(nodes[0].x).toBe(0); expect(nodes[0].y).toBe(0); // pivot held
    expect(nodes[1].x).toBe(300); expect(nodes[1].y).toBe(300); // pinned end held
  });
});

describe("addBar", () => {
  it("two free points create a new sketch with two nodes and one bar", () => {
    const items = [];
    addBar(items, { x: 0, y: 0 }, { x: 100, y: 0 }, brush, counter());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("sketch");
    expect(items[0].nodes).toHaveLength(2);
    expect(items[0].bars).toHaveLength(1);
    expect(items[0].bars[0].len).toBeCloseTo(100, 3);
  });

  it("starting on an existing node shares the pivot (adds 1 node + 1 bar)", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: 0, y: 0 }, { x: 100, y: 0 }, brush, uid);
    const s = items[0];
    const shared = s.nodes[1]; // the (100,0) node
    addBar(items, { x: shared.x, y: shared.y, sketchId: s.id, nodeId: shared.id }, { x: 100, y: 100 }, brush, uid);
    expect(items).toHaveLength(1); // still one sketch
    expect(s.nodes).toHaveLength(3); // one new node
    expect(s.bars).toHaveLength(2);
    // the new bar connects to the shared node
    expect(s.bars[1].a === shared.id || s.bars[1].b === shared.id).toBe(true);
  });

  it("both ends on the same sketch closes a loop (adds a bar, no node)", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: 0, y: 0 }, { x: 100, y: 0 }, brush, uid);
    const s = items[0];
    addBar(items, { x: 100, y: 0, sketchId: s.id, nodeId: s.nodes[1].id }, { x: 0, y: 100 }, brush, uid);
    // now connect the two free ends → triangle
    addBar(items, { x: 0, y: 0, sketchId: s.id, nodeId: s.nodes[0].id }, { x: 0, y: 100, sketchId: s.id, nodeId: s.nodes[2].id }, brush, uid);
    expect(s.nodes).toHaveLength(3);
    expect(s.bars).toHaveLength(3); // closed triangle, no extra node
  });

  it("landing on the middle of a bar splits it and shares the new pivot (scissors)", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: 0, y: 0 }, { x: 100, y: 0 }, brush, uid); // one bar
    const s = items[0];
    // start a new bar from the MIDDLE of that bar (a split), end free
    addBar(items, { x: 50, y: 0, sketchId: s.id, splitBar: { na: s.nodes[0].id, nb: s.nodes[1].id } }, { x: 50, y: 50 }, brush, uid);
    expect(items).toHaveLength(1);
    expect(s.nodes).toHaveLength(4); // n0, n1, the split pivot, the free end
    expect(s.bars).toHaveLength(3); // n0–m, m–n1, m–end
    // the split pivot is the one wired to three bars
    const counts = new Map();
    for (const bar of s.bars) { counts.set(bar.a, (counts.get(bar.a) || 0) + 1); counts.set(bar.b, (counts.get(bar.b) || 0) + 1); }
    expect(Math.max(...counts.values())).toBe(3);
  });

  it("ends on different sketches merge them into one", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: 0, y: 0 }, { x: 50, y: 0 }, brush, uid);
    addBar(items, { x: 200, y: 0 }, { x: 250, y: 0 }, brush, uid);
    expect(items).toHaveLength(2);
    const s1 = items[0], s2 = items[1];
    addBar(items, { x: 50, y: 0, sketchId: s1.id, nodeId: s1.nodes[1].id }, { x: 200, y: 0, sketchId: s2.id, nodeId: s2.nodes[0].id }, brush, uid);
    expect(items).toHaveLength(1); // merged
    expect(items[0].nodes).toHaveLength(4);
    expect(items[0].bars).toHaveLength(3); // 1 + 1 + connecting
  });
});

describe("mergeNodes (snap points together)", () => {
  it("folds one node into another, rewiring its bars", () => {
    const s = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], bars: [{ id: "1", a: "a", b: "b", len: 10 }, { id: "2", a: "c", b: "d", len: 10 }] };
    mergeNodes(s, "a", "c"); // drop c onto a — no duplicate (a–b, a–d)
    expect(s.nodes.map((n) => n.id)).toEqual(["a", "b", "d"]);
    expect(s.bars).toHaveLength(2);
    expect(s.bars.every((bar) => bar.a !== "c" && bar.b !== "c")).toBe(true);
  });
  it("drops the self-loop and duplicate a merge creates", () => {
    // a–b and b–c; merging a onto c makes c–b twice and would loop if a–c existed
    const s = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], bars: [{ id: "1", a: "a", b: "b", len: 10 }, { id: "2", a: "b", b: "c", len: 10 }] };
    mergeNodes(s, "c", "a"); // a→c: now c–b and b–c (duplicate)
    expect(s.bars).toHaveLength(1); // duplicate removed
    expect(s.nodes.map((n) => n.id)).toEqual(["b", "c"]);
  });
});

describe("unsnapNode / splitBarAt", () => {
  it("unsnap separates a junction's bars onto fresh fanned points", () => {
    const uid = counter();
    const s = { nodes: [{ id: "m", x: 0, y: 0, fixed: true }, { id: "p", x: 50, y: 0 }, { id: "q", x: -50, y: 0 }], bars: [{ id: "1", a: "m", b: "p", len: 50 }, { id: "2", a: "m", b: "q", len: 50 }] };
    unsnapNode(s, "m", uid);
    expect(s.nodes).toHaveLength(4); // m kept on bar 1; bar 2 gets a fresh point
    expect(s.nodes.find((n) => n.id === "m").fixed).toBe(false);
    // every bar still has two distinct endpoints
    expect(s.bars.every((b) => b.a !== b.b)).toBe(true);
  });
  it("splitBarAt inserts a pinned pivot and replaces the bar with two halves", () => {
    const uid = counter();
    const s = { nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 100, y: 0 }], bars: [{ id: "1", a: "A", b: "B", len: 100 }] };
    const mid = splitBarAt(s, "1", 50, 0, uid, true);
    expect(s.nodes).toHaveLength(3);
    expect(s.nodes.find((n) => n.id === mid).fixed).toBe(true);
    expect(s.bars).toHaveLength(2);
    expect(s.bars[0].len + s.bars[1].len).toBeCloseTo(100, 3);
  });
});

describe("weldCrossings (draw two crossing lines → scissors)", () => {
  it("welds two crossing bars from separate sketches into one pinned X", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: -50, y: -50 }, { x: 50, y: 50 }, brush, uid);  // arm A
    addBar(items, { x: 50, y: -50 }, { x: -50, y: 50 }, brush, uid);  // arm B crosses it
    expect(items).toHaveLength(1); // merged into one sketch
    const s = items[0];
    expect(s.nodes).toHaveLength(5); // 4 tips + the welded pivot
    expect(s.bars).toHaveLength(4); // each arm split in two at the pivot
    const pivot = s.nodes.find((n) => n.fixed);
    expect(pivot).toBeTruthy();
    expect(pivot.x).toBeCloseTo(0, 6); expect(pivot.y).toBeCloseTo(0, 6);
  });

  it("the welded X articulates rigidly — drag a tip, its arm swings, the pivot holds", () => {
    const items = [];
    const uid = counter();
    addBar(items, { x: -50, y: 0 }, { x: 50, y: 0 }, brush, uid);    // horizontal arm
    addBar(items, { x: 0, y: -50 }, { x: 0, y: 50 }, brush, uid);    // vertical arm, crosses at origin
    const s = items[0];
    const pivotId = s.nodes.find((n) => n.fixed).id;
    const near = (n, x, y) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6;
    const tipId = s.nodes.find((n) => near(n, -50, 0)).id;
    const oppId = s.nodes.find((n) => near(n, 50, 0)).id;
    // swing the left tip down along an arc (the way the SketchItem drives relax)
    for (let k = 1; k <= 20; k++) {
      const ang = Math.PI + (k / 20) * (Math.PI / 4); // 180° → 225°
      const nodes = nodeCopies(s);
      const dn = nodes.find((n) => n.id === tipId);
      dn.x = 50 * Math.cos(ang); dn.y = 50 * Math.sin(ang);
      relax(nodes, barCopies(s), new Set([tipId]), 60);
      for (let i = 0; i < s.nodes.length; i++) { s.nodes[i].x = nodes[i].x; s.nodes[i].y = nodes[i].y; }
    }
    const pivot = s.nodes.find((n) => n.id === pivotId), opp = s.nodes.find((n) => n.id === oppId);
    expect(pivot.x).toBeCloseTo(0, 1); expect(pivot.y).toBeCloseTo(0, 1); // pivot held
    expect(opp.y).toBeGreaterThan(5); // opposite tip swung the other way (rigid arm)
  });
});

describe("sketchBounds", () => {
  it("wraps the nodes with padding", () => {
    const s = { nodes: [{ x: 0, y: 0 }, { x: 100, y: 40 }], strokeWidth: 2 };
    const b = sketchBounds(s);
    expect(b.x).toBeLessThan(0);
    expect(b.w).toBeGreaterThan(100);
    expect(b.h).toBeGreaterThan(40);
  });
});
