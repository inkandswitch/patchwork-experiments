import { describe, it, expect } from "vitest";
import { makeStash, fromStash, stashCovers, STASH_MAX_TRIANGLES } from "./stash.js";
import { partsOf } from "./parts.js";

const tris = Float64Array.from({ length: 4 * 9 }, (_, i) => i * 0.25);
const ranges = [
  { name: "Hull", from: 0, to: 2 },
  { name: "Mast", from: 2, to: 3 },
  { name: "Hull", from: 3, to: 4 },
];
const parts = partsOf(tris, ranges);
const source = { url: "automerge:abc", heads: ["h2", "h1"], path: "source", providerId: "file-3dm", providerName: "Rhino 3DM file", title: "boat.3dm" };

describe("a stashed hull", () => {
  const doc = makeStash({ triangles: tris, ranges, parts, chosen: ["Hull"], source, now: 5 });
  it("keeps only the chosen parts' triangles, in order, and every part's summary", () => {
    expect(doc.chosen).toEqual(["Hull"]);
    expect(doc.ranges).toEqual([
      { name: "Hull", from: 0, to: 2 },
      { name: "Hull", from: 2, to: 3 },
    ]);
    expect(doc.parts.map((p) => p.name)).toEqual(["Hull", "Mast"]);
    expect(doc.triangles.byteLength).toBe(3 * 9 * 4);
    expect(doc.source.heads).toEqual(["h1", "h2"]);
  });
  it("reads back as the model would have been read, to float32", () => {
    const r = fromStash(doc);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("stash");
    expect(r.kept).toEqual(["Hull"]);
    // the first two triangles, then the fourth
    const want = [...tris.subarray(0, 18), ...tris.subarray(27, 36)];
    expect(Array.from(r.triangles)).toEqual(want.map((v) => Math.fround(v)));
    expect(r.parts).toHaveLength(2);
  });
  it("says which selections it can serve", () => {
    expect(stashCovers(["Hull"], ["Hull"])).toBe(true);
    expect(stashCovers(["Hull"], [])).toBe(true);
    expect(stashCovers(["Hull"], ["Hull", "Mast"])).toBe(false);
  });
  it("refuses a hull too big to keep, and a doc that isn't a stash", () => {
    const huge = [{ name: "Hull", from: 0, to: STASH_MAX_TRIANGLES + 1 }];
    expect(makeStash({ triangles: tris, ranges: huge, parts, chosen: ["Hull"], source, now: 1 })).toBe(null);
    expect(fromStash({ "@patchwork": { type: "file" } })).toBe(null);
    expect(fromStash({ ...doc, version: 999 })).toBe(null);
  });
});
