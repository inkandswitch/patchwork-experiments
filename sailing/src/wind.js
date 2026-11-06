// The true wind over the water: a base speed and direction (the doc's), with
// gusts and veers from smooth deterministic noise. Pure.
//
// The noise is frozen turbulence carried downwind at the wind's own speed
// (Taylor's hypothesis), slowly changing as it goes, so a gust is a patch of
// stronger air you can watch cross the water toward you, and every peer
// that asks about (x, z, t) gets the same answer.

/** A seed (number or string) as a uint32. */
export function seedOf(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0 || 1;
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0 || 1;
}

/** mulberry32: a small, good, seeded PRNG giving [0, 1). */
export function prng(seed) {
  let a = seedOf(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The unit vector (x, z) a wind from `from` degrees blows toward: from 0 (north, −Z) toward +Z, from 90 (east) toward −X. */
export function downwind(from) {
  const a = ((Number(from) || 0) * Math.PI) / 180;
  return [-Math.sin(a), Math.cos(a)];
}

// how big a gust is (m) and how long one lasts (s)
const GUST_SIZE = 260;
const GUST_LIFE = 45;
// at gustiness 0.3: speed ±30%, direction ± ~10°
const VEER = ((10 / 0.3) * Math.PI) / 180;

/** A lattice value in [−1, 1] for integer (i, j, k) and a seed. */
function lattice(i, j, k, seed) {
  let h = seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483647.5 - 1;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 3D value noise in [−1, 1]: quintic interpolation of lattice values. */
export function valueNoise(x, y, z, seed) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (di, dj, dk) => lattice(i + di, j + dj, k + dk, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Two octaves of value noise, scaled back to about [−1, 1] and held to it, so gustiness bounds the gusts. */
function gustNoise(x, y, z, seed) {
  const n = (valueNoise(x, y, z, seed) + 0.5 * valueNoise(x * 2.03 + 17.1, y * 2.03 - 5.3, z * 2.03 + 9.7, seed ^ 0x5bd1e995)) / 1.1;
  return Math.max(-1, Math.min(1, n));
}

/**
 * The wind.
 * @param {{ speed?: number, from?: number, seed?: number|string, gustiness?: number }} o
 *   speed m/s, from degrees (the compass direction it blows from), gustiness 0..1
 */
export function createWind({ speed = 0, from = 0, seed = 1, gustiness = 0.3 } = {}) {
  const base = Math.max(0, Number(speed) || 0);
  const g = Math.min(1, Math.max(0, Number(gustiness ?? 0.3)));
  const [dx, dz] = downwind(from);
  const sSeed = seedOf(seed);
  const vSeed = (sSeed ^ 0x68e31da4) >>> 0 || 1;

  /** The true wind's velocity [vx, vz] (m/s) at world (x, z), t. Writes into `out` when given. */
  function at(x, z, t, out = [0, 0]) {
    if (base <= 0) {
      out[0] = out[1] = 0;
      return out;
    }
    // the gust field, carried downwind with the mean wind
    const px = (x - dx * base * t) / GUST_SIZE;
    const pz = (z - dz * base * t) / GUST_SIZE;
    const pt = t / GUST_LIFE;
    const s = base * Math.max(0, 1 + g * gustNoise(px, pz, pt, sSeed));
    const a = g * VEER * gustNoise(px * 0.7, pz * 0.7, pt * 0.8, vSeed);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    out[0] = s * (dx * c - dz * sn);
    out[1] = s * (dx * sn + dz * c);
    return out;
  }

  return { speed: base, from: Number(from) || 0, gustiness: g, at };
}
