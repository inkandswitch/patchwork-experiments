// Boats moored along a harbour's floats: dressing, not data. Nobody maps
// which boat is in which slip, so a float's slips are filled by hash of
// its OSM id and the slip's index (the same boats every build): a slip
// every 12 m along each side, about five in six taken, each a troller
// (white, a wheelhouse aft of amidships, two tall trolling poles raised in
// a V), a small seiner or crabber (white with a trim colour, the wheelhouse
// forward), an aluminium sportfisher or a cruising sailboat (a mast, a
// boom, on some a blue cover). Hulls rise to the bow, a dark boot stripe at
// the waterline. Sizes are typical of a West Coast small-craft
// harbour; everything here is an assumption, and the layer says so.
//
// Pure.

import { len, dsin, dcos } from "./detmath.js";
import { hashString } from "./buildings.js";
import { kindOf } from "./structures.js";
import { soup, rgb } from "./shapes.js";
import { quadOut, quadUp, triOut } from "./buildings.js";

export const BOATS = Object.freeze({
  troller: { length: [10, 13], beam: 0.32, hull: "#f0f0ec", trim: ["#3f5b45", "#8e2f27", "#2f3e55"], house: { at: 0.42, length: 0.25, height: 2.2 }, poles: true, sheer: 0.8, boot: "#7a2a24" },
  seiner: { length: [12, 16], beam: 0.33, hull: "#f0f0ec", trim: ["#8e2f27", "#2f3e55", "#3e7a78", "#c49a3a"], house: { at: 0.68, length: 0.28, height: 2.6 }, sheer: 0.9 },
  sportfisher: { length: [6, 8.5], beam: 0.36, hull: "#c9ccce", trim: ["#2b2c2e"], house: { at: 0.55, length: 0.35, height: 1.6 }, sheer: 0.35, boot: "#3a3d40" },
  // a cruising sailboat: a low coachroof, a mast about 1.3 times her length, a boom (a blue cover over it on some)
  sailboat: { length: [8, 12], beam: 0.32, hull: "#eeefec", trim: ["#1f4e79", "#2b2c2e", "#8e2f27"], house: { at: 0.45, length: 0.35, height: 0.7 }, mast: 1.3, freeboard: 0.8, sheer: 0.35, boot: "#1f3348" },
  // not moored by hash (MIX): placed about a harbour by a place's look
  whalewatch: { length: [10, 13], beam: 0.33, hull: "#eceeed", trim: ["#1f4e79", "#c8372d"], house: { at: 0.5, length: 0.5, height: 2.3 } },
  watertaxi: { length: [8, 10], beam: 0.35, hull: "#f2f2ef", trim: ["#c8372d", "#1f4e79"], house: { at: 0.58, length: 0.4, height: 1.9 } },
});
const MIX = [["troller", 30], ["seiner", 15], ["sportfisher", 25], ["sailboat", 30]];

/** The boats along every float (OSM `man_made=pier` + `floating=yes`) with a point inside: [{ id, type, x, z, heading, length, beam, trim }]. */
export function mooredBoats(structures, { inside = () => true, every = 12, taken = 0.85 } = {}) {
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

/** A boat's own hash in [0, 1) by its id and a seed. */
const own = (b, seed) => hashString(String(b.id), seed);

/** The boats as one flat-shaded soup. */
export function boatMesh(boats) {
  const s = soup();
  for (const b of boats) {
    const B = BOATS[b.type];
    const fx = dsin(b.heading), fz = -dcos(b.heading); // forward
    const rx = -fz, rz = fx; // starboard
    const at = (f, r, y) => [b.x + fx * f + rx * r, y, b.z + fz * f + rz * r];
    const Lh = b.length / 2, Bh = b.beam / 2, fb = B.freeboard ?? 0.9, keel = -0.6;
    const hull = rgb(B.hull), trim = rgb(b.trim), deck = rgb("#8f8a80"), boot = rgb(B.boot ?? "#2a2c2e");
    // hull: a box aft, a wedge to the bow, its sheer rising forward (the bow `sheer` above the stern)
    const sheer = B.sheer ?? 0.6;
    const topAt = (f) => fb + sheer * Math.max(0, (f + Lh) / (2 * Lh)) ** 2;
    const sides = [[-Lh, -Bh], [Lh * 0.45, -Bh], [Lh, 0], [Lh * 0.45, Bh], [-Lh, Bh]];
    for (let k = 0; k < sides.length; k++) {
      const [f0, r0] = sides[k], [f1, r1] = sides[(k + 1) % sides.length];
      const out = at(((f0 + f1) / 2) * 1.5, ((r0 + r1) / 2) * 3, 0);
      const t0 = topAt(f0), t1 = topAt(f1);
      quadOut(s, at(f0, r0, keel), at(f1, r1, keel), at(f1, r1, -0.05), at(f0, r0, -0.05), boot, out);
      // the boot stripe at the waterline, dark, a little proud of the hull
      quadOut(s, at(f0, r0, -0.05), at(f1, r1, -0.05), at(f1, r1, 0.28), at(f0, r0, 0.28), boot, out);
      quadOut(s, at(f0, r0, 0.28), at(f1, r1, 0.28), at(f1, r1, t1 - 0.15), at(f0, r0, t0 - 0.15), hull, out);
      quadOut(s, at(f0, r0, t0 - 0.15), at(f1, r1, t1 - 0.15), at(f1, r1, t1), at(f0, r0, t0), trim, [out[0], out[1] + 0.01, out[2]]);
    }
    const mid = topAt(Lh * 0.45);
    quadUp(s, at(-Lh, -Bh, topAt(-Lh)), at(Lh * 0.45, -Bh, mid), at(Lh * 0.45, Bh, mid), at(-Lh, Bh, topAt(-Lh)), deck);
    triOut(s, at(Lh * 0.45, -Bh, mid), at(Lh, 0, topAt(Lh)), at(Lh * 0.45, Bh, mid), deck, at(Lh * 0.7, 0, mid + 5));
    // the wheelhouse (a sailboat's coachroof): its walls the hull's colour, its roof the trim's, a dark band of windows
    const hc = -Lh + b.length * B.house.at, hl = (b.length * B.house.length) / 2, hw = Bh * 0.75, base = topAt(hc), top = base + B.house.height;
    const box = [[hc - hl, -hw], [hc + hl, -hw], [hc + hl, hw], [hc - hl, hw]];
    const glass = rgb("#26313a");
    for (let k = 0; k < 4; k++) {
      const [f0, r0] = box[k], [f1, r1] = box[(k + 1) % 4];
      const out = at(hc + ((f0 + f1) / 2 - hc) * 3, ((r0 + r1) / 2) * 3, base);
      quadOut(s, at(f0, r0, base), at(f1, r1, base), at(f1, r1, top), at(f0, r0, top), hull, out);
      if (B.house.height > 1.2) quadOut(s, at(f0, r0, top - 0.75), at(f1, r1, top - 0.75), at(f1, r1, top - 0.25), at(f0, r0, top - 0.25), glass, [out[0], out[1] + 0.01, out[2]].map((v, i) => v + [fx, 0, fz][i] * 0.001));
    }
    quadUp(s, at(hc - hl, -hw, top), at(hc + hl, -hw, top), at(hc + hl, hw, top), at(hc - hl, hw, top), trim);
    // a spar: two thin crossed quads, seen from any side
    const spar = (p0, p1, w, col) => {
      for (const [dx, dz] of [[w, 0], [0, w]]) {
        s.quad([p0[0] - dx, p0[1], p0[2] - dz], [p0[0] + dx, p0[1], p0[2] + dz], [p1[0] + dx, p1[1], p1[2] + dz], [p1[0] - dx, p1[1], p1[2] - dz], col);
        s.quad([p0[0] + dx, p0[1], p0[2] + dz], [p0[0] - dx, p0[1], p0[2] - dz], [p1[0] - dx, p1[1], p1[2] - dz], [p1[0] + dx, p1[1], p1[2] + dz], col);
      }
    };
    // a troller's poles, raised in a V from the wheelhouse's sides: each about 1.5 times her length, 20° out from upright
    if (B.poles) for (const r of [-1, 1]) {
      const p0 = at(hc, r * hw, top), pl = 1.5 * b.length;
      spar(p0, at(hc - 0.6, r * (hw + pl * 0.34), top + pl * 0.94), 0.06, rgb("#d8d6d0"));
    }
    // a sailboat's mast (about 1.3 times her length) and boom; some with a blue canvas cover over the boom
    if (B.mast) {
      const mf = hc + hl + 0.3, foot = topAt(mf), boomY = foot + 1.7;
      spar(at(mf, 0, foot), at(mf, 0, foot + B.mast * b.length), 0.07, rgb("#cfd1d2"));
      spar(at(mf, 0, boomY), at(-Lh * 0.8, 0, boomY - 0.1), 0.05, rgb("#bfc1c2"));
      if (own(b, 7) < 0.45) {
        const cover = rgb(own(b, 8) < 0.7 ? "#1f4e79" : "#2f5f8f"), half = 0.45;
        const a0 = at(mf - 0.2, 0, boomY + 0.25), a1 = at(-Lh * 0.75, 0, boomY + 0.15);
        for (const r of [-1, 1]) quadOut(s, a0, a1, at(-Lh * 0.75, r * half, boomY - 0.45), at(mf - 0.2, r * half, boomY - 0.4), cover, at((mf - Lh * 0.75) / 2, r * 3, boomY));
      }
    }
  }
  return s.done();
}
