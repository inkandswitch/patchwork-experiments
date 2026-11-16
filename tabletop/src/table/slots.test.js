// A piece's places are read from the scene's connectors alone, whole frames
// and all. Golden: for every built-in game's every piece with snap points,
// on a few poses and for each tag its places take, worldSlots now gives what
// it gave when this package wrote the frames again under
// extras["tabletop.slots"] and read them from there (that reading is frozen
// below, as it was).
import { describe, it, expect } from "vitest";
import { worldSlots } from "./slots.js";
import { extrasOf, connectorsOf } from "../look/look.js";
import { GAMES } from "../test/games.js";
import { stageExtras } from "../test/stand-ins.js";
import { composeMatrix } from "../test/fakes.js";

// ─── the extras-based reading this package had, frozen ──────────────────────

const oldYawOfEuler = (rotation) => {
  const [x, y] = rotation.map(Number);
  const fx = Math.sin(y);
  const fz = Math.cos(x) * Math.cos(y);
  return Math.hypot(fx, fz) < 1e-9 ? null : Math.atan2(fx, fz);
};
/** The GLB extras the old look.js wrote: connectors, and the same again whole under "tabletop.slots" where any place had a frame. */
function oldGlbExtras(piece) {
  const extras = { connectors: connectorsOf(piece.snapPoints) };
  if (piece.snapPoints.some((p) => Array.isArray(p?.rotation))) extras["tabletop.slots"] = connectorsOf(piece.snapPoints);
  return extras;
}
/** What the old stage made of them: each connector's yaw only (its rotation dropped), and the rest as the GLB had it. */
const oldStageExtras = (glb) => ({ ...glb, connectors: glb.connectors.map((c) => ({ position: c.position, yaw: Array.isArray(c.rotation) ? oldYawOfEuler(c.rotation) : null, tags: c.tags ?? [] })) });
function oldPlacesOf(extras) {
  const whole = extras?.["tabletop.slots"];
  if (Array.isArray(whole) && whole.length) {
    return whole.map((c) => {
      const rotation = Array.isArray(c.rotation) && c.rotation.length === 3 ? c.rotation.map(Number) : null;
      return { position: c.position.map(Number), yaw: rotation ? oldYawOfEuler(rotation) : null, rotation, tags: Array.isArray(c.tags) ? c.tags : [] };
    });
  }
  return extras.connectors.map((c) => ({ ...c, rotation: null }));
}
function oldWorldSlots(m, extras, tags) {
  const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
  const radius = (Number(extras.snapRadius) || 0) * scale;
  if (!(radius > 0)) return [];
  const turn = Math.atan2(m[8], m[10]);
  const out = [];
  for (const c of oldPlacesOf(extras)) {
    if (!c.tags?.length || !c.tags.some((t) => tags.includes(t))) continue;
    const [x, y, z] = c.position;
    const yaw = c.yaw == null ? null : Number(c.yaw);
    out.push({
      world: [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
      yaw: yaw == null ? null : yaw + turn,
      radius,
      local: { position: [x, y, z], yaw: yaw ?? 0, rotation: c.rotation ?? [0, yaw ?? 0, 0] },
    });
  }
  return out;
}

// ─── the golden ─────────────────────────────────────────────────────────────

const POSES = {
  "at the origin": composeMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }),
  "turned 0.7 and moved": composeMatrix({ position: [0.4, 0.75, -0.2], rotation: [0, 0.7, 0], scale: 1 }),
  "turned round, twice the size": composeMatrix({ position: [-1, 0, 2], rotation: [0, Math.PI, 0], scale: 2 }),
};
const RADIUS = 0.03; // a piece that gives none (Lost Cities' hand): the stage would work one out; the same for both
const pieces = Object.entries(GAMES).flatMap(([g, game]) => Object.entries(game.pieces ?? {}).filter(([, p]) => p.snapPoints?.length).map(([k, p]) => [`${g}: ${k}`, p]));

describe("a piece's places, from the scene's connectors alone", () => {
  it("covers every built-in game's pieces with places: Lost Cities' board and hand, Santorini's board, each Draw Dominoes rack", () => {
    expect(pieces.map(([name]) => name).sort()).toEqual(["draw-dominoes-2: rack", "draw-dominoes-3: rack", "draw-dominoes-4: rack", "lost-cities: board", "lost-cities: hand", "santorini: board"]);
  });

  it.each(pieces)("%s: the same slots as when the frames were written twice", (_, piece) => {
    const radius = piece.snapRadius ?? RADIUS;
    const before = { ...oldStageExtras(oldGlbExtras(piece)), snapRadius: radius };
    const now = { ...stageExtras(extrasOf(piece)), snapRadius: radius };
    expect(now).not.toHaveProperty("tabletop.slots");
    const tagSets = [...new Set(piece.snapPoints.flatMap((p) => p.tags ?? []))].map((t) => [t]).concat([["nothing of these"]]);
    for (const [pose, m] of Object.entries(POSES)) {
      for (const tags of tagSets) {
        const a = oldWorldSlots(m, before, tags);
        const b = worldSlots(m, now, tags);
        if (tags[0] !== "nothing of these") expect(a.length, "the golden has places to compare").toBeGreaterThan(0);
        expect(b, `${pose}, ${tags}`).toEqual(a);
      }
    }
  });

  it("a GLB that still carries the old extras[\"tabletop.slots\"] reads the same: the key is ignored", () => {
    const rack = GAMES["draw-dominoes-2"].pieces.rack;
    const extras = stageExtras(extrasOf(rack));
    const m = POSES["turned 0.7 and moved"];
    const stale = { ...extras, "tabletop.slots": [{ position: [9, 9, 9], rotation: [0, 0, 0], tags: ["domino"] }] };
    expect(worldSlots(m, stale, ["domino"])).toEqual(worldSlots(m, extras, ["domino"]));
  });

  it("a rack's places stand a tile on edge: the frame comes through the scene's connectors whole", () => {
    const rack = GAMES["draw-dominoes-2"].pieces.rack;
    const [first] = worldSlots(POSES["at the origin"], stageExtras(extrasOf(rack)), ["domino"]);
    expect(first.local.rotation).toEqual(rack.snapPoints[0].rotation);
    expect(first.yaw).toBeCloseTo(Math.PI / 2, 12);
  });
});
