import { describe, it, expect } from "vitest";
import { castClearance, createCarry, downOnto, flipAt, flipInPlace, flipMatrix, landingFor, localTransform, rotateAbout, snapCandidates, tablePoint, translate, turnRadius, turning, worldBox, yawOfMatrix } from "./hand-carry.js";
import { composeMatrix } from "../transform.js";

const I = composeMatrix({});
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
// a 0.2 × 0.1 × 0.2 piece, sitting on its base
const BOX = { min: [-0.1, 0, -0.1], max: [0.1, 0.1, 0.1] };
// looking straight down at (x, z)
const down = (x, z) => ({ origin: [x, 10, z], dir: [0, -1, 0] });
const ground = () => null; // nothing to hit: the ground
/**
 * Solid boxes (axis-aligned) as the stage's raycast sees them: double sided,
 * the nearest face along a vertical ray, `back` when it's met from inside.
 * (Only vertical rays: what the footprint's rays are.)
 */
const solids = (...boxes) => (origin, dir) => {
  if (dir[0] || dir[2]) return null;
  let best = null;
  for (const s of boxes) {
    const [x, y, z] = origin;
    if (x < s.min[0] || x > s.max[0] || z < s.min[2] || z > s.max[2]) continue;
    const inside = y > s.min[1] && y < s.max[1];
    const face = dir[1] < 0 ? (y >= s.max[1] ? s.max[1] : inside ? s.min[1] : null) : y <= s.min[1] ? s.min[1] : inside ? s.max[1] : null;
    if (face == null) continue;
    const d = Math.abs(face - y);
    if (!best || d < best.distance) best = { id: s.id, point: [x, face, z], distance: d, back: inside };
  }
  return best;
};

describe("hand-carry maths", () => {
  it("turns about a world axis through the origin, keeping the translation", () => {
    const m = composeMatrix({ position: [1, 2, 3] });
    const r = rotateAbout(m, [0, 1, 0], Math.PI / 2);
    expect(close(r.slice(12, 15), [1, 2, 3])).toBe(true);
    expect(yawOfMatrix(r)).toBeCloseTo(Math.PI / 2);
    expect(close(r, composeMatrix({ position: [1, 2, 3], rotation: [0, Math.PI / 2, 0] }))).toBe(true);
  });

  it("flips about its own length: up turns down", () => {
    const f = flipMatrix(I);
    expect(f[5]).toBeCloseTo(-1);
    expect(f[10]).toBeCloseTo(1); // still pointing the same way along its length
    expect(flipMatrix(f)[5]).toBeCloseTo(1);
  });

  it("boxes a body box in world, and decomposes under a parent", () => {
    const m = composeMatrix({ position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const b = worldBox({ min: [0, 0, 0], max: [1, 1, 2] }, m);
    expect(b.min.map((v) => +v.toFixed(9))).toEqual([1, 0, -2]);
    expect(b.max.map((v) => +v.toFixed(9))).toEqual([5, 2, 0]);
    const parent = composeMatrix({ position: [0, 1, 0] });
    const t = localTransform(parent, translate(I, [2, 1, 0]));
    expect(t.position).toEqual([2, 0, 0]);
    expect(localTransform(null, m).scale).toBeCloseTo(2);
  });

  it("puts connectors in world, turned and scaled with their object, and only where the tags fit", () => {
    const m = composeMatrix({ position: [5, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 });
    const c = snapCandidates(
      [
        { id: "board", matrix: m, snapRadius: 0.5, connectors: [{ position: [1, 0, 0], yaw: 0, tags: [] }, { position: [0, 0, 1], yaw: null, tags: ["card"] }] },
        { id: "nothing", matrix: I, snapRadius: null, connectors: [{ position: [0, 0, 0], tags: [] }] }, // no radius: no snapping
      ],
      [],
    );
    expect(c).toHaveLength(1);
    expect(c[0].objectId).toBe("board");
    expect(close(c[0].world, [5, 0, -2])).toBe(true);
    expect(c[0].radius).toBeCloseTo(1);
    expect(c[0].yaw).toBeCloseTo(Math.PI / 2);
    expect(snapCandidates([{ id: "board", matrix: m, snapRadius: 0.5, connectors: [{ position: [0, 0, 1], tags: ["card"] }] }], ["card"])).toHaveLength(1);
  });

  it("finds the table: the first object hit, else the ground, else nothing", () => {
    expect(tablePoint(down(1, 2), ground)).toEqual({ point: [1, 0, 2], id: null });
    expect(tablePoint(down(1, 2), () => ({ id: "t", point: [1, 0.5, 2] }))).toEqual({ point: [1, 0.5, 2], id: "t" });
    expect(tablePoint({ origin: [0, 1, 0], dir: [0, 1, 0] }, ground)).toBe(null); // the sky
  });

  it("lands on the ground, on the highest surface under the footprint, or on a connector (not with Alt)", () => {
    const W = composeMatrix({ position: [0, 0.3, 0] });
    let land = landingFor({ W, box: BOX, ray: down(2, 3), raycast: ground });
    expect(land.delta.map((v) => +v.toFixed(9))).toEqual([2, -0.3, 3]);
    expect(land.snapped).toBe(false);
    expect(land.on).toBe(null);
    expect(land.radius).toBeCloseTo(0.1);
    expect(land.lift).toBeCloseTo(0.05);
    // a block under one corner of the footprint, 0.4 high: it rests on that
    const block = solids({ id: "block", min: [2, 0, 3], max: [9, 0.4, 9] });
    land = landingFor({ W, box: BOX, ray: down(2, 3), raycast: block });
    expect(land.rest).toBeCloseTo(0.4);
    expect(land.on).toBe("block");
    expect(land.delta[1]).toBeCloseTo(0.1);
    // a connector nearby takes it there; Alt places it where it is
    const snaps = [{ world: [2.2, 0, 3.1], yaw: 1, radius: 0.5, objectId: "board" }];
    land = landingFor({ W, box: BOX, ray: down(2, 3), snaps, raycast: ground });
    expect(land.snapped).toBe(true);
    expect(land.spot).toEqual([2.2, 0, 3.1]);
    expect(land.yaw).toBe(1);
    expect(land.on).toBe("board");
    expect(landingFor({ W, box: BOX, ray: down(2, 3), snaps, raycast: ground, alt: true }).snapped).toBe(false);
    // looking at the sky: nowhere to land
    expect(landingFor({ W, box: BOX, ray: { origin: [0, 1, 0], dir: [0, 1, 0] }, raycast: ground })).toBe(null);
  });

  it("keeps the grab offset in plan", () => {
    const land = landingFor({ W: I, box: BOX, ray: down(1, 1), offset: [0.05, -0.05], raycast: ground });
    expect(land.spot.map((v) => +v.toFixed(9))).toEqual([1.05, 0, 0.95]);
  });

  it("carries: floats while moving, puts down without the lift", () => {
    const c = createCarry({ id: "a", W: I, box: BOX, raycast: ground });
    const land = c.move(down(1, 0));
    expect(c.state.W[13]).toBeCloseTo(land.lift);
    expect(c.state.W[12]).toBeCloseTo(1);
    const W = c.put();
    expect(close(W.slice(12, 15), [1, 0, 0])).toBe(true);
  });

  it("turns to a connector's yaw, and Q/E-style turns about the vertical", () => {
    const snaps = [{ world: [1, 0, 0], yaw: Math.PI / 2, radius: 0.5, objectId: "board" }];
    const c = createCarry({ id: "a", W: I, box: BOX, snaps, raycast: ground });
    c.move(down(1.1, 0));
    expect(yawOfMatrix(c.state.W)).toBeCloseTo(Math.PI / 2);
    expect(c.state.W[12]).toBeCloseTo(1);
    // off the connector, a turn stays
    const d = createCarry({ id: "a", W: I, box: BOX, raycast: ground });
    d.move(down(3, 3));
    d.turn(Math.PI / 4);
    expect(yawOfMatrix(d.state.W)).toBeCloseTo(Math.PI / 4);
    expect(d.state.W[12]).toBeCloseTo(3); // re-landed at the same pointer
  });

  it("Alt toggles snapping for the same pointer", () => {
    const snaps = [{ world: [1, 0, 0], yaw: null, radius: 0.5, objectId: "board" }];
    const c = createCarry({ id: "a", W: I, box: BOX, snaps, raycast: ground });
    expect(c.move(down(1.2, 0)).snapped).toBe(true);
    expect(c.alt(true).snapped).toBe(false);
    expect(c.state.W[12]).toBeCloseTo(1.2);
    expect(c.alt(false).snapped).toBe(true);
    expect(c.state.W[12]).toBeCloseTo(1);
  });

  it("turns face up where a landing rule asks, and back over when it leaves", () => {
    const faceDown = flipMatrix(I);
    const asked = [];
    const landing = (id, p, hitId) => (asked.push([id, hitId]), p[0] > 2 ? { faceUp: true } : null);
    const c = createCarry({ id: "card", W: faceDown, box: BOX, raycast: ground, landing });
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0); // still face down
    c.move(down(3, 0));
    expect(c.state.W[5]).toBeGreaterThan(0); // turned up for you
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0); // and back
    expect(asked[0]).toEqual(["card", null]);
    // F: it's up to you now; nothing turns it any more
    c.flip();
    expect(c.state.W[5]).toBeGreaterThan(0);
    c.move(down(3, 0));
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeGreaterThan(0);
  });

  it("is not turned by a rule that already held where it was picked up", () => {
    const c = createCarry({ id: "card", W: flipMatrix(I), box: BOX, raycast: ground, landing: () => ({ faceUp: true }) });
    c.move(down(1, 0));
    expect(c.state.W[5]).toBeLessThan(0);
  });

  it("counts each time it turns over, by F or by a landing rule", () => {
    const landing = (id, p) => (p[0] > 2 ? { faceUp: true } : null);
    const c = createCarry({ id: "card", W: flipMatrix(I), box: BOX, raycast: ground, landing });
    c.move(down(1, 0));
    expect(c.state.flips).toBe(0);
    c.move(down(3, 0));
    expect(c.state.flips).toBe(1);
    c.flip();
    expect(c.state.flips).toBe(2);
  });

  it("has nothing to put down before it moved", () => {
    expect(createCarry({ id: "a", W: I, box: BOX, raycast: ground }).put()).toBe(null);
  });
});

describe("turning over in the air", () => {
  // a card: 0.06 wide, 0.002 thick, 0.09 long (its length along +Z), origin at its middle
  const CARD = { min: [-0.03, -0.001, -0.045], max: [0.03, 0.001, 0.045] };
  const lying = composeMatrix({ position: [0.5, 0.001, 0.2] });

  it("sweeps out as far as its body reaches from its length", () => {
    expect(turnRadius(CARD, lying)).toBeCloseTo(Math.hypot(0.03, 0.001));
    expect(turnRadius(CARD, composeMatrix({ scale: 2 }))).toBeCloseTo(2 * Math.hypot(0.03, 0.001));
  });

  it("goes from not turned to turned, highest half way", () => {
    const to = flipMatrix(lying);
    expect(close(turning(to, 0, 0.1), lying)).toBe(true);
    expect(close(turning(to, 1, 0.1), to)).toBe(true);
    const mid = turning(to, 0.5, 0.1);
    expect(mid[13]).toBeCloseTo(lying[13] + 0.1);
    expect(mid[5]).toBeCloseTo(0); // on its edge
    expect(mid[10]).toBeCloseTo(1); // turning about its length
  });

  it("turns a lying card over where it is, rising clear of the table on the way", () => {
    const { to, lift } = flipInPlace({ W: lying, box: CARD, raycast: ground });
    expect(to[5]).toBeCloseTo(-1); // face down
    expect(to.slice(12, 15).map((v) => +v.toFixed(9))).toEqual([0.5, 0.001, 0.2]); // where it was
    expect(lift).toBeGreaterThan(turnRadius(CARD, lying));
    // never through the table: its lowest corner stays above it all the way
    for (let t = 0; t <= 1.0001; t += 0.05) expect(worldBox(CARD, flipAt(lying, to, t, lift)).min[1]).toBeGreaterThan(-1e-9);
  });

  it("comes down on whatever is under it, the top of a pile", () => {
    const pile = (origin) => (origin[1] > 0.01 ? { id: "pile", point: [origin[0], 0.01, origin[2]] } : null);
    const { to } = flipInPlace({ W: lying, box: CARD, raycast: pile });
    expect(to[13]).toBeCloseTo(0.011);
    expect(close(flipAt(lying, to, 0, 0.1), lying)).toBe(true);
    expect(close(flipAt(lying, to, 1, 0.1), to)).toBe(true);
  });
});

describe("under a boom: the rays start just above the piece, not the top of the scene", () => {
  // a table top at 1.42, and a boom 1.4 m above it (2.81 to 2.88) across the whole table
  const TABLE = 1.42;
  const BOOM = [2.81, 2.88];
  const cast = (origin, dir) => {
    if (dir[1] >= 0) return null;
    if (origin[1] > BOOM[1]) return { id: "boom", point: [origin[0], BOOM[1], origin[2]] };
    if (origin[1] > TABLE) return { id: "table", point: [origin[0], TABLE, origin[2]] };
    return null;
  };
  const CARD = { min: [-0.028, 0, -0.0435], max: [0.028, 0.0008, 0.0435] };
  const onTable = composeMatrix({ position: [0, TABLE, 0] });
  // the pointer, looking down from a seat under the boom
  const pointer = (x, z) => ({ origin: [x, 2.2, z + 0.6], dir: [0, -0.78, -0.6].map((v, i, a) => v / Math.hypot(...a)) });

  it("starts a quarter metre (or the piece's size) above the piece or the pointer's point", () => {
    expect(castClearance(worldBox(CARD, onTable))).toBe(0.25);
    expect(castClearance({ min: [0, 0, 0], max: [1, 0.2, 0.5] })).toBe(1);
  });

  it("a card carried across the table goes down on the table", () => {
    const c = createCarry({ id: "card", W: onTable, box: CARD, raycast: cast });
    const land = c.move(pointer(0.1, 0));
    expect(land.on).toBe("table");
    expect(land.rest).toBeCloseTo(TABLE);
    expect(c.put()[13]).toBeCloseTo(TABLE);
  });

  it("Flip turns it over onto the table, not onto the boom", () => {
    const { to } = flipInPlace({ W: onTable, box: CARD, raycast: cast });
    expect(to[5]).toBeCloseTo(-1);
    expect(to[13]).toBeCloseTo(TABLE + 0.0008); // turned over, its box is below its origin
  });
});

describe("beside something taller than the clearance: the rays don't start inside it", () => {
  // a 0.1 m piece on the floor, the pointer on the floor just beside a 1 m block
  const PIECE = { min: [-0.05, 0, -0.05], max: [0.05, 0.1, 0.05] };
  const block = solids({ id: "block", min: [0.02, 0, -1], max: [2, 1, 1] });

  it("a ray down from inside the block climbs out over its top", () => {
    const h = downOnto(block, 0.5, 0.35, 0);
    expect(h.id).toBe("block");
    expect(h.point[1]).toBeCloseTo(1);
    expect(h.back).toBe(false);
  });

  it("the piece, part over the block, lands on top of it, not inside it", () => {
    const land = landingFor({ W: I, box: PIECE, ray: down(0, 0), raycast: block });
    expect(land.on).toBe("block");
    expect(land.rest).toBeCloseTo(1);
  });

  it("clear of the block: the floor", () => {
    const land = landingFor({ W: I, box: PIECE, ray: down(-0.2, 0), raycast: block });
    expect(land.on).toBe(null);
    expect(land.rest).toBe(0);
  });

  it("under a boom (a solid too) it still goes down on the table: the ray up meets the boom from below", () => {
    const scene = solids({ id: "table", min: [-1, 0.68, -1], max: [1, 0.7, 1] }, { id: "boom", min: [-2, 2.1, -0.05], max: [2, 2.17, 0.05] });
    // (the pointer from a seat under the boom, looking down at the table)
    const ray = { origin: [0, 1.5, 0.6], dir: [0, -0.8, -0.6] };
    const land = landingFor({ W: composeMatrix({ position: [0, 0.7, 0] }), box: PIECE, ray, raycast: (o, d) => (d[0] || d[2] ? { id: "table", point: [0, 0.7, 0] } : scene(o, d)) });
    expect(land.on).toBe("table");
    expect(land.rest).toBeCloseTo(0.7);
  });

  it("a face met from behind with nothing behind it overhead (a mesh's odd winding) is what it lands on", () => {
    const odd = (origin, dir) => (dir[1] < 0 ? { id: "sole", point: [origin[0], 0.3, origin[2]], back: true } : null);
    expect(downOnto(odd, 0, 0.6, 0).point[1]).toBeCloseTo(0.3);
  });
});
