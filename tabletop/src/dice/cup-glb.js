// The parts a table of cup dice is set with, as GLBs at real size, drawn
// here: a dice cup, and a pool for the dice a player has lost. Pure: no DOM,
// no three.js. Metres, Y up. (Liar's dice's round table is the game's own
// art, in games/liars-dice.json.)
//
// - A cup stands on its mouth at the origin and is closed at the top: a
//   tapered leather-look shell (outside, inside, rim, crown) with a band
//   round it. Opaque from every side, and closed, so nothing under it shows
//   from any angle above the table.
// - The pool is a shallow felt dish standing on y = 0.

import { computeBounds, encodeGLB } from "../kit/glb.js";
import { CUP_HEIGHT, CUP_MOUTH, CUP_TOP, CUP_WALL } from "./cup.js";

/** The pool's radius (m). */
export const POOL_RADIUS = 0.11;

const SIDES = 48;
const trim = (v) => +(+v).toFixed(6) + 0;

/**
 * A surface of revolution about +Y through the points [radius, y] of a
 * profile, its normals out from the axis, or in (`inward`), or flat.
 */
function lathe(profile, { inward = false, sides = SIDES } = {}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const n = profile.length;
  for (let s = 0; s <= sides; s++) {
    const a = (2 * Math.PI * s) / sides;
    const c = Math.cos(a), sn = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      positions.push(trim(r * c), trim(y), trim(r * sn));
      // the profile's own slope, turned out of it
      const [r0, y0] = profile[Math.max(0, i - 1)];
      const [r1, y1] = profile[Math.min(n - 1, i + 1)];
      const dr = r1 - r0, dy = y1 - y0;
      let nr = dy, ny = -dr;
      const l = Math.hypot(nr, ny) || 1;
      nr /= l;
      ny /= l;
      if (inward) (nr = -nr), (ny = -ny);
      normals.push(nr * c, ny, nr * sn);
    }
  }
  for (let s = 0; s < sides; s++) {
    for (let i = 0; i + 1 < n; i++) {
      const a = s * n + i, b = (s + 1) * n + i;
      // outward-facing winding for a profile going up; flipped for an inside
      if (inward) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return { positions, normals, indices };
}

/** A flat ring (a disc when `inner` is 0) at height y, facing up or down. */
function ring(inner, outer, y, up = true, sides = SIDES) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let s = 0; s <= sides; s++) {
    const a = (2 * Math.PI * s) / sides;
    const c = Math.cos(a), sn = Math.sin(a);
    positions.push(trim(inner * c), trim(y), trim(inner * sn), trim(outer * c), trim(y), trim(outer * sn));
    normals.push(0, up ? 1 : -1, 0, 0, up ? 1 : -1, 0);
  }
  for (let s = 0; s < sides; s++) {
    const a = 2 * s;
    if (up) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions, normals, indices };
}

const radiusAt = (y) => CUP_MOUTH + (CUP_TOP - CUP_MOUTH) * (y / CUP_HEIGHT);

/** Darker, by a factor, as "#rrggbb". */
export function shade(hex, f) {
  const v = parseInt(String(hex).slice(1, 7), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * f)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** A dice cup in `color`. @returns {{ glb: Uint8Array, bounds }} */
export function cupGLB(color = "#7a3b22") {
  const H = CUP_HEIGHT;
  const band = [0.66 * H, 0.74 * H];
  const outside = lathe([
    [radiusAt(0), 0],
    [radiusAt(band[0]), band[0]],
  ]);
  const bandWall = lathe([
    [radiusAt(band[0]) + 0.0008, band[0]],
    [radiusAt(band[1]) + 0.0008, band[1]],
  ]);
  const upper = lathe([
    [radiusAt(band[1]), band[1]],
    [CUP_TOP, H],
  ]);
  const inside = lathe(
    [
      [radiusAt(0) - CUP_WALL, 0],
      [CUP_TOP - CUP_WALL, H - CUP_WALL],
    ],
    { inward: true },
  );
  const rim = ring(radiusAt(0) - CUP_WALL, radiusAt(0), 0, false);
  const crown = ring(0, CUP_TOP, H, true);
  const ceiling = ring(0, CUP_TOP - CUP_WALL, H - CUP_WALL, false);
  const dark = shade(color, 0.55);
  const meshes = [
    { name: "cup", primitives: [outside, upper, crown].map((p) => ({ ...p, color, roughness: 0.75, doubleSided: false })) },
    { name: "inside", primitives: [inside, ceiling, rim].map((p) => ({ ...p, color: dark, roughness: 0.9, doubleSided: false })) },
    { name: "band", primitives: [{ ...bandWall, color: "#c9a24a", roughness: 0.4, metallic: 0.6, doubleSided: false }] },
  ];
  return finish(meshes, "patchwork dice: cup");
}

/** The pool: a shallow felt dish, POOL_RADIUS across, standing on y = 0. */
export function poolGLB({ felt = "#7a1f2b", rim = "#3a2a1c" } = {}) {
  const R = POOL_RADIUS;
  const meshes = [
    { name: "felt", primitives: [{ ...ring(0, R - 0.006, 0.002, true, 64), color: felt, roughness: 0.95 }] },
    {
      name: "rim",
      primitives: [
        { ...lathe([[R, 0], [R, 0.008]], { sides: 64 }), color: rim, roughness: 0.5 },
        { ...ring(R - 0.006, R, 0.008, true, 64), color: rim, roughness: 0.5 },
        { ...lathe([[R - 0.006, 0.002], [R - 0.006, 0.008]], { inward: true, sides: 64 }), color: rim, roughness: 0.5 },
      ],
    },
  ];
  return finish(meshes, "patchwork dice: pool");
}

function finish(meshes, generator) {
  const glb = encodeGLB({ generator, meshes });
  const b = computeBounds(meshes.flatMap((m) => m.primitives.flatMap((p) => p.positions)));
  return { glb, bounds: { min: b.min.map(trim), max: b.max.map(trim) } };
}
