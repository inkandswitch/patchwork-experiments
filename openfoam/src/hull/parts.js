// A model's named parts, and which of them make the hull. Pure.
//
// A real model is more than a hull: Jim's 37 ft Daysailor (Rhino) carries
// the rig, the sails, a dodger, three thousand pieces of deck hardware, and a
// "Water" plane 880 m across at the design waterline. A resistance analysis
// wants what meets the water. So by default the hull is every part that
// reaches the waterline or below, and a part that looks like a water plane
// (flat, horizontal, far wider than the rest) is never hull: it says where
// the waterline is instead.
//
// Frames: triangles here are in the floating frame as read (metres, z up).
// The case also says which way the bow points; a hull drawn bow-to-−x is
// turned a half-turn about z (x, y → −x, −y, which keeps it right-handed).

/**
 * Each distinct part name's extent and size.
 * @param {Float64Array} tris  9 numbers a triangle
 * @param {{ name: string, from: number, to: number }[]} ranges
 * @returns {{ name: string, triangles: number, min: number[], max: number[], flat: boolean }[]}
 */
export function partsOf(tris, ranges) {
  const by = new Map();
  for (const r of ranges ?? []) {
    let p = by.get(r.name);
    if (!p) by.set(r.name, (p = { name: r.name, triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    p.triangles += r.to - r.from;
    for (let i = r.from * 9; i < r.to * 9; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = tris[i + k];
        if (v < p.min[k]) p.min[k] = v;
        if (v > p.max[k]) p.max[k] = v;
      }
  }
  const out = [...by.values()].filter((p) => p.triangles > 0);
  for (const p of out) {
    const span = Math.max(p.max[0] - p.min[0], p.max[1] - p.min[1]);
    p.flat = span > 0 && p.max[2] - p.min[2] <= 1e-6 * span;
  }
  return out;
}

/**
 * Parts that look like a water plane: flat, horizontal, and more than three
 * times as long as everything else together. Their z is a waterline.
 */
export function waterPlanes(parts) {
  return parts.filter((p) => {
    if (!p.flat) return false;
    const rest = parts.filter((q) => q !== p && !q.flat);
    if (!rest.length) return false;
    const lo = Math.min(...rest.map((q) => q.min[0])), hi = Math.max(...rest.map((q) => q.max[0]));
    return p.max[0] - p.min[0] > 3 * (hi - lo);
  });
}

/**
 * The parts a resistance analysis wants by default, by a rule you can check
 * by eye. L is the length of what is wet (the parts reaching below the
 * waterline, rig aside). A part is hull unless it is a water plane or TALL
 * (rising more than L/2 above the waterline: a mast, a sail), and if either
 *   it meets the waterline band: its lowest point within 0.02 L above it
 *     (Jim's Daysailor splits its hull 3 cm above the waterline), or
 *   it is LONG and LOW: at least 0.8 L long, its lowest point within 0.1 L
 *     above the waterline (topsides, a deck: the hull's own skin).
 * Short things on deck (hardware, a dodger, a hatch) are left out. If nothing
 * is wet (a model floating clear of its waterline), all but the water planes.
 */
export function defaultParts(parts, waterZ = 0) {
  const water = new Set(waterPlanes(parts).map((p) => p.name));
  const candidates = parts.filter((p) => !water.has(p.name));
  const below = candidates.filter((p) => p.min[2] <= waterZ + 1e-9);
  if (!below.length) return candidates.map((p) => p.name);
  // the length of what's wet, the rig aside (a mast heel steps below the waterline)
  const rough = Math.max(...below.map((p) => p.max[0])) - Math.min(...below.map((p) => p.min[0]));
  const tall = (p) => p.max[2] > waterZ + 0.5 * rough;
  const wet = below.filter((p) => !tall(p));
  const pool = wet.length ? wet : below;
  const L = Math.max(...pool.map((p) => p.max[0])) - Math.min(...pool.map((p) => p.min[0])) || rough;
  return candidates
    .filter((p) => !(p.max[2] > waterZ + 0.5 * L))
    .filter((p) => p.min[2] <= waterZ + 0.02 * L || (p.max[0] - p.min[0] >= 0.8 * L && p.min[2] <= waterZ + 0.1 * L))
    .map((p) => p.name);
}

/**
 * The selected parts' triangles, in the frame the analysis wants: turned so
 * the bow is to +x, and raised or lowered so the waterline is at z = 0.
 * @param {"+x"|"-x"} bow
 */
export function hullTriangles(tris, ranges, names, { bow = "+x", waterZ = 0 } = {}) {
  const want = new Set(names);
  let n = 0;
  for (const r of ranges) if (want.has(r.name)) n += r.to - r.from;
  const out = new Float64Array(n * 9);
  const s = bow === "-x" ? -1 : 1;
  let o = 0;
  for (const r of ranges) {
    if (!want.has(r.name)) continue;
    for (let i = r.from * 9; i < r.to * 9; i += 3) {
      out[o++] = s * tris[i];
      out[o++] = s * tris[i + 1];
      out[o++] = tris[i + 2] - waterZ;
    }
  }
  return out;
}

/** The inverse of hullTriangles' frame, for drawing results back onto the model: analysis (x, y, z) → model's. */
export function toModelFrame([x, y, z], { bow = "+x", waterZ = 0 } = {}) {
  const s = bow === "-x" ? -1 : 1;
  return [s * x, s * y, z + waterZ];
}
