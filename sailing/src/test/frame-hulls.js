// The stock hull as read off its GLB, and the same hull drawn a quarter turn
// round (bow along +X, as camber draws one): shared by frame.test.js and
// frame.slow.test.js.
import { expect } from "vitest";
import { encodeGLB } from "../glb.js";
import { partGLB, partMeshes } from "../ship.js";

/** What the stage would read off a GLB: the box of its positions, and the scene's extras. */
export function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }
  return { box: { min, max }, extras: json.scenes[0].extras ?? {} };
}

/** The stock hull a quarter turn round: her bow (−Z) along +X, her starboard (+X) along +Z, saying so. */
export function turnedHull() {
  const turn = (a) => {
    if (!a) return a;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) {
      out[i] = -a[i + 2];
      out[i + 1] = a[i + 1];
      out[i + 2] = a[i];
    }
    return out;
  };
  const meshes = partMeshes("hull").map((m) => ({ ...m, primitives: m.primitives.map((p) => ({ ...p, positions: turn(p.positions), normals: turn(p.normals) })) }));
  const stock = readGLB(partGLB("hull").bytes).extras.ship;
  return encodeGLB({ meshes, extras: { ship: { ...stock, forward: [1, 0, 0], up: [0, 1, 0] } } });
}

export const stockHull = readGLB(partGLB("hull").bytes);
export const turned = readGLB(turnedHull());
// the stock hull saying its bow is −Z: a stated bow puts her body's origin
// midships (her box's middle), as the turned one's, so the two are one ship
export const stated = { ...stockHull, extras: { ...stockHull.extras, ship: { ...stockHull.extras.ship, forward: [0, 0, -1], up: [0, 1, 0] } } };
export const rigSail = readGLB(partGLB("rig").bytes).extras;

export const near = (a, b, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
export function nearDeep(a, b, digits = 6) {
  if (typeof a === "number") return expect(a).toBeCloseTo(b, digits);
  if (Array.isArray(a)) return a.forEach((v, i) => nearDeep(v, b[i], digits));
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(a)) nearDeep(a[k], b[k], digits);
}

/** A point in the stock hull's frame, in the quarter-turned one's. */
export const quarter = ([x, y, z]) => [-z, y, x];
