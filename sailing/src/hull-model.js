// The hull as physics sees it: the default sloop's numbers, a spec scaled
// from any object's box, and the underwater body sampled as columns. Pure.
//
// Body frame: bow toward −Z, starboard +X, up +Y, the waterline at y = 0.

const RHO = 1025;

/**
 * @typedef {{
 *   length: number, beam: number, draft: number, freeboard: number, mass: number,
 *   sail: { area: number, luff: number, foot: number, tack: number[] },
 *   keel: { area: number, depth: number, z?: number },
 *   rudder: { area: number, at: number[] },
 *   cg?: number,
 *   center?: number[],
 * }} ShipSpec
 * `cg` is the body y of the centre of gravity (ballast puts it below the
 * waterline); `center` is the body [x, z] the hull is centred on. Both are
 * optional: the hull's box supplies them when there is one.
 */

/** A 12 m sloop: the boat everything else is scaled from. */
export const SLOOP = Object.freeze({
  length: 12,
  beam: 3.8,
  draft: 1.9,
  freeboard: 1.2,
  mass: 8000,
  cg: -0.3,
  center: Object.freeze([0, 0]),
  // the mast a third back from the bow; the centre of effort is a third up the luff
  sail: Object.freeze({ area: 55, luff: 13, foot: 4.5, tack: Object.freeze([0, 1.4, -1.2]) }),
  keel: Object.freeze({ area: 2.5, depth: 1.2 }),
  rudder: Object.freeze({ area: 0.6, at: Object.freeze([0, -0.8, 5.2]) }),
});

/** `over` laid over `base`, one level into the sail, keel and rudder. */
export function mergeSpec(base, over = {}) {
  const o = over ?? {};
  return {
    ...base,
    ...o,
    sail: { ...base.sail, ...o.sail },
    keel: { ...base.keel, ...o.keel },
    rudder: { ...base.rudder, ...o.rudder },
  };
}

/**
 * A spec for any object from its body box ({ min, max }, y = 0 at the
 * waterline), so whatever carries `sailing.ship` can sail: the sloop's
 * numbers scaled by the box's length, with a keel only as deep as the box
 * goes. `overrides` (the trait's spec) win.
 * @param {{ min: number[], max: number[] }} box
 * @param {Partial<ShipSpec>} [overrides]
 * @returns {ShipSpec}
 */
export function specFromBox(box, overrides) {
  const { min, max } = box;
  const length = Math.max(0.5, max[2] - min[2]);
  const beam = Math.max(0.2, max[0] - min[0]);
  const draft = Math.max(0.05, -min[1]);
  const freeboard = Math.max(0.1, max[1]);
  const k = length / SLOOP.length;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  // a shallow box has a shallow keel, and less of it
  const deep = Math.min(1, draft / (SLOOP.draft * k));
  const s = SLOOP;
  return mergeSpec(
    {
      length,
      beam,
      draft,
      freeboard,
      // as heavy as the sloop would be at this size, lighter if it is shallower or narrower
      mass: s.mass * k * (beam / s.beam) * (draft / s.draft),
      cg: s.cg * (draft / s.draft),
      center: [cx, cz],
      sail: {
        area: s.sail.area * k * k,
        luff: s.sail.luff * k,
        foot: s.sail.foot * k,
        tack: [cx, freeboard + (s.sail.tack[1] - s.freeboard) * k, cz + s.sail.tack[2] * k],
      },
      keel: { area: s.keel.area * k * k * deep, depth: draft * (s.keel.depth / s.draft) },
      rudder: {
        area: s.rudder.area * k * k * deep,
        at: [cx, Math.max(-draft, s.rudder.at[1] * k * deep), cz + s.rudder.at[2] * k],
      },
    },
    overrides,
  );
}

const N_LONG = 14;
const N_TRANS = 5;

/**
 * The waterplane's half-width as a fraction of the widest, from the bow
 * (p = 0) to the stern (p = 1): a fine entry, the widest point just aft of
 * the middle, a transom 60% as wide.
 */
export function widthAt(p) {
  if (p < 0.55) return Math.pow(Math.sin((Math.PI / 2) * (p / 0.55)), 0.7);
  const s = (p - 0.55) / 0.45;
  return 1 - 0.4 * s * s;
}

/** The canoe body's depth as a fraction of its deepest, shallowing toward both ends. */
export function depthAt(p) {
  return Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * p)), 0.6);
}

/**
 * The hull sampled for buoyancy: vertical columns over the waterplane, each
 * from the hull's bottom up to the deck, plus one for the keel fin. The
 * canoe body is as deep as it has to be for `mass` to float with its
 * waterline at y = 0, so any spec floats on its lines.
 *
 * Columns are in body coordinates: `x`, `z` the column's place, `bottom`
 * and `top` its ends, `vol` its whole volume, `area` its plan area, `side`
 * its share of the hull's lateral area per metre submerged, `station` the
 * row of columns abreast it belongs to, or −1 for the keel (whose water
 * forces are the keel foil's). `stations` are where each row samples the
 * water's motion: on the centreline, half the canoe body's depth down.
 *
 * @param {ShipSpec} spec
 */
export function buildHull(spec) {
  const { length: L, beam, draft, freeboard, mass } = spec;
  const [cx, cz] = spec.center ?? [0, 0];
  const bow = cz - L / 2;
  const halfBeam = (beam * 0.8) / 2; // the topsides flare: the waterline is narrower than the deck
  const dl = L / N_LONG;
  const n = N_LONG * N_TRANS;

  const x = [], z = [], shape = [], area = [], side = [];
  let unit = 0, unitZ = 0;
  for (let i = 0; i < N_LONG; i++) {
    const p = (i + 0.5) / N_LONG;
    const hw = halfBeam * widthAt(p);
    for (let j = 0; j < N_TRANS; j++) {
      const u = -1 + (2 * j + 1) / N_TRANS;
      const a = ((2 * hw) / N_TRANS) * dl;
      // a round bilge: shallower toward the sides
      const s = depthAt(p) * Math.sqrt(1 - u * u);
      x.push(cx + u * hw);
      z.push(bow + p * L);
      shape.push(s);
      area.push(a);
      side.push(dl / N_TRANS);
      unit += a * s;
      unitZ += a * s * (bow + p * L);
    }
  }

  // the keel hangs under the canoe body's centre of buoyancy; its volume
  // depends on its span, which depends on how deep the canoe body is, so
  // settle the two together
  const keelZ = spec.keel.z ?? unitZ / unit;
  const keelRoot = depthAt(Math.min(1, Math.max(0, (keelZ - bow) / L)));
  const need = mass / RHO;
  let depth = need / unit;
  let span = 0, keelVol = 0;
  for (let k = 0; k < 4; k++) {
    span = Math.max(0, draft - depth * keelRoot);
    const chord = span > 0.05 ? Math.min(L / 2, spec.keel.area / span) : 0;
    // a 12% thick section, filling about two-thirds of its chord × thickness
    keelVol = span > 0.05 ? Math.min(0.3 * need, 0.08 * spec.keel.area * chord) : 0;
    depth = Math.min(draft, Math.max(0.02, (need - keelVol) / unit));
  }

  const cols = {
    n: n + (keelVol > 0 ? 1 : 0),
    x: new Float64Array(n + 1),
    z: new Float64Array(n + 1),
    bottom: new Float64Array(n + 1),
    top: new Float64Array(n + 1),
    vol: new Float64Array(n + 1),
    area: new Float64Array(n + 1),
    side: new Float64Array(n + 1),
    station: new Int16Array(n + 1).fill(-1),
  };
  let rest = 0, mx = 0, my = 0, mz = 0, canoe = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const d = depth * shape[i];
    cols.x[i] = x[i];
    cols.z[i] = z[i];
    cols.bottom[i] = -d;
    cols.top[i] = freeboard;
    cols.area[i] = area[i];
    cols.vol[i] = area[i] * (freeboard + d);
    cols.side[i] = side[i];
    cols.station[i] = Math.floor(i / N_TRANS);
    const v = area[i] * d;
    rest += v;
    mx += v * x[i];
    my += v * (-d / 2);
    mz += v * z[i];
    total += cols.vol[i];
  }
  canoe = rest;
  if (keelVol > 0) {
    const top = -depth * keelRoot;
    cols.x[n] = cx;
    cols.z[n] = keelZ;
    cols.bottom[n] = -draft;
    cols.top[n] = top;
    cols.area[n] = keelVol / span;
    cols.vol[n] = keelVol;
    rest += keelVol;
    mx += keelVol * cx;
    my += keelVol * ((top - draft) / 2);
    mz += keelVol * keelZ;
    total += keelVol;
  }

  const stations = [];
  for (let i = 0; i < N_LONG; i++) {
    const p = (i + 0.5) / N_LONG;
    stations.push([cx, (-depth * depthAt(p)) / 2, bow + p * L]);
  }

  return {
    cols,
    stations,
    /** the canoe body's deepest point below the waterline */
    depth,
    /** displaced volume floating at y = 0 (= mass / ρ unless the hull is too shallow to carry it) */
    restVolume: rest,
    /** the whole hull's volume up to the deck */
    totalVolume: total,
    /** centre of buoyancy at rest, body */
    cb: [mx / rest, my / rest, mz / rest],
    // Mumford's wetted area of the canoe body
    wetted: 1.7 * L * depth + canoe / depth,
    keel: { z: keelZ, span, aspect: span > 0.05 ? Math.max(0.5, (2 * span * span) / spec.keel.area) : 1 },
  };
}
