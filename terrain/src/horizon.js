// The shore's shape as the water mirrors it (water/WATER.md, "The shore in
// the water"): from an eye over calm water, the reflection of the land is
// what a second eye as far under the water as the first is over it sees
// (the mirror's eye). For every azimuth round that eye and every distance
// bin, the highest the land (and the trees on it) stands above the mirror
// eye's horizontal, seen at that distance or beyond, how far off that
// highest point is, how far off the nearest land at or beyond it is, and how
// high that near shore stands (a ray under its top meets the near shore, one
// over it the far hills: the water fogs the shore's tint by which). The
// water's shader looks up its reflected ray there, at the distance of the
// water it is drawn for (the land nearer than that water is in front of it,
// not in it), and draws the shore's tint where the ray is under the land.
//
// Pure: a function of a surface sampler and an eye. The water reads it as a
// texture AZIMUTHS wide and BINS tall, four channels (radians, km, km, radians).

/** The profile's shape: azimuths round the eye, distance bins from `near` to `reach` metres (log-spaced). */
export const SHORE = Object.freeze({ azimuths: 256, bins: 16, near: 15, reach: 9000 });
/** What a bin holds where no land stands at that distance or beyond: an elevation no ray reaches. */
export const NO_LAND = -1.5;

/** Bin b's nearest distance (m): near·(reach/near)^(b/(bins−1)). */
export const binDistance = (b, o = SHORE) => o.near * (o.reach / o.near) ** (b / (o.bins - 1));
/** Azimuth a's direction in the frame, [x, z]: angle 2π(a + ½)/azimuths from +x toward +z (texel centres). */
export const azimuthDir = (a, o = SHORE) => {
  const t = (2 * Math.PI * (a + 0.5)) / o.azimuths;
  return [Math.cos(t), Math.sin(t)];
};
/** The distances a ray is sampled at (m): every `step` metres to 400 m, then every 1.2% of the way, to `reach`. */
export function marchDistances(o = SHORE, step = 5) {
  const out = [];
  for (let r = step; r <= o.reach; r += Math.max(step, r * 0.012)) out.push(r);
  return out;
}

/** How far past the nearest land the near shore's top is looked for (m): the near ridge a ray low over the water meets. */
export const NEAR_SHORE = 1000;

/**
 * The profile seen from `eye` ([x, y, z] in the frame) over water at
 * `level`: a Float32Array of bins × azimuths × 4, row b (a distance bin)
 * after row b − 1, each [the highest elevation (radians) from the mirror eye
 * of land at the bin's distance or beyond, that point's distance (km), the
 * nearest such land's distance (km), and the highest elevation of land
 * within NEAR_SHORE of that nearest (the near shore's top)]: a ray under the
 * near top meets the near shore, one over it the far hills.
 * `surfaceAt(x, z)` is the land's top there (ground and canopy), null off
 * the land's grid; heights at or under the level are water. `dirOf(a)`
 * turns azimuth a into the land's frame ([dx, dz]; by default the frame is
 * the land's), `toLand` the eye.
 */
export function horizonProfile(surfaceAt, eye, { level = 0, dirOf = null, toLand = null } = {}, o = SHORE) {
  const { azimuths: A, bins: B } = o;
  const out = new Float32Array(A * B * 4);
  const rs = marchDistances(o);
  const Q = rs.length;
  // each bin's first sample
  const startOf = Array.from({ length: B }, (_, b) => {
    const edge = binDistance(b, o);
    let q = 0;
    while (q < Q && rs[q] < edge) q++;
    return q;
  });
  // the mirror eye is as far under the water as the eye is over it (at least half a metre)
  const below = Math.max(0.5, eye[1] - level);
  const [ex, ez] = toLand ? toLand(eye[0], eye[2]) : [eye[0], eye[2]];
  const elev = new Float32Array(Q), sufBest = new Float32Array(Q + 1), sufAt = new Int32Array(Q + 1), nextLand = new Int32Array(Q + 1);
  for (let a = 0; a < A; a++) {
    const [dx, dz] = dirOf ? dirOf(a) : azimuthDir(a, o);
    for (let q = 0; q < Q; q++) {
      const h = surfaceAt(ex + dx * rs[q], ez + dz * rs[q]);
      elev[q] = h == null || h <= level ? NaN : Math.atan2(h - level + below, rs[q]);
    }
    // from each sample on: the highest land (and where), and the nearest land
    sufBest[Q] = NO_LAND;
    sufAt[Q] = -1;
    nextLand[Q] = -1;
    for (let q = Q - 1; q >= 0; q--) {
      const land = !Number.isNaN(elev[q]);
      // the nearest of equal highs
      if (land && elev[q] >= sufBest[q + 1]) (sufBest[q] = elev[q]), (sufAt[q] = q);
      else (sufBest[q] = sufBest[q + 1]), (sufAt[q] = sufAt[q + 1]);
      nextLand[q] = land ? q : nextLand[q + 1];
    }
    for (let b = 0; b < B; b++) {
      const q0 = startOf[b], f = nextLand[q0];
      let top = NO_LAND;
      if (f >= 0) for (let q = f; q < Q && rs[q] <= rs[f] + NEAR_SHORE; q++) if (elev[q] > top) top = elev[q];
      out.set([sufBest[q0], sufAt[q0] >= 0 ? rs[sufAt[q0]] / 1000 : 0, f >= 0 ? rs[f] / 1000 : 0, top], (b * A + a) * 4);
    }
  }
  return out;
}

/** Whether a profile made at `from` still serves an eye at `eye`: within `move` metres across and its height above the level within a fifth (or 2 m). */
export function stillServes(from, eye, { level = 0, move = 25 } = {}) {
  if (!from) return false;
  const h0 = from[1] - level, h1 = eye[1] - level;
  return Math.hypot(eye[0] - from[0], eye[2] - from[2]) <= move && Math.abs(h1 - h0) <= Math.max(2, 0.2 * Math.max(h0, h1));
}
