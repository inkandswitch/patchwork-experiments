import { describe, it, expect } from "vitest";
import { defaultSnapRadius, placeConnector, sanitizeConnectors, yawOfEuler } from "./connectors.js";
import { composeMatrix, multiplyMatrices } from "./transform.js";

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
import { axesOf } from "../test/connector-cases.js";

describe("connectors", () => {
  it("keeps finite bare [x, y, z] and { position, yaw } connectors, drops the rest", () => {
    expect(sanitizeConnectors([[1, 2, 3], { position: [4, 5, 6], yaw: Math.PI }, { position: [7, 8, 9], yaw: "x" }, [1, 2], ["a", 0, 0], null, [0, 0, Infinity]])).toEqual([
      { position: [1, 2, 3], rotation: null, yaw: null, tags: [] },
      { position: [4, 5, 6], rotation: null, yaw: Math.PI, tags: [] },
      { position: [7, 8, 9], rotation: null, yaw: null, tags: [] },
    ]);
    expect(sanitizeConnectors("nope")).toEqual([]);
  });

  it("a connector's rotation is kept whole and gives the yaw a piece set down there faces; its tags say what it takes", () => {
    const [a, b, c, d] = sanitizeConnectors([
      { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], tags: ["Meeple", "", 3] },
      { position: [0, 0, 0], rotation: [Math.PI, 0, 0] }, // +Z turned to -Z, upside down
      { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0] }, // +Z pointing straight up: no yaw
      { position: [0, 0, 0], rotation: ["x", 0, 0], yaw: 1 }, // a bad rotation falls back to the yaw
    ]);
    expect(a.rotation).toEqual([0, Math.PI / 2, 0]);
    expect(a.yaw).toBeCloseTo(Math.PI / 2);
    expect(a.tags).toEqual(["Meeple"]);
    expect(Math.abs(b.yaw)).toBeCloseTo(Math.PI);
    expect(c.yaw).toBeNull();
    expect(c.rotation).toEqual([-Math.PI / 2, 0, 0]);
    expect(d.rotation).toBeNull();
    expect(d.yaw).toBe(1);
    expect(sanitizeConnectors([{ position: [0, 0, 0], rotation: ["1", 2, 3, 4], yaw: 9 }])[0]).toEqual({ position: [0, 0, 0], rotation: [1, 2, 3], yaw: yawOfEuler([1, 2, 3]), tags: [] }); // one source: a rotation's yaw, never the one beside it
    expect(yawOfEuler([0.3, 0, 0])).toBeCloseTo(0); // a tilt doesn't turn it
  });

  const close = (a, b) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 1e-9);

  // a node under a parent stretched unevenly: its columns are skewed, so they are no rotation even made unit
  it("on a node a stretched parent skews, a frame stays a rotation: its up carried, its facing squared to it", () => {
    const parent = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // stretched 2 along X
    const node = multiplyMatrices(parent, composeMatrix({ rotation: [0, Math.PI / 4, 0] })); // turned an eighth inside it
    const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    for (const rotation of [[0, 0, 0], [Math.PI / 2, Math.PI / 2, 0], [0.3, 0.2, 0.1]]) {
      const c = composeMatrix({ rotation });
      const placed = placeConnector({ position: [0, 0, 0], rotation, tags: [] }, node);
      const [x, y, z] = axesOf(composeMatrix({ rotation: placed.rotation }));
      // the up as drawn: the connector's Y through the node's columns made unit
      const cols = [0, 1, 2].map((k) => n([node[4 * k], node[4 * k + 1], node[4 * k + 2]]));
      const up = n([0, 1, 2].map((r) => cols[0][r] * c[4] + cols[1][r] * c[5] + cols[2][r] * c[6]));
      expect(close(y, up)).toBe(true);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.abs(dot(x, y)) + Math.abs(dot(y, z)) + Math.abs(dot(z, x))).toBeLessThan(1e-9); // square
      expect(dot(cross3(x, y), z)).toBeCloseTo(1, 9); // right-handed
    }
  });

});

describe("defaultSnapRadius", () => {
  it("covers a square grid's cells corner to corner", () => {
    const grid = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) grid.push({ position: [i * 0.06, 0.04, j * 0.06], yaw: null });
    const r = defaultSnapRadius(grid);
    expect(r).toBeCloseTo(0.0424, 4);
    // a cell's corner is still within reach of its point
    expect(Math.hypot(0.03, 0.03)).toBeLessThanOrEqual(r + 1e-9);
  });
  it("ignores height and coincident points", () => {
    expect(defaultSnapRadius([[0, 0, 0], [0, 1, 0], [0.1, 0, 0]])).toBeCloseTo(0.0707, 4);
  });
  it("has nothing to say about a single point", () => {
    expect(defaultSnapRadius([[0, 0, 0]])).toBeNull();
    expect(defaultSnapRadius([])).toBeNull();
  });
});
