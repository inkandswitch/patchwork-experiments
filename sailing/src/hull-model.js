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
 *   rudder: { area: number, at: number[], maxDeg?: number },
 *   cg?: number,
 *   center?: number[],
 *   rig?: object,
 * }} ShipSpec
 * `cg` is the body y of the centre of gravity (ballast puts it below the
 * waterline); `center` is the body [x, z] the hull is centred on. Both are
 * optional: the hull's box supplies them when there is one. `rig` is a rig
 * contract in the body frame (rig-contract.js bodyRig), from specFor's
 * contract path only: with it, physics.js takes her CG, inertia, keel,
 * rudder (and `rudder.maxDeg`), crew, resistance and canoe body's side
 * force from the contract, and buildHull her columns from her own hull
 * (`rig.mesh`, her drawn one, else `rig.hull.form`, the one it describes).
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
  if (spec.rig?.hull?.form) return contractHull(spec);
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

// ─── her own hull: a rig contract's (DESIGN.md, "The rig contract") ─────
// A ship whose spec carries a rig contract (spec.rig) floats on columns cast
// from her own hull: the drawn mesh when the sim has it and it is the hull
// the rig was designed on (spec.rig.mesh, body-frame triangles), else the
// hull the contract describes (§3.3), built as the rig aid builds a
// synthetic hull from principal dimensions (its synthetic-hull.js, copied:
// super-ellipse sections fitted to Cm along a sectional-area curve fitted to
// Cp and LCB, topsides straight to a flat sheer). For a rig designed on a
// synthetic hull that is the very hull the aid analysed; for one designed
// on a drawn hull it is that hull's Cp, Cm, LCB, Tc, BWL and ∇ with its
// transverse waterplane inertia (BM) fitted, a stand-in where the mesh isn't
// to hand. Every other ship's hull is buildHull's, unchanged.

/**
 * Columns along her (rows) and across each row: across the waterline, and
 * out over the flare on each side; 120 in all. Measured against the four
 * synthetic fixtures' righting curves (5°–30°): 14 × (6 + 2·1) was off by
 * up to 13% at 20° (one column over the flare wets late), 12 × (6 + 2·2)
 * is within 7%, and more rows or columns gain a point or two.
 */
export const CONTRACT_COLUMNS = Object.freeze({ rows: 12, across: 6, flare: 2 });

/** Γ(x), x > 0 (Lanczos, g = 7). */
function gamma(x) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** The super-ellipse exponent n whose half-section fills cm of its box: Γ(1+1/n)²/Γ(1+2/n) = cm. */
export function exponentForCm(cm) {
  const coeff = (n) => gamma(1 + 1 / n) ** 2 / gamma(1 + 2 / n);
  let lo = 0.5, hi = 200;
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi);
    if (coeff(mid) < cm) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** Fore and aft exponents of the sectional-area curve 1 − |u|^p for a prismatic cp and an LCB at lcbFrac·LWL from mid-LWL (+ forward). */
export function fitSAC(cp, lcbFrac) {
  const sum = 2 * cp;
  const lcbOf = (af) => {
    const aa = sum - af;
    return (af / (2 * (2 - af)) - aa / (2 * (2 - aa))) / sum / 2;
  };
  let lo = Math.max(1e-6, sum - 0.999999);
  let hi = Math.min(0.999999, sum - 1e-6);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (lcbOf(mid) < lcbFrac) lo = mid;
    else hi = mid;
  }
  const af = 0.5 * (lo + hi);
  const aa = sum - af;
  return { pFwd: af / (1 - af), pAft: aa / (1 - aa) };
}

// the rig aid's SYNTH_DEFAULTS that shape what the principal dimensions don't say
const TRANSOM_HALF_BEAM = 0.75;
const TRANSOM_HEIGHT = 0.25;
const ALPHA = 0.6; // half-breadth takes f^α of the section's area, depth f^(1−α)

/**
 * The hull a contract describes (§3.3: rig-contract.js bodyRig's hull.form,
 * in the contract's own axes, x forward, y port, z up, from mid-LWL on the
 * waterplane), as triangles in the body frame (x starboard, y up, z aft),
 * its underwater depth scaled so it displaces exactly `form.volume`, as the
 * aid's is. `alpha` is how the section's area splits between half-breadth
 * and depth: the aid's 0.6 for a synthetic hull; for a drawn one, fitted so
 * the waterplane's transverse inertia is the contract's (its BM).
 * @returns {{ triangles: Float64Array, alpha: number, depthScale: number }}
 */
export function contractHullTriangles(form, { stations = 48, girth = 12, topsides = 3, overhangStations = 6 } = {}) {
  const { lwl: L, bwl: B, tc: T0, volume: V, cp, cm, lcbFrac, xMid } = form;
  const n = exponentForCm(cm);
  const { pFwd, pAft } = fitSAC(cp, lcbFrac);
  const f = (x) => {
    const u = (2 * x) / L;
    if (u >= 1 || u <= -1) return 0;
    return u >= 0 ? 1 - Math.pow(u, pFwd) : 1 - Math.pow(-u, pAft);
  };
  let alpha = ALPHA;
  if (form.prov !== "synthetic" && form.inertiaT > 0) {
    // ∫ (2/3)(B/2 · f^α)³ dx is the waterplane's transverse inertia; α ↦ it falls as α grows
    const it = (a) => {
      let s = 0;
      const m = 400;
      for (let i = 0; i < m; i++) s += Math.pow(f(-L / 2 + ((i + 0.5) * L) / m), 3 * a);
      return (2 / 3) * (B / 2) ** 3 * s * (L / m);
    };
    let lo = 0.1, hi = 1.5;
    if (it(lo) < form.inertiaT) alpha = lo;
    else if (it(hi) > form.inertiaT) alpha = hi;
    else {
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (it(mid) > form.inertiaT) lo = mid;
        else hi = mid;
      }
      alpha = 0.5 * (lo + hi);
    }
  }
  const fb = Math.max(0.01 * L, form.freeboard);
  const beam = Math.max(form.beam, B);
  const xStem = Math.max(L / 2, form.xStem);
  const xStern = Math.min(-L / 2, form.xStern);
  const zTransom = TRANSOM_HEIGHT * fb;
  const sheerHalf = (x) => {
    const half = beam / 2;
    if (x >= 0) {
      const v = Math.min(1, x / (xStem || 1));
      return half * Math.sqrt(Math.max(0, 1 - v * v));
    }
    const v = Math.min(1, x / (xStern || -1));
    return half * (1 - (1 - TRANSOM_HALF_BEAM) * v * v);
  };
  const xs = [];
  if (xStern < -L / 2) for (let i = 0; i < overhangStations; i++) xs.push(xStern + ((-L / 2 - xStern) * i) / overhangStations);
  for (let i = 0; i <= stations; i++) xs.push(-L / 2 + (L * i) / stations);
  if (xStem > L / 2) for (let i = 1; i <= overhangStations; i++) xs.push(L / 2 + ((xStem - L / 2) * i) / overhangStations);

  const loops = xs.map((x) => {
    const fx = f(x);
    const bw = (B / 2) * Math.pow(fx, alpha);
    const t = T0 * Math.pow(fx, 1 - alpha);
    const wet = fx > 0;
    const zk = wet ? -t : x > 0 ? (fb * (x - L / 2)) / Math.max(1e-9, xStem - L / 2) : (zTransom * (-L / 2 - x)) / Math.max(1e-9, -L / 2 - xStern);
    const bs = Math.max(sheerHalf(x), bw);
    const port = [];
    for (let i = 1; i <= girth; i++) {
      const th = ((i / girth) * Math.PI) / 2;
      port.push(wet ? [bw * Math.pow(Math.sin(th), 2 / n), -t * Math.pow(Math.cos(th), 2 / n)] : [0, zk]);
    }
    const [y0, z0] = wet ? [bw, 0] : [0, zk];
    for (let i = 1; i <= topsides; i++) port.push([y0 + ((bs - y0) * i) / topsides, z0 + ((fb - z0) * i) / topsides]);
    const loop = [[x, 0, zk], ...port.map(([y, z]) => [x, y, z])];
    for (let i = port.length - 1; i >= 0; i--) loop.push([x, -port[i][0], port[i][1]]);
    return loop;
  });

  const out = [];
  const push = (p, q, r) => out.push(...p, ...q, ...r);
  const m = loops[0].length;
  for (let s = 0; s + 1 < loops.length; s++) {
    const A = loops[s], Bn = loops[s + 1];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      push(A[k], A[k2], Bn[k2]);
      push(A[k], Bn[k2], Bn[k]);
    }
  }
  for (const [loop, flip] of [
    [loops[0], false],
    [loops[loops.length - 1], true],
  ]) {
    const c = loop.reduce((s, p) => [s[0] + p[0] / m, s[1] + p[1] / m, s[2] + p[2] / m], [0, 0, 0]);
    for (let k = 0; k < m; k++) {
      const p = loop[k], q = loop[(k + 1) % m];
      if (flip) push(c, p, q);
      else push(c, q, p);
    }
  }
  // displace exactly ∇: scale the depth of everything below the waterplane (the aid's last step)
  const tri = Float64Array.from(out);
  let v6 = 0;
  for (let i = 0; i < tri.length; i += 9) {
    if (tri[i + 2] > 1e-12 || tri[i + 5] > 1e-12 || tri[i + 8] > 1e-12) continue;
    const ux = tri[i + 3] - tri[i], uy = tri[i + 4] - tri[i + 1];
    const vx = tri[i + 6] - tri[i], vy = tri[i + 7] - tri[i + 1];
    v6 += (ux * vy - uy * vx) * (tri[i + 2] + tri[i + 5] + tri[i + 8]);
  }
  const vMesh = Math.abs(v6) / 6;
  const depthScale = vMesh > 0 ? V / vMesh : 1;
  for (let i = 2; i < tri.length; i += 3) if (tri[i] < 0) tri[i] *= depthScale;
  // into the body frame: (x, y, z) → (−y, z, −(x + xMid))
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    tri[i] = -y + 0;
    tri[i + 1] = z;
    tri[i + 2] = -(x + xMid) + 0;
  }
  return { triangles: tri, alpha, depthScale };
}

/**
 * Buoyancy columns cast down through a closed hull mesh (body-frame
 * triangles, 9 numbers each): `rows` stations along her length, each cut by
 * a plane across her; in each, `across` columns over the waterline's breadth
 * and `flare` more each side out to the widest the section goes (a section
 * that never reaches the waterline, an overhang, gets `across` over its
 * width). A column runs from the lowest surface it meets to the highest.
 * Columns are as buildHull's (x, z, bottom, top, vol, area, side, station),
 * the underwater depth scaled to displace `volume` at y = 0 when it's given
 * (the mesh's own ∇ otherwise): `scale` says by how much.
 */
export function meshColumns(tri, { rows = CONTRACT_COLUMNS.rows, across = CONTRACT_COLUMNS.across, flare = CONTRACT_COLUMNS.flare, volume = null, extra = 0 } = {}) {
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < tri.length; i += 3) {
    if (tri[i] < zMin) zMin = tri[i];
    if (tri[i] > zMax) zMax = tri[i];
  }
  const dl = (zMax - zMin) / rows;
  const segsOf = (zs) => {
    // the section at z = zs: each triangle crossing it leaves a segment (x0, y0, x1, y1)
    const segs = [];
    for (let i = 0; i < tri.length; i += 9) {
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = i + 3 * e, b = i + 3 * ((e + 1) % 3);
        const za = tri[a + 2] - zs, zb = tri[b + 2] - zs;
        if ((za < 0 && zb >= 0) || (za >= 0 && zb < 0)) {
          const t = za / (za - zb);
          pts.push(tri[a] + t * (tri[b] - tri[a]), tri[a + 1] + t * (tri[b + 1] - tri[a + 1]));
        }
      }
      if (pts.length === 4) segs.push(pts);
    }
    return segs;
  };
  const x = [], z = [], bottom = [], top = [], area = [], side = [], station = [];
  const stations = [];
  for (let r = 0; r < rows; r++) {
    const zs = zMin + (r + 0.5) * dl;
    const segs = segsOf(zs);
    let bs = 0, bw = 0;
    for (const [x0, y0, x1, y1] of segs) {
      bs = Math.max(bs, Math.abs(x0), Math.abs(x1));
      if ((y0 <= 0 && y1 >= 0) || (y0 >= 0 && y1 <= 0)) {
        const xc = y1 === y0 ? Math.max(Math.abs(x0), Math.abs(x1)) : Math.abs(x0 + ((0 - y0) / (y1 - y0)) * (x1 - x0));
        bw = Math.max(bw, xc);
      }
    }
    if (!(bs > 1e-6)) continue;
    // the columns across: [from, to] spans, each `count` wide
    const spans = bw > 1e-3 && bs - bw > 1e-3 && flare > 0 ? [[-bs, -bw, flare], [-bw, bw, across], [bw, bs, flare]] : [[-Math.max(bw, bs), Math.max(bw, bs), across]];
    const here = [];
    for (const [from, to, count] of spans) {
      const w = (to - from) / count;
      for (let j = 0; j < count; j++) {
        const xc = from + (j + 0.5) * w;
        let lo = Infinity, hi = -Infinity;
        for (const [x0, y0, x1, y1] of segs) {
          if ((x0 - xc) * (x1 - xc) > 0 || x0 === x1) continue;
          const y = y0 + ((xc - x0) / (x1 - x0)) * (y1 - y0);
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
        if (!(hi - lo > 1e-6)) continue;
        here.push({ xc, lo, hi, a: w * dl });
      }
    }
    if (!here.length) continue;
    const st = stations.length;
    let deepest = 0;
    for (const c of here) {
      x.push(c.xc);
      z.push(zs);
      bottom.push(c.lo);
      top.push(c.hi);
      area.push(c.a);
      side.push(dl / here.length);
      station.push(st);
      deepest = Math.min(deepest, c.lo);
    }
    stations.push([0, deepest / 2, zs]);
  }
  // her displacement at y = 0
  let v0 = 0;
  for (let i = 0; i < x.length; i++) v0 += area[i] * Math.max(0, Math.min(0, top[i]) - bottom[i]);
  const scale = volume > 0 && v0 > 0 ? volume / v0 : 1;
  if (scale !== 1) {
    for (let i = 0; i < x.length; i++) {
      if (bottom[i] < 0) bottom[i] *= scale;
      if (top[i] < 0) top[i] *= scale;
    }
    for (const s of stations) s[1] *= scale;
  }
  const n = x.length;
  const cols = {
    n,
    x: new Float64Array(n + extra),
    z: new Float64Array(n + extra),
    bottom: new Float64Array(n + extra),
    top: new Float64Array(n + extra),
    vol: new Float64Array(n + extra),
    area: new Float64Array(n + extra),
    side: new Float64Array(n + extra),
    station: new Int16Array(n + extra).fill(-1),
  };
  for (let i = 0; i < n; i++) {
    cols.x[i] = x[i];
    cols.z[i] = z[i];
    cols.bottom[i] = bottom[i];
    cols.top[i] = top[i];
    cols.area[i] = area[i];
    cols.vol[i] = area[i] * (top[i] - bottom[i]);
    cols.side[i] = side[i];
    cols.station[i] = station[i];
  }
  return { cols, stations, scale, volume0: v0 };
}

/**
 * The volume below y = 0 of a closed body-frame mesh (by the divergence
 * theorem over the faces wholly below it, plus the waterplane's cut faces
 * clipped: here the faces are clipped to y ≤ 0 one by one).
 */
export function meshVolumeBelow(tri) {
  let v6 = 0;
  const p = [];
  for (let i = 0; i < tri.length; i += 9) {
    // clip the triangle to y ≤ 0 (Sutherland–Hodgman against one plane), then fan it
    p.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = i + 3 * e, b = i + 3 * ((e + 1) % 3);
      const ya = tri[a + 1], yb = tri[b + 1];
      if (ya <= 0) p.push([tri[a], ya, tri[a + 2]]);
      if ((ya < 0 && yb > 0) || (ya > 0 && yb < 0)) {
        const t = ya / (ya - yb);
        p.push([tri[a] + t * (tri[b] - tri[a]), 0, tri[a + 2] + t * (tri[b + 2] - tri[a + 2])]);
      }
    }
    for (let k = 1; k + 1 < p.length; k++) {
      const [a, b, c] = [p[0], p[k], p[k + 1]];
      // ∫ y n_y dA: twice the projected area onto xz times the mean y
      const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
      v6 += (uz * vx - ux * vz) * (a[1] + b[1] + c[1]);
    }
  }
  return Math.abs(v6) / 6;
}

/**
 * buildHull for a ship with a rig contract: columns from her own hull (the
 * drawn mesh, spec.rig.mesh, or the contract's: contractHullTriangles),
 * scaled to displace the contract's ∇ at y = 0, plus one column for each
 * appendage's own buoyancy at its volume's centroid (the aid's righting
 * curve floats the canoe body at ∇ − ∇_app and adds them, §3.4). She floats
 * displacing her mass (restVolume), a touch above her lines by what the
 * appendages carry. `cb` is the canoe body's, at y = 0 (the contract's LCB).
 */
function contractHull(spec) {
  const rig = spec.rig;
  const form = rig.hull.form;
  const fromMesh = rig.mesh?.triangles ?? null;
  const tri = fromMesh ?? contractHullTriangles(form).triangles;
  const apps = (rig.appendages ?? []).filter((a) => a.volumeM3 > 0 && a.volumeCentroidM);
  const { cols, stations } = meshColumns(tri, { volume: form.volume, extra: apps.length });
  let n = cols.n;
  let rest = 0, mx = 0, my = 0, mz = 0, total = 0, depth = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(0, Math.min(0, cols.top[i]) - cols.bottom[i]);
    const v = cols.area[i] * d;
    rest += v;
    mx += v * cols.x[i];
    my += v * (cols.bottom[i] + d / 2);
    mz += v * cols.z[i];
    total += cols.vol[i];
    depth = Math.max(depth, -cols.bottom[i]);
  }
  const canoe = rest;
  const cb = [mx / canoe, my / canoe, mz / canoe];
  for (const a of apps) {
    // a column with its middle at the volume's centroid, down to the foil's lowest point
    let low = Infinity;
    for (const p of Object.values(a.cornersM ?? {})) low = Math.min(low, p[1]);
    if (a.bulb) low = Math.min(low, a.bulb.centreM[1] - a.bulb.diameterM / 2);
    const cy = a.volumeCentroidM[1];
    if (!(low < cy)) low = cy - 0.05;
    const span = 2 * (cy - low);
    cols.x[n] = a.volumeCentroidM[0];
    cols.z[n] = a.volumeCentroidM[2];
    cols.bottom[n] = low;
    cols.top[n] = low + span;
    cols.area[n] = a.volumeM3 / span;
    cols.vol[n] = a.volumeM3;
    cols.side[n] = 0;
    cols.station[n] = -1;
    total += a.volumeM3;
    n++;
  }
  cols.n = n;
  return {
    cols,
    stations,
    depth,
    /** what she displaces afloat: her mass */
    restVolume: spec.mass / RHO,
    totalVolume: total,
    cb,
    /** the canoe body's displacement at y = 0 (the contract's ∇) */
    canoeVolume: canoe,
    wetted: form.wsa,
    keel: { z: spec.keel.z ?? cb[2], span: 0, aspect: 1 },
    mesh: fromMesh ? "drawn" : "contract",
  };
}
