import { describe, expect, it } from "vitest";
import { attribute, diffCells, diffPages } from "../src/diff";
import type { Cell, GraphDoc } from "../src/model";

const vertex = (id: string, extra: Partial<Cell> = {}): Cell => ({
  id,
  value: id,
  style: "rounded=0;",
  parent: "1",
  vertex: true,
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  ...extra,
});
const edge = (id: string, source: string, target: string, style = "edgeStyle=orthogonalEdgeStyle;"): Cell => ({
  id,
  value: "",
  style,
  parent: "1",
  edge: true,
  source,
  target,
});

describe("diffCells", () => {
  it("says what was added, deleted, changed and moved, and leaves out what's the same", () => {
    const other = [vertex("same"), vertex("gone"), vertex("edited"), vertex("moved"), edge("e", "same", "edited")];
    const current = [
      vertex("same"),
      vertex("edited", { value: "edited, again" }),
      vertex("moved", { x: 40 }),
      edge("e", "same", "edited"),
      vertex("new"),
    ];
    expect(Object.fromEntries(diffCells(current, other))).toEqual({
      edited: "changed",
      moved: "moved",
      new: "added",
      gone: "deleted",
    });
  });

  it("counts rewiring and restyling as a change, re-anchoring and waypoints as a move", () => {
    const other = [
      edge("rewired", "a", "b"),
      edge("restyled", "a", "b"),
      edge("anchored", "a", "b"),
      { ...edge("bent", "a", "b"), points: [{ x: 1, y: 2 }] },
    ];
    const current = [
      edge("rewired", "a", "c"),
      edge("restyled", "a", "b", "edgeStyle=orthogonalEdgeStyle;dashed=1;"),
      edge("anchored", "a", "b", "edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;entryX=0;entryDx=0;"),
      { ...edge("bent", "a", "b"), points: [{ x: 5, y: 2 }] },
    ];
    expect(Object.fromEntries(diffCells(current, other))).toEqual({
      rewired: "changed",
      restyled: "changed",
      anchored: "moved",
      bent: "moved",
    });
  });

  it("ignores the order Automerge keeps keys in", () => {
    const a = vertex("v", { attrs: { one: "1", two: "2" } });
    const b = vertex("v", { attrs: { two: "2", one: "1" } });
    expect(diffCells([a], [b]).size).toBe(0);
  });
});

describe("diffPages", () => {
  const page = (id: string, name: string, cells: Cell[]) => ({ id, name, model: {}, cells });
  it("marks pages added, deleted, renamed or with changed cells", () => {
    const other: GraphDoc = {
      title: "g",
      diagrams: [page("same", "Same", [vertex("a")]), page("renamed", "Old", []), page("edited", "E", [vertex("a")]), page("gone", "Gone", [])],
    };
    const current: GraphDoc = {
      title: "g",
      diagrams: [page("same", "Same", [vertex("a")]), page("renamed", "New", []), page("edited", "E", [vertex("a", { y: 9 })]), page("new", "New", [])],
    };
    expect(Object.fromEntries(diffPages(current, other))).toEqual({
      renamed: "changed",
      edited: "changed",
      new: "added",
      gone: "deleted",
    });
  });
});

describe("attribute", () => {
  it("says which draft made a change, and what both did", () => {
    expect(attribute(undefined, undefined)).toBeUndefined();
    expect(attribute("added", undefined)).toEqual({ change: "added", by: "ours" });
    expect(attribute(undefined, "deleted")).toEqual({ change: "deleted", by: "theirs" });
    expect(attribute("moved", "moved")).toEqual({ change: "moved", by: "both" });
    expect(attribute("inside", "moved")).toEqual({ change: "moved", by: "both" });
    expect(attribute("changed", "deleted")).toEqual({ change: "changed", by: "both" });
  });
});
