// Boats moored along a harbour's floats: dressing, not data. Nobody maps
// which boat is in which slip, so a float's slips are filled by hash of
// its OSM id and the slip's index (the same boats every build): a slip
// every 12 m along each side, about two in three taken, each a troller
// (white, a wheelhouse aft of amidships, two trolling poles), a small
// seiner or crabber (white with a trim colour, the wheelhouse forward) or
// an aluminium sportfisher. Sizes are typical of a West Coast small-craft
// harbour; everything here is an assumption, and the layer says so.
//
// Pure.

import { len, dsin, dcos } from "./detmath.js";
import { hashString } from "./buildings.js";
import { kindOf } from "./structures.js";
import { soup, rgb } from "./shapes.js";
import { quadOut, quadUp, triOut } from "./buildings.js";

export const BOATS = Object.freeze({
  troller: { length: [10, 13], beam: 0.32, hull: "#f0f0ec", trim: ["#3f5b45", "#8e2f27", "#2f3e55"], house: { at: 0.42, length: 0.25, height: 2.2 }, poles: true },
  seiner: { length: [12, 16], beam: 0.33, hull: "#f0f0ec", trim: ["#8e2f27", "#2f3e55", "#3e7a78", "#c49a3a"], house: { at: 0.68, length: 0.28, height: 2.6 } },
  sportfisher: { length: [6, 8.5], beam: 0.36, hull: "#c9ccce", trim: ["#2b2c2e"], house: { at: 0.55, length: 0.35, height: 1.6 } },
});
const MIX = [["troller", 35], ["seiner", 25], ["sportfisher", 40]];

/** The boats along every float (OSM `man_made=pier` + `floating=yes`) with a point inside: [{ id, type, x, z, heading, length, beam, trim }]. */
export function mooredBoats(structures, { inside = () => true, every = 12, taken = 0.65 } = {}) {
  const out = [];
  for (const st of structures) {
    if (kindOf(st) !== "float" || st.area || !st.points.some(([x, z]) => inside(x, z))) continue;
    const width = st.width > 0 && st.width < 50 ? st.width : 2.4;
    let slot = 0;
    for (let q = 0; q + 1 < st.points.length; q++) {
      const [ax, az] = st.points[q], [bx, bz] = st.points[q + 1];
      const L = len(bx - ax, bz - az);
      if (L < every) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let d = every / 2; d + every / 2 <= L; d += every, slot++) {
        for (const side of [-1, 1]) {
          const key = `${st.id}#${slot}${side > 0 ? "s" : "p"}`;
          if (hashString(key, 1) >= taken) continue;
          let u = hashString(key, 2) * 100, type = MIX[0][0];
          for (const [t, w] of MIX) {
            if (u < w) {
              type = t;
              break;
            }
            u -= w;
          }
          const B = BOATS[type];
          const length = B.length[0] + (B.length[1] - B.length[0]) * hashString(key, 3);
          const beam = B.beam * length;
          const off = width / 2 + beam / 2 + 0.4;
          const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
          if (!inside(x, z)) continue;
          // bow one way or the other along the float
          const heading = hashString(key, 4) < 0.5 ? Math.atan2(ux, -uz) : Math.atan2(-ux, uz);
          out.push({ id: key, type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, heading, length: Math.round(length * 100) / 100, beam: Math.round(beam * 100) / 100, trim: B.trim[Math.floor(hashString(key, 5) * B.trim.length)] });
        }
      }
    }
  }
  return out;
}

/** The boats as one flat-shaded soup. */
export function boatMesh(boats) {
  const s = soup();
  for (const b of boats) {
    const B = BOATS[b.type];
    const fx = dsin(b.heading), fz = -dcos(b.heading); // forward
    const rx = -fz, rz = fx; // starboard
    const at = (f, r, y) => [b.x + fx * f + rx * r, y, b.z + fz * f + rz * r];
    const Lh = b.length / 2, Bh = b.beam / 2, fb = 0.9, keel = -0.6;
    const hull = rgb(B.hull), trim = rgb(b.trim), deck = rgb("#8f8a80");
    // hull: a box aft, a wedge to the bow
    const sides = [[-Lh, -Bh], [Lh * 0.45, -Bh], [Lh, 0], [Lh * 0.45, Bh], [-Lh, Bh]];
    for (let k = 0; k < sides.length; k++) {
      const [f0, r0] = sides[k], [f1, r1] = sides[(k + 1) % sides.length];
      const out = at((f0 + f1) / 2 * 1.5, (r0 + r1) / 2 * 3, 0);
      quadOut(s, at(f0, r0, keel), at(f1, r1, keel), at(f1, r1, fb), at(f0, r0, fb), hull, out);
      quadOut(s, at(f0, r0, fb - 0.15), at(f1, r1, fb - 0.15), at(f1, r1, fb), at(f0, r0, fb), trim, [out[0], out[1] + 0.01, out[2]]);
    }
    quadUp(s, at(-Lh, -Bh, fb), at(Lh * 0.45, -Bh, fb), at(Lh * 0.45, Bh, fb), at(-Lh, Bh, fb), deck);
    triOut(s, at(Lh * 0.45, -Bh, fb), at(Lh, 0, fb), at(Lh * 0.45, Bh, fb), deck, at(Lh * 0.7, 0, fb + 5));
    // the wheelhouse
    const hc = -Lh + b.length * B.house.at, hl = (b.length * B.house.length) / 2, hw = Bh * 0.75, top = fb + B.house.height;
    const box = [[hc - hl, -hw], [hc + hl, -hw], [hc + hl, hw], [hc - hl, hw]];
    for (let k = 0; k < 4; k++) {
      const [f0, r0] = box[k], [f1, r1] = box[(k + 1) % 4];
      quadOut(s, at(f0, r0, fb), at(f1, r1, fb), at(f1, r1, top), at(f0, r0, top), hull, at(hc + ((f0 + f1) / 2 - hc) * 3, ((r0 + r1) / 2) * 3, fb));
    }
    quadUp(s, at(hc - hl, -hw, top), at(hc + hl, -hw, top), at(hc + hl, hw, top), at(hc - hl, hw, top), trim);
    // a troller's poles, raised, splayed a little
    if (B.poles) for (const r of [-1, 1]) {
      const base = at(hc, r * hw, top), tip = at(hc - 1, r * (hw + 1.6), top + b.length * 0.8);
      const w = 0.06;
      quadOut(s, [base[0] - w, base[1], base[2]], [base[0] + w, base[1], base[2]], [tip[0] + w, tip[1], tip[2]], [tip[0] - w, tip[1], tip[2]], rgb("#d8d6d0"), at(hc + 5, 0, top));
      quadOut(s, [base[0] + w, base[1], base[2]], [base[0] - w, base[1], base[2]], [tip[0] - w, tip[1], tip[2]], [tip[0] + w, tip[1], tip[2]], rgb("#d8d6d0"), at(hc - 5, 0, top));
    }
  }
  return s.done();
}
