// Statics from a Chartroom hydrostatic-table v1: camber's, when its wrapper
// publishes one, or one this builds from any closed mesh. Pure; the table
// build runs in the worker (worker.js), the rest anywhere.
//
// Consumption follows the spec (chartroom formats/hydrostatic-table/v1/
// specification.md), cited by section:
// - §5 interpolate V and the first moment Q = V·B linearly (bilinearly across
//   heel and trim), never B; on a stored coordinate use that row only;
//   outside the sampled rectangle or any participating row's immersion range,
//   the reading is unavailable: no extrapolation, clamping or symmetry.
// - §4 optional waterplane properties use the same weights only when every
//   participant supplies them; a mixture is unavailable, all-null is null.
// - §9 GZ = −(R·(B − G)).y; KN with K in place of G; R = Rx(heel)·Ry(−trim).
// - §9 a 30° or 40° area needs coverage of the whole path; an unavailable
//   immersion angle is never shown as more than the last covered heel.
// - §8 a table is checked before it is used (validateTable).
// Every reading carries `available` and, when false, a `reason`.

import { cut, heightSpan, immerse, prepareMesh, rotationRows, sideView } from "./mesh-hydro.js";
import { FRAME_AXES, HYDROSTATIC_TABLE_FORMAT, MARKER_KINDS, TABLE_KEYS } from "./chartroom-types.js";

const RAD = Math.PI / 180;
const fin = Number.isFinite;
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every(fin);
const unavailable = (reason) => ({ available: false, reason });

// ───────────────────────────────── §8 validation

/**
 * Structural and semantic checks (spec §7, §8). Error codes match Chartroom's
 * fixture manifest where it names one.
 * @returns {{ ok: boolean, errors: { stage: "structural"|"semantic", code: string, message: string }[] }}
 */
export function validateTable(t) {
  const errors = [];
  const bad = (stage, code, message) => errors.push({ stage, code, message });
  if (!isObj(t)) return { ok: false, errors: [{ stage: "structural", code: "not-object", message: "not a JSON object" }] };
  for (const k of Object.keys(t)) if (!TABLE_KEYS.includes(k)) bad("structural", "unknown-field", `unknown field "${k}"`);
  if (t.format !== HYDROSTATIC_TABLE_FORMAT) bad("structural", "format", `format is not "${HYDROSTATIC_TABLE_FORMAT}"`);
  if (t.version !== 1) bad("structural", "version", `unsupported version ${JSON.stringify(t.version)}`);
  if (!isObj(t.frame) || t.frame.axes !== FRAME_AXES || !Array.isArray(t.frame.knReferenceM) || t.frame.knReferenceM.length !== 3 || t.frame.knReferenceM[1] !== 0 || !t.frame.knReferenceM.every(fin))
    bad("structural", "frame", "frame must state x-forward-y-port-z-up axes and a centreplane knReferenceM");
  if (!isObj(t.body) || t.body.buoyancyEnvelope !== "closed-watertight") bad("structural", "body", "body.buoyancyEnvelope must be closed-watertight");
  const rows = t.table?.rows;
  if (!isObj(t.table) || t.table.interpolation !== "linear" || !Array.isArray(rows) || rows.length < 1) {
    bad("structural", "table", "table must be linear with at least one row");
    return { ok: false, errors };
  }
  rows.forEach((r, i) => {
    if (!fin(r?.heelDeg) || r.heelDeg < -180 || r.heelDeg > 180) bad("structural", "heel", `row ${i}: heel out of [−180, 180]`);
    if (!fin(r?.trimDeg) || r.trimDeg <= -90 || r.trimDeg >= 90) bad("structural", "trim", `row ${i}: trim out of (−90, 90)`);
    if (!Array.isArray(r?.samples) || r.samples.length < 2) bad("structural", "samples", `row ${i}: fewer than two samples`);
    for (const [j, s] of (r?.samples ?? []).entries()) {
      if (!fin(s?.waterplaneOffsetM)) bad("structural", "offset", `row ${i} sample ${j}: offset is not a finite number`);
      if (!fin(s?.volumeM3) || s.volumeM3 < 0) bad("structural", "negative-volume", `row ${i} sample ${j}: volume must be a nonnegative number`);
      else if (s.volumeM3 === 0 && s.buoyancyCenterM !== null) bad("structural", "zero-volume-nonnull-center", `row ${i} sample ${j}: a dry sample's centre must be null`);
      else if (s.volumeM3 > 0 && !isPoint(s.buoyancyCenterM)) bad("structural", "positive-volume-null-center", `row ${i} sample ${j}: an immersed sample needs a finite centre`);
      if (s?.waterplane != null) {
        const w = s.waterplane;
        if (!fin(w.areaM2) || w.areaM2 <= 0) bad("structural", "waterplane-area", `row ${i} sample ${j}: waterplane area must be positive`);
        if (w.centroidM != null && !isPoint(w.centroidM)) bad("structural", "waterplane-centroid", `row ${i} sample ${j}: bad waterplane centroid`);
      }
    }
  });
  if (errors.some((e) => e.stage === "structural")) return { ok: false, errors };

  // semantic (§8)
  const keys = rows.map((r) => `${r.trimDeg}|${r.heelDeg}`);
  if (new Set(keys).size !== keys.length) bad("semantic", "duplicate-attitude", "two rows share a heel and trim");
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.trimDeg < a.trimDeg || (b.trimDeg === a.trimDeg && b.heelDeg <= a.heelDeg)) {
      if (keys[i] !== keys[i - 1]) bad("semantic", "row-order", "rows are not sorted by trim, then heel");
      break;
    }
  }
  const heels = [...new Set(rows.map((r) => r.heelDeg))];
  const trims = [...new Set(rows.map((r) => r.trimDeg))];
  if (new Set(keys).size !== heels.length * trims.length) bad("semantic", "complete-grid", "rows are not a complete heel × trim grid");
  rows.forEach((r, i) => {
    for (let j = 1; j < r.samples.length; j++) {
      if (!(r.samples[j].waterplaneOffsetM > r.samples[j - 1].waterplaneOffsetM)) {
        bad("semantic", "offset-order", `row ${i}: offsets don't strictly increase`);
        break;
      }
      if (r.samples[j].volumeM3 < r.samples[j - 1].volumeM3) {
        bad("semantic", "volume-order", `row ${i}: volume decreases`);
        break;
      }
    }
    const R = rotationRows(r.heelDeg, r.trimDeg);
    const n = R[2];
    for (const s of r.samples) {
      const c = s.waterplane?.centroidM;
      if (c) {
        const off = n[0] * c[0] + n[1] * c[1] + n[2] * c[2] - s.waterplaneOffsetM;
        if (Math.abs(off) > 1e-6 * Math.max(1, Math.abs(s.waterplaneOffsetM), Math.hypot(...c))) bad("semantic", "waterplane-centroid", `row ${i}: a waterplane centroid is off its plane by ${off.toExponential(2)} m`);
      }
      const m = s.waterplane?.secondMomentsM4;
      if (m && fin(m.xx) && fin(m.yy) && fin(m.xy)) {
        const scale = Math.max(m.xx, m.yy, Math.abs(m.xy), 1e-30);
        if (m.xx < -1e-9 * scale || m.yy < -1e-9 * scale || m.xx * m.yy - m.xy * m.xy < -1e-9 * scale * scale) bad("semantic", "waterplane-moments", `row ${i}: second moments are not positive semidefinite`);
      }
    }
  });
  if (t.referenceState) {
    const rs = t.referenceState;
    const inside = (axis, v) => v >= Math.min(...axis) && v <= Math.max(...axis);
    if (!inside(heels, rs.heelDeg) || !inside(trims, rs.trimDeg)) bad("semantic", "reference-domain", "the reference state's attitude is outside the table");
    else if (!interpolate(t, { heelDeg: rs.heelDeg, trimDeg: rs.trimDeg, h: rs.waterplaneOffsetM }, { trusted: true }).available)
      bad("semantic", "reference-domain", "the reference state's waterplane is outside the table's immersion range");
  }
  if (Array.isArray(t.immersionMarkers)) {
    const ids = t.immersionMarkers.map((m) => m?.id);
    if (new Set(ids).size !== ids.length) bad("semantic", "marker-ids", "immersion marker ids are not unique");
    for (const m of t.immersionMarkers) if (!MARKER_KINDS.includes(m?.kind)) bad("structural", "marker-kind", `marker "${m?.id}" has an unknown kind`);
  }
  return { ok: errors.length === 0, errors };
}

// ───────────────────────────────── §5 interpolation

const indexCache = new WeakMap();
/** Sorted heel and trim axes, and the rows by attitude. */
export function tableIndex(t) {
  let ix = indexCache.get(t);
  if (ix) return ix;
  const rows = t.table.rows;
  const heels = [...new Set(rows.map((r) => r.heelDeg))].sort((a, b) => a - b);
  const trims = [...new Set(rows.map((r) => r.trimDeg))].sort((a, b) => a - b);
  const byKey = new Map(rows.map((r) => [`${r.trimDeg}|${r.heelDeg}`, r]));
  ix = { heels, trims, row: (trim, heel) => byKey.get(`${trim}|${heel}`) };
  indexCache.set(t, ix);
  return ix;
}

/** [[index, weight], …] on a sorted axis, or null outside it. A stored coordinate uses that coordinate only. */
function bracket(axis, v) {
  const i = axis.indexOf(v);
  if (i >= 0) return [[i, 1]];
  if (!(v > axis[0] && v < axis[axis.length - 1])) return null;
  let k = 0;
  while (axis[k + 1] < v) k++;
  const s = (v - axis[k]) / (axis[k + 1] - axis[k]);
  return [
    [k, 1 - s],
    [k + 1, s],
  ];
}

/** The rows taking part at an attitude, with their weights; null outside the sampled rectangle. */
function participants(t, heelDeg, trimDeg) {
  const ix = tableIndex(t);
  const bh = bracket(ix.heels, heelDeg);
  const bt = bracket(ix.trims, trimDeg);
  if (!bh || !bt) return null;
  const out = [];
  for (const [ti, wt] of bt) for (const [hi, wh] of bh) out.push({ row: ix.row(ix.trims[ti], ix.heels[hi]), w: wt * wh });
  return out;
}

/** One row's samples at h, with their weights; null outside the row's immersion range. */
function rowBracket(row, h) {
  const s = row.samples;
  if (!(h >= s[0].waterplaneOffsetM && h <= s[s.length - 1].waterplaneOffsetM)) return null;
  const exact = s.find((x) => x.waterplaneOffsetM === h);
  if (exact) return [[exact, 1]];
  let k = 0;
  while (s[k + 1].waterplaneOffsetM < h) k++;
  const f = (h - s[k].waterplaneOffsetM) / (s[k + 1].waterplaneOffsetM - s[k].waterplaneOffsetM);
  return [
    [s[k], 1 - f],
    [s[k + 1], f],
  ];
}

/** Weighted sum of an optional property: a number, null (all null), or undefined (unknown / a mixture). */
function optional(parts, get) {
  let sum = 0, nulls = 0, n = 0;
  for (const [s, w] of parts) {
    const v = get(s);
    n++;
    if (v === null) nulls++;
    else if (fin(v)) sum += w * v;
    else return undefined;
  }
  if (nulls === n) return null;
  return nulls ? undefined : sum;
}

/**
 * The table's reading at an attitude and plane offset (§5).
 * @returns {{ available: true, volumeM3, buoyancyCenterM, waterplane, wettedAreaM2 } | { available: false, reason }}
 *   waterplane: { areaM2, centroidM?, secondMomentsM4: { xx?, xy?, yy? } } | null (known none) | undefined (unknown)
 */
export function interpolate(t, { heelDeg = 0, trimDeg = 0, h }) {
  const ps = participants(t, heelDeg, trimDeg);
  if (!ps) return unavailable(`heel ${heelDeg}°, trim ${trimDeg}° is outside the table's angles`);
  const parts = [];
  for (const { row, w } of ps) {
    const b = rowBracket(row, h);
    if (!b) return unavailable(`plane offset ${h.toFixed(3)} m is outside the immersion range of the row at heel ${row.heelDeg}°, trim ${row.trimDeg}°`);
    for (const [s, ws] of b) parts.push([s, w * ws]);
  }
  let V = 0;
  const Q = [0, 0, 0];
  for (const [s, w] of parts) {
    V += w * s.volumeM3;
    if (s.volumeM3 > 0) for (let k = 0; k < 3; k++) Q[k] += w * s.volumeM3 * s.buoyancyCenterM[k];
  }
  const wpKind = (s) => (s.waterplane === null ? null : s.waterplane === undefined ? undefined : s.waterplane);
  const area = optional(parts, (s) => (wpKind(s) === null ? null : wpKind(s)?.areaM2));
  let waterplane;
  if (area === null) waterplane = null;
  else if (fin(area)) {
    const comp = (f) => optional(parts, (s) => (s.waterplane ? f(s.waterplane) : undefined));
    const c = [0, 1, 2].map((k) => comp((w) => w.centroidM?.[k]));
    const m = {};
    for (const k of ["xx", "xy", "yy"]) {
      const v = comp((w) => w.secondMomentsM4?.[k]);
      if (fin(v)) m[k] = v;
    }
    waterplane = { areaM2: area, ...(c.every(fin) ? { centroidM: c } : {}), secondMomentsM4: m };
  }
  const wetted = optional(parts, (s) => (fin(s.wettedAreaM2) ? s.wettedAreaM2 : undefined));
  return {
    available: true,
    volumeM3: V,
    buoyancyCenterM: V > 0 ? Q.map((q) => q / V) : null,
    waterplane,
    wettedAreaM2: fin(wetted) ? wetted : undefined,
  };
}

/**
 * The plane offset at which the table displaces `volumeM3` at a fixed
 * attitude (§9, "solve immersion"). The interpolant is piecewise linear in h
 * between the participating rows' offsets, so this is exact for it.
 * @returns {{ available: true, h: number, nonunique: boolean } | { available: false, reason }}
 */
export function immersion(t, volumeM3, { heelDeg = 0, trimDeg = 0 } = {}) {
  const ps = participants(t, heelDeg, trimDeg);
  if (!ps) return unavailable(`heel ${heelDeg}°, trim ${trimDeg}° is outside the table's angles`);
  let lo = -Infinity, hi = Infinity;
  const offs = new Set();
  for (const { row } of ps) {
    lo = Math.max(lo, row.samples[0].waterplaneOffsetM);
    hi = Math.min(hi, row.samples[row.samples.length - 1].waterplaneOffsetM);
    for (const s of row.samples) offs.add(s.waterplaneOffsetM);
  }
  if (!(hi >= lo)) return unavailable("the participating rows share no immersion range");
  const hs = [...offs].filter((h) => h >= lo && h <= hi);
  if (!hs.includes(lo)) hs.push(lo);
  if (!hs.includes(hi)) hs.push(hi);
  hs.sort((a, b) => a - b);
  const V = (h) => interpolate(t, { heelDeg, trimDeg, h }).volumeM3;
  const vs = hs.map(V);
  if (volumeM3 < vs[0] || volumeM3 > vs[vs.length - 1])
    return unavailable(`${volumeM3.toFixed(3)} m³ is outside the volumes this attitude covers (${vs[0].toFixed(3)} … ${vs[vs.length - 1].toFixed(3)} m³)`);
  for (let i = 1; i < hs.length; i++) {
    if (volumeM3 <= vs[i]) {
      if (vs[i] === vs[i - 1]) return { available: true, h: hs[i - 1], nonunique: true };
      const f = (volumeM3 - vs[i - 1]) / (vs[i] - vs[i - 1]);
      const h = hs[i - 1] + f * (hs[i] - hs[i - 1]);
      // a plateau touching the answer makes it nonunique too
      const nonunique = (f === 0 && i > 1 && vs[i - 2] === vs[i - 1]) || (f === 1 && i + 1 < vs.length && vs[i + 1] === vs[i]);
      return { available: true, h, nonunique };
    }
  }
  return { available: true, h: hs[0], nonunique: vs[0] === vs[1] };
}

/** R·v */
const rot = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/**
 * Righting at one heel and trim for a loading (§9): solve immersion, then
 * GZ = −(R·(B − G)).y and KN = −(R·(B − K)).y. Fixed trim.
 * @param {{ volumeM3: number, G: number[] }} loading G in the table's frame
 */
export function rightingAt(t, loading, { heelDeg = 0, trimDeg = 0 } = {}) {
  const im = immersion(t, loading.volumeM3, { heelDeg, trimDeg });
  if (!im.available) return { heelDeg, trimDeg, ...im };
  const r = interpolate(t, { heelDeg, trimDeg, h: im.h });
  if (!r.available || !r.buoyancyCenterM) return { heelDeg, trimDeg, ...unavailable(r.reason ?? "no buoyancy") };
  const R = rotationRows(heelDeg, trimDeg);
  const B = r.buoyancyCenterM;
  const K = t.frame.knReferenceM;
  const qG = rot(R, [B[0] - loading.G[0], B[1] - loading.G[1], B[2] - loading.G[2]]);
  const qK = rot(R, [B[0] - K[0], B[1] - K[1], B[2] - K[2]]);
  return { available: true, heelDeg, trimDeg, h: im.h, nonunique: im.nonunique, B, gz: -qG[1], kn: -qK[1], trimLever: qG[0], reading: r };
}

/**
 * Free-trim righting at a heel (§9): find the trim at which B and G line up
 * fore and aft in the world (the longitudinal lever (R·(B − G)).x is zero),
 * within the table's trims. Unavailable when the table has one trim or the
 * balance lies outside its range.
 */
export function freeTrimRightingAt(t, loading, { heelDeg = 0 } = {}) {
  const { trims } = tableIndex(t);
  if (trims.length < 2) return { heelDeg, ...unavailable("the table has one trim, so free trim can't be solved") };
  const lever = (trim) => {
    const r = rightingAt(t, loading, { heelDeg, trimDeg: trim });
    return r.available ? r : null;
  };
  let prev = null;
  for (const tr of trims) {
    const r = lever(tr);
    if (!r) {
      prev = null;
      continue;
    }
    if (r.trimLever === 0) return { ...r, freeTrim: true };
    if (prev && Math.sign(prev.trimLever) !== Math.sign(r.trimLever)) {
      let a = prev, b = r;
      for (let i = 0; i < 60; i++) {
        const m = lever(0.5 * (a.trimDeg + b.trimDeg));
        if (!m) break;
        if (Math.sign(m.trimLever) === Math.sign(a.trimLever)) a = m;
        else b = m;
        if (Math.abs(b.trimDeg - a.trimDeg) < 1e-9) break;
      }
      const best = Math.abs(a.trimLever) < Math.abs(b.trimLever) ? a : b;
      return { ...best, freeTrim: true };
    }
    prev = r;
  }
  return { heelDeg, ...unavailable("the trim that balances B under G is outside the table's trims") };
}

/** Signed clearance of the lowest point of each marker kind above the waterplane (§6): n·p − h. */
export function markerClearance(t, { heelDeg, trimDeg, h }) {
  const n = rotationRows(heelDeg, trimDeg)[2];
  const out = {};
  for (const m of t.immersionMarkers ?? []) {
    let c = Infinity;
    for (const p of m.pointsM) c = Math.min(c, n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - h);
    out[m.kind] = Math.min(out[m.kind] ?? Infinity, c);
  }
  return out;
}

/**
 * A GZ (and KN) curve over heels, fixed trim unless freeTrim.
 * @returns {{ heelDeg, available, gz?, kn?, h?, trimDeg?, clearance?, reason? }[]}
 */
export function rightingCurve(t, loading, heels, { trimDeg = 0, freeTrim = false } = {}) {
  return heels.map((heelDeg) => {
    const r = freeTrim ? freeTrimRightingAt(t, loading, { heelDeg }) : rightingAt(t, loading, { heelDeg, trimDeg });
    if (!r.available) return { heelDeg, available: false, reason: r.reason };
    return { heelDeg, available: true, gz: r.gz, kn: r.kn, h: r.h, trimDeg: r.trimDeg, clearance: markerClearance(t, r) };
  });
}

/** Where a sampled function first falls to ≤ 0 between points (linear), or null. */
function firstCrossing(points, value, from = 0) {
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const va = value(a), vb = value(b);
    if (va > 0 && vb <= 0) return a.heelDeg + ((b.heelDeg - a.heelDeg) * va) / (va - vb);
  }
  return null;
}

/**
 * Camber's GZ vocabulary from a curve: GZ max and its heel, the angle of
 * vanishing stability, the sheer-immersion angle, and the areas to 30° and
 * 40° (m·rad, trapezoidal on the curve's own points, so only as good as its
 * heel spacing). Only the covered stretch from the first heel is used; a
 * reading the coverage can't reach is null with a note, never a guess.
 */
export function curveReadouts(curve) {
  const notes = [];
  let n = 0;
  while (n < curve.length && curve[n].available) n++;
  const pts = curve.slice(0, n);
  if (!pts.length) return { coveredToDeg: null, gzMax: null, heelAtMaxDeg: null, avsDeg: null, area30: null, area40: null, sheerImmersionDeg: null, notes: ["no heel is covered"] };
  const coveredToDeg = pts[pts.length - 1].heelDeg;
  if (n < curve.length) notes.push(`covered to ${coveredToDeg}° (${curve[n].reason})`);
  let iMax = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].gz > pts[iMax].gz) iMax = i;
  const maxAtEnd = iMax === pts.length - 1 && pts.length < curve.length;
  if (maxAtEnd) notes.push("GZ is still rising where coverage ends");
  const avsDeg = firstCrossing(pts, (p) => p.gz, iMax + 1);
  if (avsDeg == null) notes.push(`no vanishing angle within ${coveredToDeg}°`);
  const area = (to) => {
    if (pts[0].heelDeg > 0 || coveredToDeg < to) return null;
    let a = 0;
    for (let i = 1; i < pts.length && pts[i - 1].heelDeg < to; i++) {
      const p = pts[i - 1], q = pts[i];
      const hi = Math.min(q.heelDeg, to);
      const gq = q.heelDeg === hi ? q.gz : p.gz + ((q.gz - p.gz) * (hi - p.heelDeg)) / (q.heelDeg - p.heelDeg);
      a += ((p.gz + gq) / 2) * (hi - p.heelDeg) * RAD;
    }
    return a;
  };
  const hasSheer = pts.some((p) => p.clearance && "deck-edge" in p.clearance);
  const sheerImmersionDeg = hasSheer ? firstCrossing(pts, (p) => p.clearance["deck-edge"]) : null;
  if (!hasSheer) notes.push("no deck-edge markers: sheer immersion unknown");
  else if (sheerImmersionDeg == null) notes.push(`the sheer stays dry to ${coveredToDeg}°`);
  return {
    coveredToDeg,
    gzMax: maxAtEnd ? null : pts[iMax].gz,
    heelAtMaxDeg: maxAtEnd ? null : pts[iMax].heelDeg,
    avsDeg,
    area30: area(30),
    area40: area(40),
    sheerImmersionDeg,
    notes,
  };
}

/** Upright KMt and KMl from the table (§4): KB + yy/V, KB + xx/V, at trim 0 unless given. */
export function uprightKM(t, volumeM3, { trimDeg = 0 } = {}) {
  const im = immersion(t, volumeM3, { heelDeg: 0, trimDeg });
  if (!im.available) return im;
  const r = interpolate(t, { heelDeg: 0, trimDeg, h: im.h });
  if (!r.available || !r.buoyancyCenterM) return unavailable(r.reason ?? "no buoyancy at this volume");
  const K = t.frame.knReferenceM;
  const kb = r.buoyancyCenterM[2] - K[2];
  const m = r.waterplane?.secondMomentsM4 ?? {};
  return {
    available: true,
    h: im.h,
    kb,
    kmt: fin(m.yy) ? kb + m.yy / volumeM3 : null,
    kml: fin(m.xx) ? kb + m.xx / volumeM3 : null,
    lcb: r.buoyancyCenterM[0],
    reason: fin(m.yy) ? undefined : "the table gives no waterplane yy here",
  };
}

// ───────────────────────────────── building a table from a mesh

/** Heels 0 … 90 by 2.5°, then to 180 by 5°: GZ peaks are resolved, capsized states are covered. */
export const DEFAULT_HEELS = [...Array.from({ length: 37 }, (_, i) => i * 2.5), ...Array.from({ length: 18 }, (_, i) => 95 + i * 5)];

/**
 * A Chartroom hydrostatic-table v1 from a closed mesh in the hull frame.
 * Each row samples `steps` + 1 offsets across the hull's height at that
 * attitude (padded so the ends are genuinely dry and full) plus, for each of
 * `volumes`, the exact offset that displaces it, so readings at those
 * displacements are the mesh's own, not interpolated.
 * @param {Float64Array|ReturnType<typeof prepareMesh>} meshOrTriangles
 * @param {{ heels?: number[], trims?: number[], steps?: number, volumes?: number[], name?: string,
 *           originDescription?: string, description?: string, reference?: { heelDeg, trimDeg, waterplaneOffsetM } }} [o]
 */
export function buildTable(meshOrTriangles, o = {}) {
  const mesh = meshOrTriangles?.triangles ? meshOrTriangles : prepareMesh(meshOrTriangles);
  const heels = [...new Set(o.heels ?? DEFAULT_HEELS)].sort((a, b) => a - b);
  const trims = [...new Set(o.trims ?? [0])].sort((a, b) => a - b);
  const steps = Math.max(2, Math.round(o.steps ?? 24));
  const volumes = (o.volumes ?? []).filter((v) => v > 0);
  const rows = [];
  let monotoneFixes = 0;
  for (const trimDeg of trims)
    for (const heelDeg of heels) {
      const R = rotationRows(heelDeg, trimDeg);
      const [bottom, top] = heightSpan(mesh, R);
      const span = top - bottom;
      const lo = bottom - span * 1e-8, hi = top + span * 1e-8;
      const offs = new Set(Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps));
      for (const v of volumes) {
        const h = immerse(mesh, v, { heelDeg, trimDeg });
        if (h != null && h > lo && h < hi) offs.add(h);
      }
      const ref = o.reference;
      if (ref && ref.heelDeg === heelDeg && ref.trimDeg === trimDeg && ref.waterplaneOffsetM > lo && ref.waterplaneOffsetM < hi) offs.add(ref.waterplaneOffsetM);
      const samples = [];
      for (const h of [...offs].sort((a, b) => a - b)) {
        const c = cut(mesh, { heelDeg, trimDeg, h });
        let vol = c.volumeM3;
        const last = samples[samples.length - 1];
        if (last && vol < last.volumeM3) {
          vol = last.volumeM3; // round-off at a plateau; keep §3's nondecreasing volume
          monotoneFixes++;
        }
        const s = { waterplaneOffsetM: h };
        if (vol > 0 && c.buoyancyCenterM) Object.assign(s, { volumeM3: vol, buoyancyCenterM: c.buoyancyCenterM });
        else Object.assign(s, { volumeM3: 0, buoyancyCenterM: null });
        s.waterplane = c.waterplane ? { areaM2: c.waterplane.areaM2, centroidM: c.waterplane.centroidM, secondMomentsM4: c.waterplane.secondMomentsM4 } : null;
        s.wettedAreaM2 = c.wettedAreaM2;
        samples.push(s);
      }
      rows.push({ heelDeg, trimDeg, samples });
    }
  const view = sideView(mesh, 60);
  const sheer = view.filter((r) => fin(r.yPort) && fin(r.yStbd)).flatMap((r) => [
    [r.x, r.yPort, r.zMax],
    [r.x, r.yStbd, r.zMax],
  ]);
  const table = {
    format: HYDROSTATIC_TABLE_FORMAT,
    version: 1,
    name: o.name ?? "Hull mesh",
    frame: {
      axes: FRAME_AXES,
      originDescription: o.originDescription ?? "The rig aid's hull frame",
      knReferenceM: [0, 0, mesh.bounds.min[2]],
    },
    body: {
      description:
        o.description ??
        `Closed triangle mesh (${mesh.count} triangles) integrated as given; no appendages${mesh.closed ? "" : `; the mesh is not closed (gap ${mesh.gap.toExponential(1)}), so volumes are approximate`}.`,
      buoyancyEnvelope: "closed-watertight",
    },
    table: { interpolation: "linear", rows },
    ...(o.reference ? { referenceState: { heelDeg: o.reference.heelDeg, trimDeg: o.reference.trimDeg, waterplaneOffsetM: o.reference.waterplaneOffsetM } } : {}),
    ...(sheer.length ? { immersionMarkers: [{ id: "sheer", label: "Each sampled station's widest, highest point, port and starboard (the sheer, for flared topsides)", kind: "deck-edge", pointsM: sheer }] } : {}),
    source: {
      tool: "rig (patchwork-experiments)",
      method: `Divergence-theorem integrals of the mesh clipped at each waterplane; ${steps} immersion steps per attitude plus the exact offsets for the requested displacements.`,
      notes: [
        "Second moments are central, in world-horizontal axes after R. Wetted area is the clipped skin only.",
        ...(monotoneFixes ? [`${monotoneFixes} sample volume(s) held at the previous value against round-off.`] : []),
        "No convergence assessment beyond the mesh's own resolution.",
      ],
    },
    notes: ["Static response of the closed envelope as meshed; it does not model flooding.", "No downflooding markers: opening immersion limits are unknown, not absent."],
  };
  return table;
}
