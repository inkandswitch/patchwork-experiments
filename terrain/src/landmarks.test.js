// The waterfront's landmarks: a building's own form (cross-gables to the water, a curved roof, a stone base),
// and a wharf's railings, checked on made-up footprints at 8 headings (finite, nothing random).
import { describe, it, expect } from "vitest";
import { buildingMesh, crossGables, waterSide, orientedBox, paletteSoup } from "./buildings.js";
import { railing, structureMesh } from "./structures.js";
import { soup } from "./shapes.js";
import { hexToLinear } from "./glb.js";

const rect = (L, W, t) => {
  const u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
  return [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([a, b]) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b]);
};
const lin = (h) => hexToLinear(h).slice(0, 3).map((c) => Math.fround(c));
const has = (prims, h) => prims.some((p) => p.color.every((c, i) => Math.abs(c - lin(h)[i]) < 1e-5));

describe("a landmark's own form", () => {
  for (let h = 0; h < 8; h++) {
    const t = (h * Math.PI) / 4 + 0.05;
    const pts = rect(30, 12, t);
    // the ground falls toward the water on one side: along the box's v, whichever it is
    const box = orientedBox(pts);
    const groundAt = (x, z) => 5 + 0.2 * (x * box.v[0] + z * box.v[1]);
    it(`draws Whiskey Landing's: timber walls on a stone base, a red roof, four cross-gables on the water side (heading ${h})`, () => {
      const b = { id: "way/1", kind: "hotel", points: pts, levels: 3, colour: "#6b4a2e", roofColour: "#c0432c", form: "gables", gables: 4, stone: "#7c7a74", trim: "#f2f1ec" };
      const out = buildingMesh([b], { groundAt, sinkAt: () => 0.3, coverAt: () => 0, details: true });
      expect(out.made).toBe(1);
      for (const c of ["#6b4a2e", "#c0432c", "#7c7a74", "#f2f1ec"]) expect(has(out.primitives, c)).toBe(true);
      // the water is on the side the ground falls to
      expect(waterSide(box, groundAt)).toBe(-1);
      const s = paletteSoup();
      expect(crossGables(s, box, { eave: 14, rise: 3, bays: 4, side: -1, walls: "#6b4a2e", roofColour: "#c0432c", trim: "#f2f1ec" })).toBe(4);
      // every gable's wall and trim lie on the water side's facade, a hand out at most
      const red = s.done().primitives;
      for (const p of red) for (let v = 0; v < p.positions.length; v += 3) {
        const sv = (p.positions[v] - box.c[0]) * box.v[0] + (p.positions[v + 2] - box.c[1]) * box.v[1];
        expect(sv).toBeLessThanOrEqual(1e-4);
        expect(sv).toBeGreaterThanOrEqual(-box.hv - 0.35 - 1e-4);
      }
    });
    it(`draws the aquarium's curved roof over its walls (heading ${h})`, () => {
      const b = { id: "way/2", kind: "yes", points: pts, levels: 2, colour: "#2d3f66", roofColour: "#c9cccd", form: "curved" };
      const out = buildingMesh([b], { groundAt: () => 5, sinkAt: () => 0.3, coverAt: () => 0 });
      const roof = out.primitives.find((p) => p.color.every((c, i) => Math.abs(c - lin("#c9cccd")[i]) < 0.2));
      let top = -Infinity;
      for (const p of out.primitives) for (let v = 1; v < p.positions.length; v += 3) top = Math.max(top, p.positions[v]);
      expect(roof).toBeTruthy();
      // the eave at 6 m over the floor, the barrel 0.35 of the half-span over it
      expect(top).toBeCloseTo(5 + 6 + 0.35 * 6, 4);
    });
  }
});

describe("a wharf's railings", () => {
  it("puts a post every 2.5 m or so along every edge, a rail at 1.05 m and a curb, in their colours (8 headings)", () => {
    for (let h = 0; h < 8; h++) {
      const ring = rect(40, 10, (h * Math.PI) / 4);
      const s = soup();
      const posts = railing(s, ring, 2.8, { rail: "#b8302a", curb: "#e0b62c", every: 2.5 });
      expect(posts).toBe(2 * 16 + 2 * 4);
      const m = s.done();
      let top = -Infinity;
      for (let v = 1; v < m.positions.length; v += 3) top = Math.max(top, m.positions[v]);
      expect(top).toBeCloseTo(3.85, 5);
    }
    // only where the place dresses it
    const st = [{ id: "way/9", kind: "pier", floating: false, area: true, width: null, points: rect(40, 10, 0) }];
    expect(structureMesh(st, { dress: { "way/9": { rail: "#b8302a", curb: "#e0b62c" } } }).positions.length).toBeGreaterThan(structureMesh(st).positions.length);
  });
});
