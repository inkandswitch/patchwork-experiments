// The town's houses as West Coast houses (buildings.js HOUSE), checked on a made-up town of 400 footprints, every
// one of them, at 8 headings and with Ucluelet's palette (finite, nothing random).
import { describe, it, expect } from "vitest";
import { buildingMesh, PALETTE, DETAIL, HOUSE, isResidential, classOf, orientedBox } from "./buildings.js";
import { LOOK } from "./ucluelet.js";
import { hexToLinear } from "./glb.js";
import { ringArea } from "./cover.js";

const palette = { ...PALETTE, ...LOOK.buildings.palette };
const KINDS = ["house", "detached", "yes", "residential", "cabin", "yes", "semidetached_house", "yes"];
// rectangles and L-shapes, 8 × 6 to 16 × 13 m, at 8 headings, on ground falling 1 in 10 toward +z
const town = Array.from({ length: 400 }, (_, q) => {
  const t = ((q % 8) * Math.PI) / 4 + 0.1, L = 8 + (q % 9), W = 6 + (q % 7) * 1.2;
  const u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]], c = [(q % 20) * 60, Math.floor(q / 20) * 60];
  const local = q % 3 === 0 ? [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, 0], [0, 0], [0, W / 2], [-L / 2, W / 2]] : [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
  return { id: `way/${7000 + q}`, kind: KINDS[q % KINDS.length], levels: q % 11 === 0 ? 3 : undefined, points: local.map(([a, b]) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b]) };
});
const groundAt = (x, z) => 200 - z / 10;
const lin = (h) => hexToLinear(h).slice(0, 3).map((c) => Math.fround(c));
const same = (a, b) => a.every((c, i) => Math.abs(c - b[i]) < 1e-5);

describe("the town's houses", () => {
  const houses = town.filter((b) => isResidential(b, classOf(b, 0), ringArea(b.points)));
  it("counts every tagged house and every small untagged one as a house", () => {
    expect(houses.length).toBeGreaterThan(300);
  });
  it("roofs every house with a 25–35° gable along its long side, at most two storeys to its eave, at most two windows a wall a storey (every house)", () => {
    for (const b of houses) {
      const out = buildingMesh([b], { groundAt, sinkAt: () => 0.3, coverAt: () => 0, palette, details: true });
      expect(out.made).toBe(1);
      const box = orientedBox(b.points);
      let hi = -Infinity, lo = Infinity, glass = 0;
      for (const p of out.primitives) {
        for (let v = 1; v < p.positions.length; v += 3) (hi = Math.max(hi, p.positions[v])), (lo = Math.min(lo, p.positions[v]));
        if (same(p.color, lin(DETAIL.glass))) glass += p.positions.length / 9;
      }
      // the floor is the highest ground under it; the ridge over the eave by tan(pitch) × half its width, at most two storeys under it
      const floor = Math.max(...b.points.map(([x, z]) => groundAt(x, z)));
      const ridge = hi - floor, eave = HOUSE.storeys * DETAIL.storey + 0.4;
      const rise = (p) => Math.min(Math.tan((p * Math.PI) / 180) * box.hv, 8);
      expect(ridge).toBeGreaterThan(rise(HOUSE.pitch[0]) - 1e-3);
      expect(ridge).toBeLessThanOrEqual(eave + rise(HOUSE.pitch[1]) + 1e-3);
      // four walls (its rectangle), two windows each a storey at most: 2 triangles a window
      expect(glass / 2).toBeLessThanOrEqual(4 * HOUSE.windows * HOUSE.storeys);
    }
  });
  it("paints no wall colour on more than 30% of houses, barn red on no more than 12% (every house)", () => {
    const counts = new Map();
    for (const b of houses) {
      const out = buildingMesh([b], { groundAt, sinkAt: () => 0.3, coverAt: () => 0, palette });
      const wall = palette.houseWalls.find(([h]) => out.primitives.some((p) => same(p.color, lin(h))))?.[0];
      expect(wall).toBeTruthy();
      counts.set(wall, (counts.get(wall) ?? 0) + 1);
    }
    for (const [h, c] of counts) expect(c / houses.length, h).toBeLessThanOrEqual(0.3);
    expect((counts.get("#7d2f28") ?? 0) / houses.length).toBeLessThanOrEqual(0.12);
  });
  it("gives about 40% a deck on the downhill side (every house: between 30% and 50%)", () => {
    let decks = 0;
    for (const b of houses) {
      const out = buildingMesh([b], { groundAt, sinkAt: () => 0.3, coverAt: () => 0, palette });
      if (out.primitives.some((p) => same(p.color, lin(DETAIL.deckTop)))) decks++;
    }
    expect(decks / houses.length).toBeGreaterThan(0.3);
    expect(decks / houses.length).toBeLessThan(0.5);
  });
});
