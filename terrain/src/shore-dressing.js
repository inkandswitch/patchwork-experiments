// Drift logs on the harbour's shores (dressing, not data): on this coast
// every cove and beach holds a line of silver-grey logs at the top of the
// tide, thrown up by winter storms. Along the coastline's pieces (surf.js
// coastPieces) inside the place's circles, a piece by its own hash gets a
// log or two, 8 to 20 m long and 0.5 to 1 m across, lying roughly along the
// shore where the ground reaches the highest tide (HHWLT): found by walking
// inland from the piece square to it. Every choice is the piece's key's:
// the same logs every build.
//
// Pure.

import { soup, log } from "./shapes.js";
import { hexToLinear } from "./glb.js";
import { dsin, dcos } from "./detmath.js";

/** A piece's hash in [0, 1), by its key (a string) and a seed. */
export function keyHash(key, seed) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export const DRIFT = Object.freeze({ chance: 0.22, length: [8, 20], diameter: [0.5, 1], colour: "#a39f96", reach: 80, step: 1, bury: 0.6 });

/** Whether (x, z) is inside any of `circles` ([{ x, z, radius }]). */
const inside = (circles, x, z) => circles.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.radius * c.radius);

/**
 * The logs: for each piece inside `circles` whose hash is under `chance`, one
 * log (two where a second hash is under a third of it), lying along the
 * shore ±25°, its middle where the ground first reaches `level` walking
 * inland from the piece's middle (none if it never does within `reach`, or
 * the ground there is `built`). → [{ key, a: [x, y, z], b: [x, y, z], r, shade }]
 * @param {{ a, b, sea, key }[]} pieces  surf.js coastPieces
 * @param {(x: number, z: number) => number | null} groundAt
 */
export function driftLogs(pieces, groundAt, { circles = [], level = 2, built = null, ...o } = {}) {
  const { chance, length: [l0, l1], diameter: [d0, d1], reach, step, bury } = { ...DRIFT, ...o };
  const out = [];
  for (const pc of pieces) {
    const mx = (pc.a[0] + pc.b[0]) / 2, mz = (pc.a[1] + pc.b[1]) / 2;
    if (!inside(circles, mx, mz) || keyHash(pc.key, 1) >= chance) continue;
    const count = keyHash(pc.key, 2) < chance / 3 ? 2 : 1;
    for (let q = 0; q < count; q++) {
      // walk inland (away from the sea) to the highest tide's line
      const t = 0.15 + 0.7 * keyHash(pc.key, 3 + q * 10);
      const sx = pc.a[0] + (pc.b[0] - pc.a[0]) * t, sz = pc.a[1] + (pc.b[1] - pc.a[1]) * t;
      let at = null;
      for (let d = 0; d <= reach; d += step) {
        const x = sx - pc.sea[0] * d, z = sz - pc.sea[1] * d, g = groundAt(x, z);
        if (g == null) break;
        if (g >= level) {
          at = [x + pc.sea[0] * 0.6, z + pc.sea[1] * 0.6];
          break;
        }
      }
      if (!at || built?.(at[0], at[1])) continue;
      const along = Math.atan2(pc.b[1] - pc.a[1], pc.b[0] - pc.a[0]) + (keyHash(pc.key, 4 + q * 10) - 0.5) * (50 * Math.PI) / 180;
      const len = l0 + (l1 - l0) * keyHash(pc.key, 5 + q * 10), r = (d0 + (d1 - d0) * keyHash(pc.key, 6 + q * 10)) / 2;
      const hx = (dcos(along) * len) / 2, hz = (dsin(along) * len) / 2;
      const ga = groundAt(at[0] - hx, at[1] - hz) ?? level, gb = groundAt(at[0] + hx, at[1] + hz) ?? level;
      // its axis `bury` of its radius over the ground (0: half buried in the cobble)
      out.push({ key: `${pc.key}#${q}`, a: [at[0] - hx, ga + r * bury, at[1] - hz], b: [at[0] + hx, gb + r * bury, at[1] + hz], r, shade: 0.85 + 0.25 * keyHash(pc.key, 7 + q * 10) });
    }
  }
  return out;
}

/** The logs as one triangle soup: six-sided, capped, silver-grey (each its own shade), their sawn or broken ends `cap` of that (darker: the grey is the weathered skin). */
export function logMesh(logs, colour = DRIFT.colour, cap = 0.9) {
  const s = soup();
  const base = hexToLinear(colour).slice(0, 3);
  for (const g of logs) log(s, g.a, g.b, g.r, base.map((c) => c * g.shade), 6, base.map((c) => c * g.shade * cap));
  return s.done();
}
