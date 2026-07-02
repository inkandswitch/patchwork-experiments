// Item-4: rough.js port nubs. The nub drawing must be DETERMINISTIC per
// (item id, port name) — same seed ⇒ identical paths across renders (no
// reshuffling), different ports ⇒ different scribbles.
import { describe, it, expect } from "vitest";
import { nubSeed, nubPaths } from "./brush/ui/chrome.jsx";

describe("port nub seeds", () => {
  it("is deterministic for the same item + port", () => {
    expect(nubSeed("ed-1", "in")).toBe(nubSeed("ed-1", "in"));
  });
  it("differs across ports and across items", () => {
    expect(nubSeed("ed-1", "in")).not.toBe(nubSeed("ed-1", "out"));
    expect(nubSeed("ed-1", "in")).not.toBe(nubSeed("ed-2", "in"));
  });
  it("never returns a zero/falsy seed (rough.js treats 0 as unseeded)", () => {
    expect(nubSeed("", "")).toBeTruthy();
  });
});

describe("nub paths", () => {
  it("same seed ⇒ identical rough paths (stable across renders)", () => {
    const a = nubPaths(nubSeed("ed-1", "in"), false);
    const b = nubPaths(nubSeed("ed-1", "in"), false);
    expect(a.map((p) => p.d)).toEqual(b.map((p) => p.d));
    const da = nubPaths(nubSeed("ed-1", "in"), true);
    const db = nubPaths(nubSeed("ed-1", "in"), true);
    expect(da.map((p) => p.d)).toEqual(db.map((p) => p.d));
  });
  it("different seeds ⇒ different scribbles", () => {
    const a = nubPaths(nubSeed("ed-1", "in"), false);
    const b = nubPaths(nubSeed("ed-1", "out"), false);
    expect(a.map((p) => p.d)).not.toEqual(b.map((p) => p.d));
  });
  it("circle vs diamond are distinct drawings", () => {
    const seed = nubSeed("ed-1", "in");
    expect(nubPaths(seed, false).map((p) => p.d)).not.toEqual(nubPaths(seed, true).map((p) => p.d));
  });
  it("paths are non-empty and svg-renderable", () => {
    for (const bidi of [false, true]) {
      const ps = nubPaths(7, bidi);
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) expect(p.d).toMatch(/^M/);
    }
  });
});
