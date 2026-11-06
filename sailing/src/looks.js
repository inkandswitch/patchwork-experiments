// What each view dresses for itself, from what it shows, with no hold and
// nothing sent (DESIGN.md, "Play"; STAGE.md, "dressing content"): whatever
// floats bobs and tilts on the waves where it's moored, and each ship's sail
// is lowered toward the boom as it's taken in, bellied to leeward of the
// boom as drawn, and flat while it luffs. Only nodes inside the content of
// objects sailing's own traits mark are touched, and each is put back on
// dispose. The maths is pure and exported; createLooks is the stage side.

import { SAIL_LUFF } from "./physics-foils.js";
import { scaleOf, unrotateM } from "./frames.js";
import { FLOAT } from "./traits.js";
import { bodyOf } from "./body.js";

const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ─── floating (pure) ────────────────────────────────────────────────────────

/** A float's tilt follows this much of the water's slope (it has a keel weight and some inertia). */
export const FLOAT_TILT = 0.6;

/**
 * Where a float rides, in its own frame, for its world matrix `m` on `sea`
 * at `t`: an offset up to the surface over where it's moored, and a tilt
 * [rx, rz] (Euler, radians) toward the water's normal.
 * @returns {{ offset: number[], tilt: number[] }}
 */
export function floatPose(sea, m, t) {
  const [h, nx, ny, nz] = sea.sampleAt(m[12], m[14], t);
  const s = scaleOf(m);
  const n = unrotateM(m, [nx, ny, nz]);
  return {
    offset: unrotateM(m, [0, h, 0]).map((v) => v / s), // straight up by the water's height there
    tilt: [FLOAT_TILT * Math.atan2(n[2], n[1]), -FLOAT_TILT * Math.atan2(n[0], n[1])],
  };
}

// ─── the sail (pure) ────────────────────────────────────────────────────────

/** The camber a sail keeps however hard it luffs (a flat sail still has some shape). */
export const FLAT = 0.12;

/**
 * Is the boom out to port, as drawn: the rig's aft-running axis (local +Z)
 * on the ship's port side (her body's −X)? From the ship's body frame and
 * the rig's world matrix, as displayed.
 */
export function boomToPort(hull, rig) {
  if (!hull || !rig) return false;
  return rig[8] * hull[0] + rig[9] * hull[1] + rig[10] * hull[2] < -1e-9;
}

/**
 * How full the sail is drawn, 0..1 (the rig's scale across), from what the
 * ship reads: flat while the wind runs along the boom (luffing), full once
 * it meets it a few degrees past the luff. A sail crossing the centreline
 * is luffing, so its belly passes through flat rather than snapping across.
 * @param {{ apparentWind?: { angle: number }, boom?: number } | null} read
 */
export function fullness(read) {
  if (!read?.apparentWind || !Number.isFinite(read.boom)) return 1;
  const aoa = Math.abs(Math.abs(read.apparentWind.angle) - Math.abs(read.boom));
  return Math.max(FLAT, smoothstep(SAIL_LUFF, SAIL_LUFF + 8 * DEG, aoa));
}

// ─── the stage side ─────────────────────────────────────────────────────────

/**
 * @param {any} api
 * @param {{ sea, sim }} ctx
 */
export function createLooks(api, ctx) {
  const floatsOf = (scene) => (scene?.ids ?? []).filter((id) => scene.objects[id]?.traits?.[FLOAT]);
  let floats = floatsOf(api.scene?.());
  const moved = new Set(); // float roots this view has moved
  const dressed = new Map(); // rig root → its sail node

  function bob(t) {
    if (!ctx.sea.ocean) return;
    for (const id of floats) {
      const root = api.content(id)?.root;
      const m = api.worldOf(id);
      if (!root || !m) continue;
      const { offset, tilt } = floatPose(ctx.sea.ocean, m, t);
      // the content node, not the object: where it's moored stays the doc's
      root.position.set(offset[0], offset[1], offset[2]);
      root.rotation.set(tilt[0], 0, tilt[1]);
      moved.add(root);
    }
  }

  function dress() {
    for (const ship of ctx.sim.ships()) {
      const rig = ctx.sim.stationsOf(ship).sail;
      const root = rig ? api.content(rig)?.root : null;
      if (!root) continue;
      // cambered to starboard as built: mirrored with the boom to port
      const side = boomToPort(bodyOf(api, ship), api.worldOf(rig)) ? -1 : 1;
      const x = side * fullness(ctx.sim.read(ship));
      if (root.scale.x !== x) root.scale.x = x;
      const sail = root.getObjectByName?.("Sail") ?? null;
      dressed.set(root, sail);
      if (!sail) continue;
      const raised = clamp(Number(ctx.sim.value(rig)?.raised) || 0, 0, 1);
      sail.scale.y = Math.max(raised, 1e-3);
      sail.visible = raised > 0.02;
    }
  }

  return {
    update(scene) {
      floats = floatsOf(scene);
    },
    tick() {
      bob(ctx.sea.clock());
      dress();
    },
    dispose() {
      for (const root of moved) {
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
      }
      for (const [root, sail] of dressed) {
        root.scale.x = 1;
        if (sail) {
          sail.scale.y = 1;
          sail.visible = true;
        }
      }
      moved.clear();
      dressed.clear();
    },
  };
}
