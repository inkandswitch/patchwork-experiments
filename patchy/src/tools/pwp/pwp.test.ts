import { describe, expect, it } from "vitest";
import type { PatchEntry } from "../../layers/index.js";

import { emptyGrid, nearest, parseColour, quantize, syncEntries } from "./raster.js";
import { bounds, dragBox, fitTo, fromClip, thin, toClip, translate, type Shape } from "./shapes.js";

const grid = (width: number, height: number, set: [number, number, number][]) => {
  const g = emptyGrid(width, height);
  for (const [x, y, v] of set) g.cells[y * width + x] = v;
  return g;
};

describe("syncEntries", () => {
  it("puts one run per covered stretch of a row, and nothing for the rest", () => {
    const patches: PatchEntry[] = [];
    expect(syncEntries(patches, grid(5, 2, [[0, 0, 1], [1, 0, 2], [3, 0, 1], [2, 1, 3]]))).toBe(true);
    expect(patches).toEqual([
      { path: ["pixels", 0, 0], values: [1, 2] },
      { path: ["pixels", 0, 3], values: [1] },
      { path: ["pixels", 1, 2], values: [3] },
    ]);
  });

  it("leaves runs that are already right alone", () => {
    const patches: PatchEntry[] = [];
    syncEntries(patches, grid(5, 2, [[0, 0, 1], [1, 0, 1], [0, 1, 2]]));
    const kept = patches[0];
    expect(syncEntries(patches, grid(5, 2, [[0, 0, 1], [1, 0, 1], [0, 1, 3], [1, 1, 3]]))).toBe(true);
    expect(patches[0]).toBe(kept);
    expect(patches).toEqual([
      { path: ["pixels", 0, 0], values: [1, 1] },
      { path: ["pixels", 1, 0], values: [3, 3] },
    ]);
  });

  it("says nothing changed when nothing did", () => {
    const patches: PatchEntry[] = [];
    const g = grid(2, 2, [[1, 1, 0]]);
    syncEntries(patches, g);
    expect(syncEntries(patches, g)).toBe(false);
  });

  it("drops runs no longer covered, and leaves other entries alone", () => {
    const other: PatchEntry = { path: ["title"], value: "hi" };
    const patches: PatchEntry[] = [other];
    syncEntries(patches, grid(3, 1, [[0, 0, 1], [2, 0, 1]]));
    syncEntries(patches, grid(3, 1, [[2, 0, 1]]));
    expect(patches).toEqual([other, { path: ["pixels", 0, 2], values: [1] }]);
  });

  it("turns single-pixel puts from older layers into runs", () => {
    const patches: PatchEntry[] = [
      { path: ["pixels", 0, 0], value: 2 },
      { path: ["pixels", 0, 1], value: 2 },
    ];
    syncEntries(patches, grid(2, 1, [[0, 0, 2], [1, 0, 2]]));
    expect(patches).toEqual([{ path: ["pixels", 0, 0], values: [2, 2] }]);
  });
});

describe("colours", () => {
  it("reads hex in long and short forms", () => {
    expect(parseColour("#e07a5f")).toEqual([0xe0, 0x7a, 0x5f]);
    expect(parseColour("#fff")).toEqual([255, 255, 255]);
  });

  it("finds the nearest palette colour", () => {
    const palette = ["#000000", "#ffffff", "#ff0000"].map(parseColour);
    expect(nearest(palette, 250, 240, 245)).toBe(1);
    expect(nearest(palette, 200, 30, 20)).toBe(2);
  });

  it("leaves mostly transparent pixels out", () => {
    const palette = ["#000000", "#ffffff"].map(parseColour);
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 40]);
    expect([...quantize(rgba, 2, 1, palette, false)]).toEqual([1, -1]);
  });

  it("dithers mid grey into a mix of black and white", () => {
    const palette = ["#000000", "#ffffff"].map(parseColour);
    const n = 8;
    const rgba = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) rgba.set([128, 128, 128, 255], i * 4);
    const flat = [...quantize(rgba, n, n, palette, false)];
    const dithered = [...quantize(rgba, n, n, palette, true)];
    expect(new Set(flat).size).toBe(1);
    const white = dithered.filter((v) => v === 1).length;
    expect(white).toBeGreaterThan(n * n * 0.35);
    expect(white).toBeLessThan(n * n * 0.65);
  });
});

describe("shapes", () => {
  const rect: Shape = { id: "r", kind: "rect", x: 2, y: 3, w: 4, h: 5, color: 1, fill: true, stroke: 1 };
  const line: Shape = { id: "l", kind: "line", points: [1, 1, 5, 3], color: 1, stroke: 1 };

  it("bounds strokes by their points", () => {
    expect(bounds(line)).toEqual({ x: 1, y: 1, w: 4, h: 2 });
  });

  it("moves boxes and points alike", () => {
    expect(bounds(translate(rect, 1, -1))).toEqual({ x: 3, y: 2, w: 4, h: 5 });
    expect(translate(line, 2, 1)).toMatchObject({ points: [3, 2, 7, 4] });
  });

  it("flips a box dragged through itself", () => {
    const r = dragBox({ x: 0, y: 0, w: 4, h: 4 }, [1, 0], -6, 0);
    expect(r).toEqual({ box: { x: -2, y: 0, w: 2, h: 4 }, flipX: true, flipY: false });
  });

  it("stretches strokes into a new box, mirrored when flipped", () => {
    const to = { x: 0, y: 0, w: 8, h: 4 };
    expect(fitTo(line, to)).toMatchObject({ points: [0, 0, 8, 4] });
    expect(fitTo(line, to, true)).toMatchObject({ points: [8, 0, 0, 4] });
  });

  it("thins a pen stroke but keeps its ends", () => {
    const points = [0, 0, 0.1, 0, 0.2, 0, 1, 0, 1.05, 0];
    expect(thin(points)).toEqual([0, 0, 1, 0, 1.05, 0]);
  });
});

describe("clipboard", () => {
  it("round-trips shapes, pictures' bytes and all, under new ids", () => {
    const rect: Shape = { id: "r", kind: "rect", x: 1, y: 2, w: 3, h: 4, color: 2, fill: false, stroke: 2 };
    const pic: Shape = {
      id: "p", kind: "picture", x: 0, y: 0, w: 5, h: 5,
      bytes: new Uint8Array([0, 1, 254, 255]), mime: "image/png", dither: true,
    };
    const back = fromClip(toClip([rect, pic]));
    expect(back.map((s) => s.id)).not.toContain("r");
    expect(back[0]).toEqual({ ...rect, id: back[0].id });
    expect(back[1]).toEqual({ ...pic, id: back[1].id });
  });

  it("ignores text that isn't pwp's", () => {
    expect(fromClip("hello")).toEqual([]);
    expect(fromClip('{"shapes": []}')).toEqual([]);
  });
});
